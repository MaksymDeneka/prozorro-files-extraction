# Prozorro Document Prioritizer

Local app for extracting attached documents from a Prozorro tender and ranking the files most likely to contain the procurement subject or technical requirements.

## Why Node

Node is a good fit for this local app because the user only needs one runtime, the UI runs in the browser, and the server can call the public Prozorro APIs without a heavier desktop wrapper.

## Run on Mac

1. Install Node.js LTS from https://nodejs.org
2. Open Terminal in this folder.
3. Run:

```sh
npm install
chmod +x start.command
./start.command
```

The app opens at:

```text
http://localhost:3477
```

You can also run it manually:

```sh
npm start
```

## File Preview

Use the `Preview` button on a document row to view file content inside the app without saving it to the Downloads folder.

Supported preview types:

- PDF and images: embedded viewer through the local app
- DOCX: extracted HTML/text preview
- RTF: converted document-style HTML/text preview
- XLSX and CSV: table preview, limited to the first rows/columns
- TXT, XML, JSON, HTML: text preview
- ZIP: file list preview

The preview panel opens wide by default. Use the `-` / `+` buttons or drag its left edge to resize it; the chosen width is remembered in the browser.

Unsupported or skipped:

- P7S signature files
- RAR/7Z archive contents
- old `.xls` spreadsheets
- scanned PDFs do not have searchable text unless OCR is added later

## What It Checks

The app accepts either a visible tender ID like `UA-2026-07-02-003111-a` or a Prozorro internal 32-character tender UUID.

Priority is based on editable normalized filename matching. Use the `Keyword rules` panel in the app to add or remove phrases for Top, High, and Low priority. Keyword edits are saved automatically. If a keyword is deleted accidentally, use `Undo` to restore the last deleted keyword. The saved file is:

```text
data/priority-rules.json
```

Default rules:

- Top: `Технічний опис`
- High: `Додаток 2`, `технічна специфікація`, `відомість ресурсів`, `кошторис`, plus close variants such as `технічне завдання`, `ТЗ`, `дефектний акт`, `обсяги робіт`
- Low: `договір`, `критерії`, `банківська гарантія`, `довідка`, and related contract/support-document names

The app also lowers `.p7s` signature files and uses Prozorro `documentType` hints when available.

## Loose Matching

Before matching, both filenames and keywords are normalized:

- Unicode text is normalized with `NFKC`
- Text is lowercased with Ukrainian locale rules
- Apostrophes are removed
- punctuation, dashes, underscores, brackets, `№`, and repeated spaces are treated as separators
- multi-word keywords can match through flexible separators
- Ukrainian word endings are loosened by matching a short token stem plus following letters
- numeric terms tolerate leading zeroes, so `Додаток 02` can match `Додаток 2`

Example: `ТЕХНІЧНА_специфікація-final.pdf` can match `технічна специфікація`.

## API Sources

- Visible `UA-...` IDs are resolved through `https://prozorro.gov.ua/api/tenders/{tenderID}/summary`
- Tender metadata is read from `https://public-api.prozorro.gov.ua/api/2.5/tenders/{internalId}` with selected fields
- Tender-level document URLs are read from `https://public-api.prozorro.gov.ua/api/2.5/tenders/{internalId}/documents`
