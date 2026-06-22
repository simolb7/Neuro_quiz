#!/usr/bin/env python3
"""
Estrae automaticamente le domande V/F da PDF di esami Neuroengineering
strutturati come tabella: # | Question | Ans. | Explanation.

Uso:
  pip install pymupdf
  python extract_neuro_questions.py --input esami --output questions.json --assets assets

Note:
- Estrae solo Section A, senza assumere che contenga esattamente 24 domande.
- Salva eventuali immagini presenti nella cella della domanda in assets/.
- Salva anche un crop completo: formule e grafici vettoriali nei PDF non
  sempre sono riconoscibili come immagini separate.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any, Iterable

import fitz  # PyMuPDF


def path_for_json(path: Path) -> str:
    """Restituisce un path comodo da usare nel browser, preferibilmente relativo."""
    try:
        return str(path.resolve().relative_to(Path.cwd().resolve()).as_posix())
    except ValueError:
        return str(path.as_posix())


def clean_text(text: str) -> str:
    """Normalizza il testo e ricompone le parole spezzate a fine riga."""
    text = text.replace("\u00ad", "")
    text = re.sub(r"(?<=\w)-\s*\n\s*(?=\w)", "-", text)
    return re.sub(r"\s+", " ", text).strip()


def rect_contains_word(rect: fitz.Rect, word: tuple) -> bool:
    x0, y0, x1, y1 = word[:4]
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2
    return rect.x0 <= cx <= rect.x1 and rect.y0 <= cy <= rect.y1


def text_in_rect(page: fitz.Page, rect: fitz.Rect) -> str:
    """Estrae il testo dentro un rettangolo, ordinandolo per righe."""
    words = [w for w in page.get_text("words") if rect_contains_word(rect, w)]
    if not words:
        return ""

    # Ordina per y, poi x; raggruppa parole su righe vicine.
    words.sort(key=lambda w: (round(w[1] / 4) * 4, w[0]))
    lines: list[list[tuple]] = []
    for w in words:
        y = w[1]
        if not lines or abs(lines[-1][0][1] - y) > 5:
            lines.append([w])
        else:
            lines[-1].append(w)

    out_lines = []
    for line in lines:
        line.sort(key=lambda w: w[0])
        out_lines.append(" ".join(w[4] for w in line))
    return clean_text("\n".join(out_lines))


def parse_answer(text: str) -> bool | None:
    """Converte T/F e TRUE/FALSE; '-' indica una domanda non disponibile."""
    token = re.sub(r"[^A-Z]", "", text.upper())
    if not token or len(token) > 5:
        return None
    if token.startswith("T"):
        return True
    if token.startswith("F"):
        return False
    return None


def union_rects(rects: list[fitz.Rect]) -> fitz.Rect | None:
    if not rects:
        return None
    result = fitz.Rect(rects[0])
    for rect in rects[1:]:
        result.include_rect(rect)
    return result


def header_index(names: list[str], prefix: str) -> int | None:
    prefix = prefix.lower()
    for index, name in enumerate(names):
        if clean_text(name or "").lower().startswith(prefix):
            return index
    return None


def question_contains_formula(text: str) -> bool:
    """Rileva i marker più comuni delle formule che conviene mostrare come crop."""
    return bool(re.search(r"[=∈≤≥≈≠→←∞∑∏√±]", text))


def duplicate_key(text: str) -> str:
    """Chiave conservativa: ignora maiuscole, spazi e punteggiatura finale."""
    return clean_text(text).casefold().rstrip(" .")


def deduplicate_plain_questions(questions: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    """Rimuove i doppioni testuali, ma non domande con immagini/formule/contesto."""
    referenced_ids = {
        reference
        for question in questions
        for reference in question.get("context_question_ids", [])
    }
    seen_plain: set[str] = set()
    result: list[dict[str, Any]] = []
    removed = 0

    for question in questions:
        must_preserve = question.get("has_visual_content", False) or question["id"] in referenced_ids
        key = duplicate_key(question["question"])
        if not must_preserve and key in seen_plain:
            removed += 1
            continue
        if not must_preserve:
            seen_plain.add(key)
        result.append(question)

    return result, removed


def save_detected_images(
    page: fitz.Page,
    question_rect: fitz.Rect,
    pdf_stem: str,
    section: str,
    qnum: int,
    assets_dir: Path,
) -> list[str]:
    """Salva immagini contenute nella cella domanda, se presenti."""
    saved = []
    blocks = page.get_text("dict")["blocks"]
    for idx, block in enumerate(blocks):
        if block.get("type") != 1:
            continue
        bbox = fitz.Rect(block["bbox"])
        if not bbox.intersects(question_rect):
            continue

        # Salvo un crop della zona immagine dalla pagina, così preservo dimensioni e trasparenze visive.
        clip = bbox & question_rect
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=clip, alpha=False)
        filename = f"{pdf_stem}_{section}_q{qnum}_img{idx}.png"
        out_path = assets_dir / filename
        pix.save(str(out_path))
        saved.append(path_for_json(out_path))
    return saved


def save_question_crop(
    page: fitz.Page,
    question_rect: fitz.Rect,
    pdf_stem: str,
    section: str,
    qnum: int,
    assets_dir: Path,
) -> str:
    """Salva il ritaglio completo della cella domanda. Utile per debug/formule lette male."""
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=question_rect, alpha=False)
    filename = f"{pdf_stem}_{section}_q{qnum}_crop.png"
    out_path = assets_dir / "crops" / filename
    out_path.parent.mkdir(parents=True, exist_ok=True)
    pix.save(str(out_path))
    return path_for_json(out_path)


def extract_from_pdf(
    pdf_path: Path,
    assets_dir: Path,
    section: str = "A",
    max_question: int | None = None,
    save_crops: bool = True,
) -> list[dict[str, Any]]:
    doc = fitz.open(pdf_path)
    pdf_stem = pdf_path.stem
    questions: list[dict[str, Any]] = []
    in_section = False

    for page_index, page in enumerate(doc):
        page_text = page.get_text("text")
        wanted = section.upper()
        if re.search(rf"\bSection\s+{wanted}\b", page_text, flags=re.IGNORECASE):
            in_section = True
        if wanted == "A" and re.search(r"\bSection\s+B\b", page_text, flags=re.IGNORECASE):
            if in_section:
                break
        if not in_section:
            continue

        for table in page.find_tables().tables:
            names = list(table.header.names)
            extracted_rows = table.extract()
            question_col = header_index(names, "question")
            answer_col = header_index(names, "ans")
            explanation_col = header_index(names, "explanation")
            points_col = header_index(names, "pts")
            has_header = question_col is not None and answer_col is not None

            # Nelle pagine successive dei PDF più vecchi l'header non viene
            # ripetuto. Identifica la colonna risposta contando le celle T/F.
            if answer_col is None:
                answer_scores = []
                for column in range(1, table.col_count):
                    score = sum(
                        parse_answer((row[column] or "")) is not None
                        for row in extracted_rows
                        if column < len(row)
                    )
                    answer_scores.append((score, column))
                if not answer_scores or max(answer_scores)[0] == 0:
                    continue
                answer_col = max(answer_scores)[1]
            if explanation_col is None:
                explanation_col = min(answer_col + 1, table.col_count)
            if question_col is None:
                question_col = 1

            # Alcuni layout hanno una colonna punti senza header nelle pagine
            # successive. Non deve finire dentro il testo della domanda.
            if points_col is None and answer_col > question_col + 1:
                values = [
                    clean_text(row[answer_col - 1] or "")
                    for row in extracted_rows
                    if answer_col - 1 < len(row) and clean_text(row[answer_col - 1] or "")
                ]
                if values and sum(bool(re.fullmatch(r"\d+(?:[.,]\d+)?", value)) for value in values) >= len(values) / 2:
                    points_col = answer_col - 1

            current: dict[str, Any] | None = None

            def finish_current() -> None:
                nonlocal current
                if current is None:
                    return
                qnum = current["number"]
                answer = next(
                    (parsed for part in current["answers"] if (parsed := parse_answer(part)) is not None),
                    None,
                )
                q_rect = union_rects(current["rects"])
                if answer is not None and q_rect is not None and (max_question is None or qnum <= max_question):
                    media = save_detected_images(page, q_rect, pdf_stem, wanted, qnum, assets_dir)
                    crop_path = (
                        save_question_crop(page, q_rect, pdf_stem, wanted, qnum, assets_dir)
                        if save_crops
                        else None
                    )
                    questions.append({
                        "id": f"{pdf_stem}_{wanted}_{qnum}",
                        "source_pdf": pdf_path.name,
                        "section": wanted,
                        "number": qnum,
                        "question": clean_text(" ".join(current["questions"])),
                        "answer": answer,
                        "answer_label": "T" if answer else "F",
                        "explanation": clean_text(" ".join(current["explanations"])),
                        "images": media,
                        "question_crop": crop_path,
                        "context_question_ids": [],
                    })
                current = None

            # La prima riga è l'header. Alcuni PDF dividono una domanda su più
            # righe di tabella: le righe senza numero vengono unite alla precedente.
            first_data_row = 1 if has_header else 0
            for row_index, row in enumerate(extracted_rows[first_data_row:], start=first_data_row):
                cells = [clean_text(value or "") for value in row]
                if any("total points" in value.lower() for value in cells):
                    finish_current()
                    break

                number_text = cells[0] if cells else ""
                number_match = re.fullmatch(r"(\d+)\.?", number_text)
                if number_match:
                    finish_current()
                    current = {
                        "number": int(number_match.group(1)),
                        "questions": [],
                        "answers": [],
                        "explanations": [],
                        "rects": [],
                    }
                if current is None:
                    continue

                answer_candidates = [
                    column for column, value in enumerate(cells[1:], start=1)
                    if parse_answer(value) is not None
                ]
                row_answer_col = min(answer_candidates, key=lambda column: abs(column - answer_col)) if answer_candidates else answer_col
                question_end = points_col if points_col is not None and points_col < row_answer_col else row_answer_col
                explanation_start = explanation_col if explanation_col > row_answer_col else row_answer_col + 1

                current["questions"].append(" ".join(cells[question_col:question_end]))
                current["answers"].append(cells[row_answer_col] if row_answer_col < len(cells) else "")
                current["explanations"].append(" ".join(cells[explanation_start:]))
                if row_index < len(table.rows):
                    for cell_rect in table.rows[row_index].cells[question_col:question_end]:
                        if cell_rect is not None:
                            current["rects"].append(fitz.Rect(cell_rect))

            finish_current()

    # Evita duplicati e ordina.
    unique = {q["number"]: q for q in questions}
    ordered = [unique[n] for n in sorted(unique)]

    # Mantiene il contesto delle domande del tipo "in reference to the previous
    # figure", così un quiz randomizzato può mostrare anche il crop necessario.
    for index, question in enumerate(ordered):
        text = question["question"].lower()
        if "previous figure" not in text and "previous question" not in text:
            continue
        candidates = ordered[:index]
        figure_source = next((
            candidate for candidate in reversed(candidates)
            if candidate["images"] or re.search(r"figure\s+(shows|below|above)", candidate["question"], re.IGNORECASE)
        ), candidates[-1] if candidates else None)
        if figure_source is not None:
            question["context_question_ids"].append(figure_source["id"])

    for question in ordered:
        question["has_formula"] = question_contains_formula(question["question"])
        question["has_visual_content"] = bool(
            question["images"]
            or question["has_formula"]
            or question["context_question_ids"]
        )

    doc.close()
    return ordered


def iter_pdfs(input_path: Path) -> Iterable[Path]:
    if input_path.is_file() and input_path.suffix.lower() == ".pdf":
        yield input_path
    elif input_path.is_dir():
        yield from sorted(input_path.glob("*.pdf"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="PDF singolo oppure cartella contenente PDF")
    parser.add_argument("--output", default="questions.json", help="File JSON di output")
    parser.add_argument("--assets", default="assets", help="Cartella per immagini estratte")
    parser.add_argument("--section", default="A", choices=["A", "B"], help="Sezione da estrarre")
    parser.add_argument(
        "--max-question",
        type=int,
        default=None,
        help="Limite opzionale; di default estrae tutte le domande della sezione",
    )
    parser.add_argument("--no-crops", action="store_true", help="Non salvare i crop completi delle celle domanda")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)
    assets_dir = Path(args.assets)
    assets_dir.mkdir(parents=True, exist_ok=True)

    all_questions: list[dict[str, Any]] = []
    for pdf_path in iter_pdfs(input_path):
        extracted = extract_from_pdf(
            pdf_path=pdf_path,
            assets_dir=assets_dir,
            section=args.section,
            max_question=args.max_question,
            save_crops=not args.no_crops,
        )
        print(f"{pdf_path.name}: estratte {len(extracted)} domande")
        all_questions.extend(extracted)

    all_questions, removed_duplicates = deduplicate_plain_questions(all_questions)
    output_path.write_text(json.dumps(all_questions, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nDoppioni testuali rimossi: {removed_duplicates}")
    print(f"Totale: {len(all_questions)} domande")
    print(f"JSON salvato in: {output_path}")
    print(f"Immagini salvate in: {assets_dir}")


if __name__ == "__main__":
    main()
