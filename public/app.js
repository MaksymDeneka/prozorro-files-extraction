const LEVEL_LABELS = {
  top: "Top",
  high: "High",
  low: "Low",
};

const form = document.querySelector("#search-form");
const input = document.querySelector("#tender-id");
const emptyState = document.querySelector("#empty-state");
const loading = document.querySelector("#loading");
const errorBox = document.querySelector("#error");
const results = document.querySelector("#results");
const resultId = document.querySelector("#result-id");
const resultTitle = document.querySelector("#result-title");
const resultMeta = document.querySelector("#result-meta");
const metrics = document.querySelector("#metrics");
const documentsEl = document.querySelector("#documents");
const filters = document.querySelector("#filters");
const viewFilters = document.querySelector("#view-filters");
const copyLinks = document.querySelector("#copy-links");
const exportJson = document.querySelector("#export-json");
const keywordEditor = document.querySelector("#keyword-editor");
const rulesStatus = document.querySelector("#rules-status");
const undoDelete = document.querySelector("#undo-delete");
const previewPanel = document.querySelector("#preview-panel");
const previewTitle = document.querySelector("#preview-title");
const previewBody = document.querySelector("#preview-body");
const previewClose = document.querySelector("#preview-close");
const previewResizer = document.querySelector("#preview-resizer");
const previewNarrower = document.querySelector("#preview-narrower");
const previewWider = document.querySelector("#preview-wider");

let currentData = null;
let currentFilter = "all";
let currentViewFilter = "all";
let priorityRules = [];
let lastDeletedKeyword = null;
const PREVIEW_WIDTH_KEY = "prozorro.previewWidth";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".tif", ".tiff"]);

