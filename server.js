import http from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mammoth from "mammoth";
import readXlsxFile from "read-excel-file/node";
import JSZip from "jszip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const rulesPath = path.join(dataDir, "priority-rules.json");
const PORT = Number(process.env.PORT || 3477);

const PORTAL_API = "https://prozorro.gov.ua/api/tenders";
const PUBLIC_API = "https://public-api.prozorro.gov.ua/api/2.5/tenders";
const UUID_RE = /^[a-f0-9]{32}$/i;
const MAX_PREVIEW_BYTES = 35 * 1024 * 1024;
const MAX_TEXT_CHARS = 220000;
const MAX_TABLE_ROWS = 120;
const MAX_TABLE_COLS = 30;
const MAX_ARCHIVE_ITEMS = 250;

const LEVELS = {
  top: "Найвищий",
  high: "Високий",
  middle: "Середній",
  low: "Низький",
  signature: "Підпис",
};

const DEFAULT_PRIORITY_RULES = [
  {
    id: "top",
    name: "Top priority",
    level: LEVELS.top,
    score: 100,
    keywords: ["Технічний опис", "тех опис", "опис технічний"],
  },
  {
    id: "high",
    name: "High priority",
    level: LEVELS.high,
    score: 70,
    keywords: [
      "Додаток 2",
      "Додаток №2",
      "Дод 2",
      "технічна специфікація",
      "технічне завдання",
      "тех специфікація",
      "ТЗ",
      "відомість ресурсів",
      "ресурсна відомість",
      "кошторис",
      "локальний кошторис",
      "проектно кошторисна",
      "дефектний акт",
      "обсяг робіт",
      "обсяги робіт",
    ],
  },
  {
    id: "low",
    name: "Low priority",
    level: LEVELS.low,
    score: 12,
    keywords: [
      "договір",
      "договор",
      "контракт",
      "критерії",
      "критерій",
      "банківська гарантія",
      "гарантійний лист",
      "довідка",
      "протокол",
    ],
  },
];

