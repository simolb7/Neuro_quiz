#!/usr/bin/env python3
"""
Conta quante volte compare ogni domanda negli esami sorgente.

Uso:
  python count_question_occurrences.py --input esami --output question_occurrences.csv

Il report e' ordinato con le domande meno frequenti in alto, separando Part A
e Part B. A differenza di questions.json, questo script conta prima della
deduplicazione, quindi vede anche le ripetizioni tra appelli.
"""

from __future__ import annotations

import argparse
import csv
import json
import tempfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from extract_neuro_questions import duplicate_key, extract_from_pdf, iter_pdfs


def build_occurrence_report(input_path: Path, sections: list[str]) -> list[dict[str, Any]]:
    pdfs = list(iter_pdfs(input_path))
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)

    # extract_from_pdf salva eventuali immagini rilevate. Per questo report non
    # servono, quindi usiamo una cartella temporanea che viene eliminata subito.
    with tempfile.TemporaryDirectory(prefix="neuro_occurrences_") as temp_dir:
        assets_dir = Path(temp_dir)
        for section in sections:
            for pdf_path in pdfs:
                extracted = extract_from_pdf(
                    pdf_path=pdf_path,
                    assets_dir=assets_dir,
                    section=section,
                    save_crops=False,
                )
                for question in extracted:
                    grouped[(section, duplicate_key(question["question"]))].append(question)

    rows: list[dict[str, Any]] = []
    for (section, _key), occurrences in grouped.items():
        answers = Counter(question["answer_label"] for question in occurrences)
        sources = [
            f"{question['source_pdf']}#q{question['number']}"
            for question in occurrences
        ]
        rows.append({
            "part": section,
            "occurrences": len(occurrences),
            "question": occurrences[0]["question"],
            "answers_seen": "; ".join(
                f"{label}:{count}" for label, count in sorted(answers.items())
            ),
            "sources": "; ".join(sources),
        })

    return sorted(rows, key=lambda row: (row["part"], row["occurrences"], row["question"].casefold()))


def write_csv(rows: list[dict[str, Any]], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(
            file,
            fieldnames=["part", "occurrences", "question", "answers_seen", "sources"],
        )
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="esami", help="Cartella con i PDF degli esami")
    parser.add_argument("--output", default="question_occurrences.csv", help="Report CSV da creare")
    parser.add_argument("--json-output", default=None, help="Report JSON opzionale")
    parser.add_argument(
        "--section",
        default="ALL",
        choices=["A", "B", "ALL"],
        help="Sezione da contare; ALL conta sia Part A sia Part B",
    )
    args = parser.parse_args()

    sections = ["A", "B"] if args.section == "ALL" else [args.section]
    rows = build_occurrence_report(Path(args.input), sections)
    write_csv(rows, Path(args.output))

    if args.json_output:
        Path(args.json_output).write_bytes(
            (json.dumps(rows, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        )

    counts = Counter(row["occurrences"] for row in rows)
    print(f"Report salvato in: {args.output}")
    if args.json_output:
        print(f"Report JSON salvato in: {args.json_output}")
    print(f"Domande uniche: {len(rows)}")
    print("Distribuzione occorrenze:")
    for occurrence_count in sorted(counts):
        print(f"  {occurrence_count} volta/e: {counts[occurrence_count]} domande")


if __name__ == "__main__":
    main()
