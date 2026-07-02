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

Priority is based on normalized filename matching:

- Top: `Технічний опис`
- High: `Додаток 2`, `технічна специфікація`, `відомість ресурсів`, `кошторис`, plus close variants such as `технічне завдання`, `ТЗ`, `дефектний акт`, `обсяги робіт`
- Low: `договір`, `критерії`, `банківська гарантія`, `довідка`, and related contract/support-document names

The app also lowers `.p7s` signature files and uses Prozorro `documentType` hints when available.

## API Sources

- Visible `UA-...` IDs are resolved through `https://prozorro.gov.ua/api/tenders/{tenderID}/summary`
- Full tender data and document URLs are read from `https://public-api.prozorro.gov.ua/api/2.5/tenders/{internalId}`