const DOCUMENT_TYPE_RULES = new Map([
  ["technicalSpecifications", { score: 64, level: LEVELS.high, label: "documentType: technicalSpecifications" }],
  ["contractProforma", { score: 14, level: LEVELS.low, label: "documentType: contractProforma" }],
  ["contractSigned", { score: 10, level: LEVELS.low, label: "documentType: contractSigned" }],
  ["awardCriteria", { score: 12, level: LEVELS.low, label: "documentType: awardCriteria" }],
]);

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("uk-UA")
    .replace(/[ʼ’'`]/g, "")
    .replace(/[№#]/g, " ")
    .replace(/[_\-–—.,;:()[\]{}+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenStem(token) {
  if (/^\d+$/.test(token)) return token.replace(/^0+/, "") || "0";
  if (token.length <= 3) return token;
  if (token.length <= 6) return token.slice(0, -1);
  return token.slice(0, Math.max(4, token.length - 2));
}

function makeLooseKeywordPattern(keyword) {
  const tokens = normalizeText(keyword).split(" ").filter(Boolean);
  if (!tokens.length) return null;

  const body = tokens
    .map((token) => {
      if (/^\d+$/.test(token)) return `0*${escapeRegExp(token.replace(/^0+/, "") || "0")}`;
      if (/^[a-z]+$/i.test(token)) return escapeRegExp(token);
      return `${escapeRegExp(tokenStem(token))}[\\p{L}\\p{M}\\d]*`;
    })
    .join("[\\s._\\-–—,;:()№#]*");

  return new RegExp(`(^|[^\\p{L}\\p{M}\\d])${body}([^\\p{L}\\p{M}\\d]|$)`, "iu");
}

function sanitizeRules(rules) {
  const source = Array.isArray(rules) ? rules : DEFAULT_PRIORITY_RULES;
  const byId = new Map(DEFAULT_PRIORITY_RULES.map((rule) => [rule.id, rule]));

  return DEFAULT_PRIORITY_RULES.map((fallback) => {
    const candidate = source.find((rule) => rule?.id === fallback.id) || byId.get(fallback.id);
    const keywords = Array.isArray(candidate?.keywords) ? candidate.keywords : fallback.keywords;
    return {
      id: fallback.id,
      name: fallback.name,
      level: fallback.level,
      score: fallback.score,
      keywords: [...new Set(keywords.map((keyword) => String(keyword).trim()).filter(Boolean))],
    };
  });
}

async function getPriorityRules() {
  try {
    const payload = JSON.parse(await readFile(rulesPath, "utf8"));
    return sanitizeRules(payload.rules);
  } catch {
    await savePriorityRules(DEFAULT_PRIORITY_RULES);
    return sanitizeRules(DEFAULT_PRIORITY_RULES);
  }
}

async function savePriorityRules(rules) {
  const sanitized = sanitizeRules(rules);
  await mkdir(dataDir, { recursive: true });
  const tempPath = `${rulesPath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify({ rules: sanitized }, null, 2)}\n`, "utf8");
  await rename(tempPath, rulesPath);
  return sanitized;
}

function rankDocument(document, rules) {
  const title = normalizeText(document.title);
  const matches = [];
  let score = 32;
  let level = LEVELS.middle;

  for (const rule of rules) {
    for (const keyword of rule.keywords) {
      const pattern = makeLooseKeywordPattern(keyword);
      if (pattern?.test(title)) {
        matches.push(keyword);
        if (rule.score > score) {
          score = rule.score;
          level = rule.level;
        }
      }
    }
  }

  const typeRule = DOCUMENT_TYPE_RULES.get(document.documentType);
  if (typeRule) {
    matches.push(typeRule.label);
    if (typeRule.score > score) {
      score = typeRule.score;
      level = typeRule.level;
    }
  }

  const isSignature = /(?:^|\.)p7s$/iu.test(document.title || "") || document.format === "application/pkcs7-signature";
  if (isSignature) {
    score = Math.min(score, 4);
    level = LEVELS.signature;
    matches.push("Файл підпису");
  }

  return {
    ...document,
    normalizedTitle: title,
    priority: { score, level, reasons: matches.length ? matches : ["Без явного збігу"] },
  };
}

function collectDocuments(value, trail = "tender", results = []) {
  if (!value || typeof value !== "object") return results;

  if (Array.isArray(value)) {
    for (const item of value) collectDocuments(item, trail, results);
    return results;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "documents" && Array.isArray(child)) {
      for (const document of child) {
        if (document && typeof document === "object" && document.title) {
          results.push({
            id: document.id || "",
            title: document.title || "",
            url: document.url || "",
            format: document.format || "",
            hash: document.hash || "",
            documentType: document.documentType || "",
            documentOf: document.documentOf || "",
            datePublished: document.datePublished || "",
            dateModified: document.dateModified || "",
            author: document.author || "",
            language: document.language || "",
            source: trail,
          });
        }
      }
      continue;
    }

    if (child && typeof child === "object") {
      const nextTrail = Array.isArray(child) ? `${trail}.${key}` : trail;
      collectDocuments(child, nextTrail, results);
    }
  }

  return results;
}

function dedupeDocuments(documents) {
  const seen = new Set();
  return documents.filter((document) => {
    const key = [document.id, document.url, document.title, document.hash].filter(Boolean).join("|");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "prozorro-local-document-prioritizer/0.1",
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Prozorro request failed: ${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 200)}` : ""}`);
  }

  return response.json();
}

function assertAllowedDocumentUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Invalid document URL.");
  }

  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith("prozorro.gov.ua")) {
    throw new Error("Only Prozorro document URLs can be previewed.");
  }

  return parsed.toString();
}

function extensionFromTitle(title) {
  return path.extname(String(title || "").split("?")[0]).toLocaleLowerCase("uk-UA");
}