function setBusy(isBusy) {
  loading.classList.toggle("hidden", !isBusy);
  form.querySelector("button").disabled = isBusy;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function hideError() {
  errorBox.textContent = "";
  errorBox.classList.add("hidden");
}

function setRulesStatus(message, tone = "") {
  rulesStatus.textContent = message;
  rulesStatus.className = tone;
}

function setUndoState() {
  undoDelete.disabled = !lastDeletedKeyword;
}

function clampPreviewWidth(width) {
  const maxWidth = Math.max(640, window.innerWidth - 48);
  return Math.min(Math.max(640, width), maxWidth);
}

function applyPreviewWidth(width) {
  if (window.innerWidth <= 900) {
    previewPanel.style.width = "";
    return;
  }

  previewPanel.style.width = `${clampPreviewWidth(width)}px`;
}

function currentPreviewWidth() {
  return previewPanel.getBoundingClientRect().width || Math.min(1040, window.innerWidth - 48);
}

function loadPreviewWidth() {
  const saved = Number(localStorage.getItem(PREVIEW_WIDTH_KEY));
  applyPreviewWidth(Number.isFinite(saved) && saved > 0 ? saved : Math.min(1040, window.innerWidth - 48));
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("uk-UA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatMoney(value) {
  if (!value?.amount) return "";
  return new Intl.NumberFormat("uk-UA", {
    style: "currency",
    currency: value.currency || "UAH",
    maximumFractionDigits: 2,
  }).format(value.amount);
}

function priorityClass(level) {
  if (level === "Найвищий") return "priority-top";
  if (level === "Високий") return "priority-high";
  if (level === "Низький") return "priority-low";
  if (level === "Підпис") return "priority-sign";
  return "priority-mid";
}

function extensionFromTitle(title) {
  const match = String(title || "")
    .split("?")[0]
    .toLocaleLowerCase("en-US")
    .match(/\.[a-z0-9]+$/);
  return match ? match[0] : "";
}

function isImageDocument(document) {
  const mime = String(document.format || "").toLocaleLowerCase("en-US");
  return mime.startsWith("image/") || IMAGE_EXTENSIONS.has(extensionFromTitle(document.title));
}

function renderKeywordEditor() {
  keywordEditor.innerHTML = priorityRules
    .map(
      (rule) => `
        <section class="keyword-group" data-rule-id="${rule.id}">
          <div class="keyword-title">
            <strong>${LEVEL_LABELS[rule.id] || rule.name}</strong>
            <span>${rule.keywords.length}</span>
          </div>
          <div class="keyword-list">
            ${rule.keywords
              .map(
                (keyword) => `
                  <span class="keyword-chip">
                    <span>${escapeHtml(keyword)}</span>
                    <button
                      type="button"
                      class="keyword-remove"
                      data-remove-keyword="${escapeHtml(keyword)}"
                      aria-label="Remove ${escapeHtml(keyword)}"
                    >×</button>
                  </span>
                `,
              )
              .join("")}
          </div>
          <form class="keyword-add">
            <input aria-label="Add ${LEVEL_LABELS[rule.id] || rule.name} keyword" placeholder="Add keyword" />
            <button type="submit">Add</button>
          </form>
        </section>
      `,
    )
    .join("");
}

function renderMetrics(data) {
  const rows = [
    ["Total", data.counts.total],
    ["Images", data.documents.filter(isImageDocument).length],
    ["Top", data.counts.top],
    ["High", data.counts.high],
    ["Low", data.counts.low],
  ];

  metrics.innerHTML = rows
    .map(
      ([label, value]) => `
        <div class="metric">
          <span>${label}</span>
          <strong>${value}</strong>
        </div>
      `,
    )
    .join("");
}

function renderDocuments() {
  if (!currentData) return;

  const visible = currentData.documents.filter((document) => {
    const matchesView = currentViewFilter === "all" || (currentViewFilter === "images" && isImageDocument(document));
    const matchesPriority = currentFilter === "all" || document.priority.level === currentFilter;
    return matchesView && matchesPriority;
  });

  documentsEl.innerHTML = visible.length
    ? visible.map(renderDocument).join("")
    : `<div class="no-results">${currentViewFilter === "images" ? "No images match the current filters." : "No files match the current filters."}</div>`;
}

function renderDocument(document, index) {
  const reasons = document.priority.reasons.map((reason) => `<span>${escapeHtml(reason)}</span>`).join("");
  const date = formatDate(document.dateModified || document.datePublished);
  const type = [document.format, document.documentType].filter(Boolean).join(" / ");

  return `
    <article class="document ${priorityClass(document.priority.level)}">
      <div class="rank">${index + 1}</div>
      <div class="doc-main">
        <div class="doc-topline">
          <span class="badge">${document.priority.level}</span>
          <span class="score">${document.priority.score}</span>
          ${document.source ? `<span class="source">${escapeHtml(document.source)}</span>` : ""}
        </div>
        <h3>${escapeHtml(document.title)}</h3>
        <div class="reasons">${reasons}</div>
        <p>${[type, date].filter(Boolean).join(" • ")}</p>
      </div>
      <div class="doc-actions">
        ${document.url ? `<button type="button" data-preview-key="${document.previewKey}">Preview</button>` : ""}
        ${document.url ? `<a href="${document.url}" target="_blank" rel="noreferrer">Download</a>` : ""}
      </div>
    </article>
  `;
}

function renderResults(data) {
  currentData = {
    ...data,
    documents: data.documents.map((document, index) => ({ ...document, previewKey: String(index) })),
  };
  resultId.textContent = data.tender.tenderID || data.tender.id;
  resultTitle.textContent = data.tender.title || "Untitled tender";
  resultMeta.textContent = [
    data.tender.procuringEntity,
    data.tender.status,
    formatMoney(data.tender.value),
    formatDate(data.tender.dateModified),
  ]
    .filter(Boolean)
    .join(" • ");

  renderMetrics(data);
  renderDocuments();

  emptyState.classList.add("hidden");
  results.classList.remove("hidden");
}

async function loadRules() {
  const response = await fetch("/api/rules");
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "Could not load keyword rules.");
  priorityRules = data.rules;
  lastDeletedKeyword = null;
  renderKeywordEditor();
  setUndoState();
  setRulesStatus("Saved", "saved");
}

async function persistKeywordRules() {
  setRulesStatus("Saving", "");
  const response = await fetch("/api/rules", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rules: priorityRules }),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "Could not save keyword rules.");
  priorityRules = data.rules;
  renderKeywordEditor();
  setUndoState();
  setRulesStatus("Saved", "saved");

  if (currentData && input.value.trim()) {
    await analyzeCurrentTender();
  }
}

async function saveRulesAfterEdit() {
  try {
    await persistKeywordRules();
  } catch (error) {
    setRulesStatus("Error", "error-text");
    showError(error.message || "Could not save keyword rules.");
  }
}

