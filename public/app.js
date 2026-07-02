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

let currentData = null;
let currentFilter = "all";

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
  const reasons = document.priority.reasons.map((reason) => `<span>${reason}</span>`).join("");
  const date = formatDate(document.dateModified || document.datePublished);
  const type = [document.format, document.documentType].filter(Boolean).join(" / ");

  return `
    <article class="document ${priorityClass(document.priority.level)}">
      <div class="rank">${index + 1}</div>
      <div class="doc-main">
        <div class="doc-topline">
          <span class="badge">${document.priority.level}</span>
          <span class="score">${document.priority.score}</span>
          ${document.source ? `<span class="source">${document.source}</span>` : ""}
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
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
