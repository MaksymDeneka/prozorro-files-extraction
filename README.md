# Prozorro Document Prioritizer

Local app for extracting attached documents from a Prozorro tender and ranking the files most likely to contain the procurement subject or technical requirements.

## Why Node

Node is a good fit for this local app because the user only needs one runtime, the UI runs in the browser, and the server can call the public Prozorro APIs without a heavier desktop wrapper. This project currently has no npm dependencies.

## Run on Mac

1. Install Node.js LTS from https://nodejs.org
2. Open Terminal in this folder.
3. Run:

```sh
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

## What It Checks

The app accepts either a visible tender ID like `UA-2026-07-02-003111-a` or a Prozorro internal 32-character tender UUID.

Priority is based on editable normalized filename matching. Use the `Keyword rules` panel in the app to add or remove phrases for Top, High, and Low priority. The saved file is:

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
- Full tender data and document URLs are read from `https://public-api.prozorro.gov.ua/api/2.5/tenders/{internalId}`