async function analyzeCurrentTender() {
  hideError();
  results.classList.add("hidden");
  setBusy(true);

  try {
    const tenderId = input.value.trim();
    const response = await fetch(`/api/analyze/${encodeURIComponent(tenderId)}`);
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "Request failed.");
    currentFilter = "all";
    currentViewFilter = "all";
    filters.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("active", button.dataset.filter === "all");
    });
    viewFilters.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("active", button.dataset.viewFilter === "all");
    });
    renderResults(data);
  } catch (error) {
    emptyState.classList.remove("hidden");
    showError(error.message || "Could not analyze this tender.");
  } finally {
    setBusy(false);
  }
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sanitizePreviewHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const blocked = template.content.querySelectorAll("script, style, iframe, object, embed, link, meta");
  blocked.forEach((node) => node.remove());
  template.content.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLocaleLowerCase("en-US");
      const value = attribute.value.trim().toLocaleLowerCase("en-US");
      if (name.startsWith("on") || (["href", "src"].includes(name) && value.startsWith("javascript:"))) {
        node.removeAttribute(attribute.name);
      }
    });
  });
  return template.innerHTML;
}

function showPreviewLoading(document) {
  previewTitle.textContent = document.title || "Document preview";
  previewBody.innerHTML = `
    <div class="preview-state">
      <div class="pulse"></div>
      <span>Loading preview</span>
    </div>
  `;
  loadPreviewWidth();
  previewPanel.classList.remove("hidden");
}

