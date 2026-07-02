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
const copyLinks = document.querySelector("#copy-links");
const exportJson = document.querySelector("#export-json");
const keywordEditor = document.querySelector("#keyword-editor");
const rulesStatus = document.querySelector("#rules-status");
const undoDelete = document.querySelector("#undo-delete");

let currentData = null;
let currentFilter = "all";
let priorityRules = [];
let lastDeletedKeyword = null;

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
    if (currentFilter === "all") return true;
    return document.priority.level === currentFilter;
  });

  documentsEl.innerHTML = visible.length
    ? visible.map(renderDocument).join("")
    : `<div class="no-results">No files in this priority group.</div>`;
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
        ${document.url ? `<a href="${document.url}" target="_blank" rel="noreferrer">Download</a>` : ""}
      </div>
    </article>
  `;
}

function renderResults(data) {
  currentData = data;
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
    filters.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("active", button.dataset.filter === "all");
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
