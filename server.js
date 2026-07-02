import http from "node:http";
import { readFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 3477);

const PORTAL_API = "https://prozorro.gov.ua/api/tenders";
const PUBLIC_API = "https://public-api.prozorro.gov.ua/api/2.5/tenders";
const UUID_RE = /^[a-f0-9]{32}$/i;

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

const PRIORITY_RULES = [
  {
    level: "Найвищий",
    score: 100,
    label: "Технічний опис",
    patterns: [
      /\bтехн\w*\s+опис\w*\b/u,
      /\bопис\w*\s+техн\w*\b/u,
      /\bтех\s*опис\w*\b/u,
    ],
  },
  {
    level: "Високий",
    score: 72,
    label: "Додаток 2",
    patterns: [
      /\bдодат\w*\s*(?:n|no|№)?\s*0?2\b/u,
      /\bдод\.\s*(?:n|no|№)?\s*0?2\b/u,
      /\bappendix\s*0?2\b/u,
    ],
  },
  {
    level: "Високий",
    score: 70,
    label: "Технічна специфікація",
    patterns: [
      /\bтехн\w*\s+специф\w*\b/u,
      /\bспециф\w*\s+техн\w*\b/u,
      /\bтех\s*специф\w*\b/u,
      /\bтехн\w*\s+завдан\w*\b/u,
      /\bтз\b/u,
    ],
  },
  {
    level: "Високий",
    score: 68,
    label: "Відомість ресурсів",
    patterns: [
      /\bвідом\w*\s+ресурс\w*\b/u,
      /\bресурс\w*\s+відом\w*\b/u,
      /\bресурсн\w*\s+відом\w*\b/u,
    ],
  },
  {
    level: "Високий",
    score: 66,
    label: "Кошторис",
    patterns: [
      /\bкошторис\w*\b/u,
      /\bлокальн\w*\s+кошторис\w*\b/u,
      /\bпроектн\w*\s+кошторис\w*\b/u,
      /\bдефектн\w*\s+акт\w*\b/u,
      /\bобсяг\w*\s+робіт\b/u,
    ],
  },
  {
    level: "Низький",
    score: 12,
    label: "Договір / критерії / гарантія / довідка",
    patterns: [
      /\bдоговор\w*\b/u,
      /\bдоговір\w*\b/u,
      /\bконтракт\w*\b/u,
      /\bкритер\w*\b/u,
      /\bбанк\w*\s+гарант\w*\b/u,
      /\bгарант\w*\s+лист\w*\b/u,
      /\bдовідк\w*\b/u,
      /\bпротокол\w*\b/u,
    ],
  },
];

const DOCUMENT_TYPE_RULES = new Map([
  ["technicalSpecifications", { score: 64, level: "Високий", label: "documentType: technicalSpecifications" }],
  ["contractProforma", { score: 14, level: "Низький", label: "documentType: contractProforma" }],
  ["contractSigned", { score: 10, level: "Низький", label: "documentType: contractSigned" }],
  ["awardCriteria", { score: 12, level: "Низький", label: "documentType: awardCriteria" }],
]);

function normalizeTitle(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("uk-UA")
    .replace(/[’'`]/g, "")
    .replace(/[_\-–—.,;:()[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rankDocument(document) {
  const title = normalizeTitle(document.title);
  const matches = [];
  let score = 32;
  let level = "Середній";

  for (const rule of PRIORITY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(title))) {
      matches.push(rule.label);
      if (rule.score > score) {
        score = rule.score;
        level = rule.level;
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
    level = "Підпис";
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

  const { data: tender } = await fetchJson(`${PUBLIC_API}/${encodeURIComponent(resolved.id)}`);
  const documents = dedupeDocuments(collectDocuments(tender))
    .map(rankDocument)
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
      top: documents.filter((doc) => doc.priority.level === "Найвищий").length,
      high: documents.filter((doc) => doc.priority.level === "Високий").length,
      low: documents.filter((doc) => doc.priority.level === "Низький").length,
      signatures: documents.filter((doc) => doc.priority.level === "Підпис").length,
    },
    documents,
  };
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

    if (url.pathname.startsWith("/api/analyze/")) {
      const tenderId = decodeURIComponent(url.pathname.replace("/api/analyze/", ""));
      const payload = await analyzeTender(tenderId);
      sendJson(response, 200, payload);
      return;
    }

    if (url.pathname === "/api/rules") {
      sendJson(response, 200, {
        rules: PRIORITY_RULES.map(({ level, score, label }) => ({ level, score, label })),
      });
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