function renderPreviewTable(sheet) {
  const rows = sheet.rows || [];
  if (!rows.length) return `<div class="preview-state">No rows found.</div>`;

  return `
    <section class="preview-sheet">
      <h3>${escapeHtml(sheet.name || "Sheet")}</h3>
      <div class="table-wrap">
        <table>
          <tbody>
            ${rows
              .map(
                (row) => `
                  <tr>
                    ${row.map((cell) => `<td>${escapeHtml(cell ?? "")}</td>`).join("")}
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderPreview(payload) {
  previewTitle.textContent = payload.title || "Document preview";

  if (payload.kind === "pdf") {
    previewBody.innerHTML = `<iframe class="preview-frame" src="${payload.fileUrl}" title="PDF preview"></iframe>`;
    return;
  }

  if (payload.kind === "image") {
    previewBody.innerHTML = `<div class="preview-image-wrap"><img src="${payload.fileUrl}" alt="Document preview" /></div>`;
    return;
  }

  if (payload.kind === "docx" || payload.kind === "rtf") {
    previewBody.innerHTML = `
      <article class="preview-docx">${sanitizePreviewHtml(payload.html || "")}</article>
      ${payload.warnings?.length ? `<div class="preview-note">${payload.warnings.map(escapeHtml).join("<br>")}</div>` : ""}
    `;
    return;
  }

  if (payload.kind === "xlsx") {
    previewBody.innerHTML = `
      ${(payload.sheets || []).map(renderPreviewTable).join("")}
    `;
    return;
  }

  if (payload.kind === "text") {
    previewBody.innerHTML = `
      <pre class="preview-text">${escapeHtml(payload.text || "")}</pre>
    `;
    return;
  }

  if (payload.kind === "archive") {
    previewBody.innerHTML = `
      <ul class="archive-list">
        ${(payload.entries || [])
          .map((entry) => `<li><span>${entry.directory ? "Folder" : "File"}</span>${escapeHtml(entry.name)}</li>`)
          .join("")}
      </ul>
    `;
    return;
  }

  previewBody.innerHTML = `<div class="preview-state">${escapeHtml(payload.message || "Preview is not available for this file type.")}</div>`;
}

async function openPreview(document) {
  if (!document?.url) return;
  hideError();
  showPreviewLoading(document);

  try {
    const params = new URLSearchParams({
      url: document.url,
      title: document.title || "",
      format: document.format || "",
    });
    const response = await fetch(`/api/preview?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || "Could not load preview.");
    renderPreview(payload);
  } catch (error) {
    previewBody.innerHTML = `<div class="preview-state">${escapeHtml(error.message || "Could not load preview.")}</div>`;
  }
}

function closePreview() {
  previewPanel.classList.add("hidden");
  previewTitle.textContent = "Document preview";
  previewBody.innerHTML = "";
}

keywordEditor.addEventListener("submit", async (event) => {
  const formEl = event.target.closest(".keyword-add");
  if (!formEl) return;

  event.preventDefault();
  const group = formEl.closest(".keyword-group");
  const rule = priorityRules.find((item) => item.id === group.dataset.ruleId);
  const inputEl = formEl.querySelector("input");
  const keyword = inputEl.value.trim();

  if (!rule || !keyword || rule.keywords.some((item) => item.toLocaleLowerCase("uk-UA") === keyword.toLocaleLowerCase("uk-UA"))) return;
  rule.keywords.push(keyword);
  lastDeletedKeyword = null;
  inputEl.value = "";
  renderKeywordEditor();
  setUndoState();
  await saveRulesAfterEdit();
});

keywordEditor.addEventListener("click", async (event) => {
  const button = event.target.closest(".keyword-remove[data-remove-keyword]");
  if (!button) return;

  const group = button.closest(".keyword-group");
  const rule = priorityRules.find((item) => item.id === group.dataset.ruleId);
  if (!rule) return;

  const keyword = button.dataset.removeKeyword;
  const index = rule.keywords.indexOf(keyword);
  if (index === -1) return;

  lastDeletedKeyword = {
    ruleId: rule.id,
    keyword,
    index,
  };
  rule.keywords.splice(index, 1);
  renderKeywordEditor();
  setUndoState();
  await saveRulesAfterEdit();
});

undoDelete.addEventListener("click", async () => {
  if (!lastDeletedKeyword) return;

  const { ruleId, keyword, index } = lastDeletedKeyword;
  const rule = priorityRules.find((item) => item.id === ruleId);
  if (!rule || rule.keywords.some((item) => item.toLocaleLowerCase("uk-UA") === keyword.toLocaleLowerCase("uk-UA"))) {
    lastDeletedKeyword = null;
    setUndoState();
    return;
  }

  rule.keywords.splice(Math.min(index, rule.keywords.length), 0, keyword);
  lastDeletedKeyword = null;
  renderKeywordEditor();
  setUndoState();
  await saveRulesAfterEdit();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await analyzeCurrentTender();
});

filters.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-filter]");
  if (!button) return;
  currentFilter = button.dataset.filter;
  filters.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
  renderDocuments();
});

viewFilters.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view-filter]");
  if (!button) return;
  currentViewFilter = button.dataset.viewFilter;
  viewFilters.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
  renderDocuments();
});

documentsEl.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-preview-key]");
  if (!button || !currentData) return;
  const document = currentData.documents.find((item) => item.previewKey === button.dataset.previewKey);
  await openPreview(document);
});

previewClose.addEventListener("click", closePreview);

previewNarrower.addEventListener("click", () => {
  const width = clampPreviewWidth(currentPreviewWidth() - 160);
  previewPanel.style.width = `${width}px`;
  localStorage.setItem(PREVIEW_WIDTH_KEY, String(width));
});

previewWider.addEventListener("click", () => {
  const width = clampPreviewWidth(currentPreviewWidth() + 160);
  previewPanel.style.width = `${width}px`;
  localStorage.setItem(PREVIEW_WIDTH_KEY, String(width));
});

function updatePreviewWidthFromClientX(clientX) {
  const width = clampPreviewWidth(window.innerWidth - clientX - 24);
  previewPanel.style.width = `${width}px`;
  localStorage.setItem(PREVIEW_WIDTH_KEY, String(width));
}

function beginPreviewResize(event, moveEventName, upEventName) {
  if (window.innerWidth <= 900) return;

  event.preventDefault();
  document.body.classList.add("preview-resizing");

  const handleMove = (moveEvent) => {
    updatePreviewWidthFromClientX(moveEvent.clientX);
  };

  const handleUp = () => {
    document.body.classList.remove("preview-resizing");
    document.removeEventListener(moveEventName, handleMove);
    document.removeEventListener(upEventName, handleUp);
    document.removeEventListener("pointercancel", handleUp);
  };

  document.addEventListener(moveEventName, handleMove);
  document.addEventListener(upEventName, handleUp);
  document.addEventListener("pointercancel", handleUp);
}

previewResizer.addEventListener("pointerdown", (event) => {
  previewResizer.setPointerCapture(event.pointerId);
  beginPreviewResize(event, "pointermove", "pointerup");
});

previewResizer.addEventListener("mousedown", (event) => {
  beginPreviewResize(event, "mousemove", "mouseup");
});

window.addEventListener("resize", () => {
  if (!previewPanel.classList.contains("hidden")) loadPreviewWidth();
});

copyLinks.addEventListener("click", async () => {
  if (!currentData) return;
  const links = currentData.documents
    .filter((document) => document.url)
    .map((document) => `${document.priority.level}\t${document.title}\t${document.url}`)
    .join("\n");
  await navigator.clipboard.writeText(links);
  copyLinks.textContent = "Copied";
  setTimeout(() => {
    copyLinks.textContent = "Copy links";
  }, 1200);
});

exportJson.addEventListener("click", () => {
  if (!currentData) return;
  downloadText(`${currentData.tender.tenderID || currentData.tender.id}-documents.json`, JSON.stringify(currentData, null, 2));
});

loadRules().catch((error) => showError(error.message || "Could not load keyword rules."));