function inferPreviewKind({ title, format, contentType }) {
  const ext = extensionFromTitle(title);
  const mime = String(format || contentType || "").toLocaleLowerCase("en-US");

  if (ext === ".p7s" || mime.includes("pkcs7")) return "signature";
  if (mime.includes("pdf") || ext === ".pdf") return "pdf";
  if (mime.startsWith("image/") || [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"].includes(ext)) return "image";
  if (ext === ".docx" || mime.includes("wordprocessingml.document")) return "docx";
  if (ext === ".xlsx" || mime.includes("spreadsheetml.sheet")) return "xlsx";
  if (ext === ".csv" || mime.includes("csv")) return "csv";
  if (ext === ".txt" || ext === ".xml" || ext === ".json" || ext === ".html" || ext === ".htm" || mime.startsWith("text/")) return "text";
  if ([".zip", ".rar", ".7z"].includes(ext) || mime.includes("zip") || mime.includes("rar") || mime.includes("7z")) return "archive";
  return "unsupported";
}

async function fetchDocumentBuffer(documentUrl) {
  const safeUrl = assertAllowedDocumentUrl(documentUrl);
  const response = await fetch(safeUrl, {
    headers: {
      accept: "*/*",
      "user-agent": "prozorro-local-document-prioritizer/0.1",
    },
  });

  if (!response.ok) {
    throw new Error(`Document request failed: ${response.status} ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_PREVIEW_BYTES) {
    throw new Error("This file is too large to preview locally.");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_PREVIEW_BYTES) {
    throw new Error("This file is too large to preview locally.");
  }

  return {
    buffer,
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}

function safeFilename(title) {
  return String(title || "document")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .slice(0, 180);
}

function inlineContentTypeFor(kind, title, contentType) {
  if (kind === "pdf") return "application/pdf";
  if (kind !== "image") return contentType;

  const ext = extensionFromTitle(title);
  const imageTypes = new Map([
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".gif", "image/gif"],
    [".webp", "image/webp"],
    [".bmp", "image/bmp"],
  ]);

  return contentType.toLocaleLowerCase("en-US").startsWith("image/") ? contentType : imageTypes.get(ext) || "application/octet-stream";
}

function decodeText(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.byteLength, MAX_TEXT_CHARS));
  return new TextDecoder("utf-8", { fatal: false }).decode(sample);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      if (rows.length >= MAX_TABLE_ROWS) break;
    } else if (char !== "\r") {
      value += char;
    }
  }

  if (rows.length < MAX_TABLE_ROWS && (value || row.length)) {
    row.push(value);
    rows.push(row);
  }

  return rows.map((item) => item.slice(0, MAX_TABLE_COLS));
}

async function buildDocumentPreview({ documentUrl, title, format }) {
  const safeUrl = assertAllowedDocumentUrl(documentUrl);
  const initialKind = inferPreviewKind({ title, format });

  if (initialKind === "signature") {
    return {
      kind: "unsupported",
      title,
      message: "Signature files are not previewed.",
    };
  }

  if (initialKind === "pdf" || initialKind === "image") {
    return {
      kind: initialKind,
      title,
      fileUrl: `/api/file?url=${encodeURIComponent(safeUrl)}&title=${encodeURIComponent(title || "")}&format=${encodeURIComponent(format || "")}`,
    };
  }

  const { buffer, contentType } = await fetchDocumentBuffer(safeUrl);
  const kind = inferPreviewKind({ title, format, contentType });

  if (kind === "docx") {
    const result = await mammoth.convertToHtml({ buffer });
    return {
      kind,
      title,
      html: result.value,
      warnings: result.messages?.map((message) => message.message).filter(Boolean) || [],
    };
  }

  if (kind === "xlsx") {
    const rows = await readXlsxFile(buffer);
    return {
      kind,
      title,
      sheets: [
        {
          name: "Sheet 1",
          rows: rows.slice(0, MAX_TABLE_ROWS).map((row) => row.slice(0, MAX_TABLE_COLS)),
        },
      ],
      truncated: rows.length > MAX_TABLE_ROWS || rows.some((row) => row.length > MAX_TABLE_COLS),
    };
  }

  if (kind === "csv") {
    const text = decodeText(buffer);
    const rows = parseCsv(text);
    return {
      kind: "xlsx",
      title,
      sheets: [{ name: "CSV", rows }],
      truncated: text.length >= MAX_TEXT_CHARS || rows.length >= MAX_TABLE_ROWS,
    };
  }

  if (kind === "text") {
    const text = decodeText(buffer);
    return {
      kind,
      title,
      text,
      truncated: buffer.byteLength > Buffer.byteLength(text),
    };
  }

  if (kind === "archive") {
    if (extensionFromTitle(title) !== ".zip" && !contentType.toLocaleLowerCase("en-US").includes("zip")) {
      return {
        kind: "unsupported",
        title,
        message: "Archive preview is currently available for ZIP files only.",
      };
    }

    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.values(zip.files)
      .slice(0, MAX_ARCHIVE_ITEMS)
      .map((entry) => ({
        name: entry.name,
        directory: entry.dir,
        date: entry.date?.toISOString?.() || "",
      }));

    return {
      kind: "archive",
      title,
      entries,
      truncated: Object.keys(zip.files).length > MAX_ARCHIVE_ITEMS,
    };
  }

  return {
    kind: "unsupported",
    title,
    message: "This file type cannot be previewed yet.",
  };
}

async function sendDocumentFile(url, response) {
  const documentUrl = assertAllowedDocumentUrl(url.searchParams.get("url"));
  const title = url.searchParams.get("title") || "document";
  const format = url.searchParams.get("format") || "";
  const { buffer, contentType } = await fetchDocumentBuffer(documentUrl);
  const kind = inferPreviewKind({ title, format, contentType });

  if (kind !== "pdf" && kind !== "image") {
    sendJson(response, 415, { error: "This file type cannot be embedded." });
    return;
  }

  const inlineContentType = inlineContentTypeFor(kind, title, contentType);

  response.writeHead(200, {
    "content-type": inlineContentType,
    "content-length": buffer.byteLength,
    "content-disposition": `inline; filename="${encodeURIComponent(safeFilename(title))}"`,
    "x-content-type-options": "nosniff",
  });
  response.end(buffer);
}

async function resolveTenderId(input) {
  const value = String(input || "").trim();
  if (!value) throw new Error("Tender ID is required.");

  if (UUID_RE.test(value)) {
    const { data } = await fetchJson(`${PUBLIC_API}/${encodeURIComponent(value)}?opt_fields=id,tenderID,title,dateModified,status`);
    return data;
  }

  const summary = await fetchJson(`${PORTAL_API}/${encodeURIComponent(value)}/summary`);
  return {
    id: summary.id,
    tenderID: summary.tenderID,
    title: summary.title,
    dateModified: summary.dateModified,
    status: summary.status,
  };
}

async function analyzeTender(input) {
  const resolved = await resolveTenderId(input);
  if (!resolved?.id) throw new Error("Tender was not found.");

  const [{ data: tender }, rules] = await Promise.all([
    fetchJson(`${PUBLIC_API}/${encodeURIComponent(resolved.id)}`),
    getPriorityRules(),
  ]);

  const documents = dedupeDocuments(collectDocuments(tender))
    .map((document) => rankDocument(document, rules))
    .sort((a, b) => {
      if (b.priority.score !== a.priority.score) return b.priority.score - a.priority.score;
      return String(b.dateModified || "").localeCompare(String(a.dateModified || ""));
    });

  return {
    tender: {
      id: tender.id || resolved.id,
      tenderID: tender.tenderID || resolved.tenderID,
      title: tender.title || resolved.title || "",
      status: tender.status || resolved.status || "",
      dateModified: tender.dateModified || resolved.dateModified || "",
      procurementMethodType: tender.procurementMethodType || "",
      procuringEntity: tender.procuringEntity?.name || tender.procuringEntity?.identifier?.legalName || "",
      value: tender.value || null,
    },
    counts: {
      total: documents.length,
      top: documents.filter((doc) => doc.priority.level === LEVELS.top).length,
      high: documents.filter((doc) => doc.priority.level === LEVELS.high).length,
      low: documents.filter((doc) => doc.priority.level === LEVELS.low).length,
      signatures: documents.filter((doc) => doc.priority.level === LEVELS.signature).length,
    },
    rules,
    documents,
  };
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(publicDir, requestedPath));

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, { "content-type": MIME_TYPES.get(path.extname(filePath)) || "application/octet-stream" });
  createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname.startsWith("/api/analyze/")) {
      const tenderId = decodeURIComponent(url.pathname.replace("/api/analyze/", ""));
      const payload = await analyzeTender(tenderId);
      sendJson(response, 200, payload);
      return;
    }

    if (url.pathname === "/api/rules") {
      if (request.method === "GET") {
        sendJson(response, 200, { rules: await getPriorityRules() });
        return;
      }

      if (request.method === "PUT") {
        const payload = await readRequestJson(request);
        sendJson(response, 200, { rules: await savePriorityRules(payload.rules) });
        return;
      }
    }

    if (request.method === "GET" && url.pathname === "/api/preview") {
      const payload = await buildDocumentPreview({
        documentUrl: url.searchParams.get("url"),
        title: url.searchParams.get("title") || "",
        format: url.searchParams.get("format") || "",
      });
      sendJson(response, 200, payload);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/file") {
      await sendDocumentFile(url, response);
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Unexpected error" });
  }
});

server.listen(PORT, () => {
  console.log(`Prozorro document prioritizer is running at http://localhost:${PORT}`);
});
