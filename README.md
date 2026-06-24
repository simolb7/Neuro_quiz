# Neuroengineering quiz

## Run the quiz on this PC

Open PowerShell in this folder and start a small local web server:

```powershell
py -m http.server 8000
```

Then open <http://localhost:8000> in a browser. Keep the PowerShell window open
while using the quiz. Stop the server with `Ctrl+C`.

Opening `index.html` directly is not supported because browsers normally block
JavaScript from loading a local JSON file.

## Open it on a phone

Connect the phone and PC to the same Wi-Fi. On the PC, run:

```powershell
ipconfig
py -m http.server 8000 --bind 0.0.0.0
```

Find the PC's Wi-Fi `IPv4 Address` (for example `192.168.1.25`) and open
`http://192.168.1.25:8000` on the phone. Windows Firewall may ask for permission;
allow access only on private networks.

## Regenerate the question data

Install PyMuPDF once:

```powershell
py -m pip install pymupdf
```

Then run:

```powershell
py extract_neuro_questions.py --input esami --output questions.json --assets assets
```

The extractor reads both Section A and Section B and writes a structured dataset
under `parts.A` and `parts.B`. It preserves question crops for images and
formulas, and removes repeated plain-text questions separately inside each part.
Questions that rely on visual or formula content are not deduplicated.

To regenerate only one section, add `--section A` or `--section B`.
