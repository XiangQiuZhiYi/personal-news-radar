import {
  buildContinuousSpeechQueue,
  buildSingleSpeechQueue,
  SpeechController
} from "./speech.js";

const feed = document.querySelector("#feed");
const filters = document.querySelector("#filters");
const brief = document.querySelector("#brief");
const briefLabel = document.querySelector("#brief-label");
const stats = document.querySelector("#stats");
const errors = document.querySelector("#errors");
const errorMessage = document.querySelector("#error-message");
const errorClose = document.querySelector("#error-close");
const updatedAt = document.querySelector("#updated-at");
const refreshButton = document.querySelector("#refresh-button");
const refreshStatus = document.querySelector("#refresh-status");
const views = document.querySelector("#views");
const historyBrowser = document.querySelector("#history-browser");
const historyList = document.querySelector("#history-list");
const speechPlay = document.querySelector("#speech-play");
const speechPause = document.querySelector("#speech-pause");
const speechStop = document.querySelector("#speech-stop");
const speechRate = document.querySelector("#speech-rate");
const speechStatus = document.querySelector("#speech-status");

let digest = { items: [] };
let activeCategory = "全部";
let activeView = "today";
let activeDate = null;
let previousRefreshState = null;
let highlightedItemId = null;

function visibleItems() {
  const items = digest.items ?? [];
  return activeCategory === "全部" ? items : items.filter((item) => item.category === activeCategory);
}

function highlightSpeakingItem(itemId) {
  if (highlightedItemId === itemId) return;
  highlightedItemId = itemId ?? null;
  for (const card of feed.querySelectorAll(".card.speaking")) card.classList.remove("speaking");
  if (!itemId) return;
  const card = [...feed.querySelectorAll(".card[data-item-id]")]
    .find((element) => element.dataset.itemId === String(itemId));
  if (!card) return;
  card.classList.add("speaking");
  card.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderSpeechState(state) {
  const active = ["preparing", "playing", "paused"].includes(state.status);
  speechPlay.disabled = !state.supported || visibleItems().length === 0;
  speechPause.disabled = !["playing", "paused"].includes(state.status);
  speechPause.textContent = state.status === "paused" ? "继续" : "暂停";
  speechStop.disabled = !active;
  speechRate.disabled = !state.supported;

  if (!state.supported) {
    speechStatus.textContent = "当前浏览器不支持语音朗读。";
    highlightSpeakingItem(null);
    return;
  }
  if (state.status === "preparing") speechStatus.textContent = "正在准备播放……";
  else if (state.status === "playing" && state.entry?.kind === "brief") speechStatus.textContent = "正在播报今日概览。";
  else if (state.status === "playing" && state.entry?.mode === "single") speechStatus.textContent = "正在朗读本条信息。";
  else if (state.status === "playing") speechStatus.textContent = `正在播报第 ${state.entry.itemIndex + 1}/${state.entry.itemTotal} 条。`;
  else if (state.status === "paused") speechStatus.textContent = "播报已暂停。";
  else if (state.status === "completed") speechStatus.textContent = state.warning ? `播放完成，${state.warning}。` : "播放完成。";
  else if (state.status === "error") speechStatus.textContent = state.error ?? "播放失败。";
  else if (state.status === "stopped") speechStatus.textContent = "播报已停止。";
  else speechStatus.textContent = "准备播放。";

  if (state.status === "preparing") highlightSpeakingItem(null);
  else if (["playing", "paused"].includes(state.status)) highlightSpeakingItem(state.entry?.itemId);
  else if (!active) highlightSpeakingItem(null);
}

const speechController = new SpeechController({ onStateChange: renderSpeechState });

function escapeHtml(value = "") {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;"
  })[character]);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "#";
  } catch {
    return "#";
  }
}

function showError(message) {
  errorMessage.textContent = message;
  errors.hidden = false;
}

function clearError() {
  errors.hidden = true;
  errorMessage.textContent = "";
}

function renderFilters() {
  const categories = ["全部", ...new Set((digest.items ?? []).map((item) => item.category))];
  filters.innerHTML = categories.map((category) => `
    <button class="filter ${category === activeCategory ? "active" : ""}" data-category="${escapeHtml(category)}">
      ${escapeHtml(category)}
    </button>
  `).join("");
}

function stringList(value) {
  return Array.isArray(value) ? value.map((entry) => String(entry ?? "").trim()).filter(Boolean) : [];
}

function renderImpact(item) {
  const overview = String(item.impactForPeople ?? "").trim();
  const analysis = item.impactAnalysis && typeof item.impactAnalysis === "object"
    ? item.impactAnalysis
    : null;
  if (!overview && !analysis) return "";

  const groups = stringList(analysis?.affectedGroups);
  const actions = stringList(analysis?.actions);
  const directionClasses = {
    "有利": "positive",
    "不利": "negative",
    "分化": "split",
    "当前不变": "neutral"
  };
  const direction = String(analysis?.direction ?? "").trim();
  const directionClass = directionClasses[direction] ?? "neutral";
  const changeStatement = String(analysis?.changeStatement ?? "").trim();
  const detailRows = analysis ? [
    ["影响程度", analysis.impactLevel],
    ["影响路径", analysis.impactPath],
    ["短期变化", analysis.shortTerm],
    ["中长期变化", analysis.mediumLongTerm],
    ["仍需确认", analysis.uncertainties]
  ].filter(([, value]) => String(value ?? "").trim()) : [];

  return `<section class="impact">
    <div class="impact-heading">
      <strong class="impact-title">对普通人的影响</strong>
      ${direction ? `<span class="impact-direction ${directionClass}">${escapeHtml(direction)}</span>` : ""}
    </div>
    ${changeStatement ? `<div class="impact-change"><span>变化结论</span><p>${escapeHtml(changeStatement)}</p></div>` : ""}
    ${overview ? `<p class="impact-overview">${escapeHtml(overview)}</p>` : ""}
    ${groups.length ? `<div class="impact-section"><span>更可能受影响的人</span><div class="impact-groups">${groups.map((group) => `<em>${escapeHtml(group)}</em>`).join("")}</div></div>` : ""}
    ${detailRows.length ? `<dl class="impact-details">${detailRows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>` : ""}
    ${actions.length ? `<div class="impact-section impact-actions"><span>现在可以做什么</span><ul>${actions.map((action) => `<li>${escapeHtml(action)}</li>`).join("")}</ul></div>` : ""}
  </section>`;
}

function renderFeed() {
  const items = visibleItems();
  if (items.length === 0) {
    feed.innerHTML = '<div class="empty">这个分类没有收录内容。</div>';
    return;
  }
  feed.innerHTML = items.map((item) => `
    <article class="card" data-item-id="${escapeHtml(item.id ?? item.url)}">
      <div class="card-top">
        <span class="badge ${item.importance === "必读" ? "must" : ""}">${escapeHtml(item.importance)}</span>
        <span>${escapeHtml(item.category)}</span>
        <span>·</span>
        <span>${item.region === "international" ? "国际" : "国内"}</span>
        <span>·</span>
        <span>${Number(item.score) || 0} 分</span>
        <span>·</span>
        <span>${escapeHtml(item.source)}</span>
        <button class="speak-item" type="button" data-speak-item="${escapeHtml(item.id ?? item.url)}" ${speechController.supported ? "" : "disabled"}>朗读本条</button>
      </div>
      <h2><a href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></h2>
      <p class="summary">${escapeHtml(item.summary)}</p>
      <div class="why"><strong>为什么值得看</strong>${escapeHtml(item.whyItMatters)}</div>
      ${renderImpact(item)}
      <div class="topics">${(item.topics ?? []).map((topic) => `<span class="topic">#${escapeHtml(topic)}</span>`).join("")}</div>
    </article>
  `).join("");
}

function renderStats() {
  if (digest.version === 2) {
    stats.innerHTML = [
      `${digest.stats?.totalItems ?? digest.items?.length ?? 0} 条累计`,
      `国内 ${digest.stats?.domesticItems ?? 0} 条`,
      `国际 ${digest.stats?.internationalItems ?? 0} 条`,
      `当日整理 ${digest.stats?.refreshCount ?? 0} 次`
    ].map((value) => `<span>${escapeHtml(value)}</span>`).join("");
    return;
  }
  stats.innerHTML = [
    `${digest.stats?.sources ?? 0} 个信息源`,
    `${digest.stats?.candidates ?? 0} 条候选`,
    `精选 ${digest.stats?.selected ?? digest.items?.length ?? 0} 条`,
    `国内 ${digest.stats?.domesticSelected ?? 0} 条`
  ].map((value) => `<span>${escapeHtml(value)}</span>`).join("");
}

function renderDigest(nextDigest, { historical = false } = {}) {
  speechController.stop({ silent: true });
  highlightSpeakingItem(null);
  digest = nextDigest;
  activeCategory = "全部";
  briefLabel.textContent = historical
    ? `${digest.date} 历史记录 · 最近一次整理概览`
    : "最近一次整理概览";
  brief.textContent = digest.brief || "这次整理没有生成概览。";
  renderStats();
  const timestamp = digest.updatedAt ?? digest.generatedAt;
  updatedAt.textContent = timestamp
    ? `${historical ? "记录更新于" : "生成于"} ${new Date(timestamp).toLocaleString("zh-CN")}`
    : "";
  if (digest.sourceErrors?.length) {
    showError(`${digest.sourceErrors.length} 个信息源最近一次采集失败，不影响其他来源的简报。`);
  }
  renderFilters();
  renderFeed();
  renderSpeechState(speechController.snapshot());
}

async function fetchJson(url, options) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function loadToday() {
  try {
    const nextDigest = await fetchJson("./data/latest.json");
    renderDigest(nextDigest);
  } catch (error) {
    brief.textContent = "今天的简报尚未生成。请点击“获取最新消息”。";
    stats.innerHTML = "";
    filters.innerHTML = "";
    feed.innerHTML = `<div class="empty">读取失败：${escapeHtml(error.message)}</div>`;
  }
}

function updateLocation() {
  const url = new URL(location.href);
  if (activeView === "history") {
    url.searchParams.set("view", "history");
    if (activeDate) url.searchParams.set("date", activeDate);
    else url.searchParams.delete("date");
  } else {
    url.searchParams.delete("view");
    url.searchParams.delete("date");
  }
  history.replaceState(null, "", url);
}

function renderHistoryButtons(entries) {
  if (entries.length === 0) {
    historyList.innerHTML = '<div class="empty">还没有可查看的历史记录。</div>';
    return;
  }
  historyList.innerHTML = entries.map((entry) => `
    <button type="button" class="history-date ${entry.date === activeDate ? "active" : ""}" data-date="${entry.date}">
      <strong>${entry.date}</strong>
      <span>${entry.totalItems} 条 · ${entry.refreshCount} 次整理</span>
    </button>
  `).join("");
}

async function loadHistory(selectedDate = activeDate) {
  try {
    const history = await fetchJson("./api/history");
    if (history.errors?.length) showError(`${history.errors.length} 个历史文件无法读取。`);
    const entries = history.dates ?? [];
    activeDate = entries.some((entry) => entry.date === selectedDate) ? selectedDate : entries[0]?.date ?? null;
    renderHistoryButtons(entries);
    updateLocation();
    if (!activeDate) {
      renderDigest({ version: 2, date: "", brief: "还没有历史记录。", stats: {}, items: [] }, { historical: true });
      return;
    }
    const historicalDigest = await fetchJson(`./api/history/${encodeURIComponent(activeDate)}`);
    renderDigest(historicalDigest, { historical: true });
    renderHistoryButtons(entries);
  } catch (error) {
    showError(`历史记录读取失败：${error.message}`);
  }
}

async function setView(view, selectedDate = null) {
  speechController.stop();
  activeView = view === "history" ? "history" : "today";
  activeDate = activeView === "history" ? selectedDate : null;
  for (const button of views.querySelectorAll("[data-view]")) {
    button.classList.toggle("active", button.dataset.view === activeView);
  }
  historyBrowser.hidden = activeView !== "history";
  updateLocation();
  if (activeView === "history") await loadHistory(activeDate);
  else await loadToday();
}

function renderRefreshStatus(status) {
  const remainingMinutes = Math.max(1, Math.ceil((status.cooldownRemainingMs ?? 0) / 60000));
  if (status.status === "running") {
    const phases = { collecting: "正在获取信息", analyzing: "Codex 正在整理", saving: "正在保存结果" };
    refreshButton.disabled = true;
    refreshButton.textContent = "整理中…";
    refreshStatus.textContent = `${phases[status.phase] ?? "正在整理"}，可能需要几分钟。`;
    return;
  }
  if ((status.cooldownRemainingMs ?? 0) > 0) {
    refreshButton.disabled = true;
    refreshButton.textContent = `${remainingMinutes} 分钟后可刷新`;
  } else {
    refreshButton.disabled = false;
    refreshButton.textContent = "获取最新消息";
  }
  refreshStatus.textContent = status.status === "error" && status.error
    ? `最近一次整理失败：${status.error}，可以立即重试。`
    : "每次成功整理后需等待 30 分钟。";
}

async function checkRefreshStatus() {
  try {
    const status = await fetchJson("./api/refresh/status");
    const completed = previousRefreshState === "running" && status.status === "success";
    previousRefreshState = status.status;
    renderRefreshStatus(status);
    if (completed) {
      clearError();
      if (activeView === "today") await loadToday();
      else await loadHistory(activeDate);
    } else if (status.status === "error" && status.error) {
      showError(`整理失败：${status.error}`);
    }
  } catch (error) {
    refreshButton.disabled = true;
    refreshStatus.textContent = "无法连接本机 Node 服务。";
  }
}

refreshButton.addEventListener("click", async () => {
  clearError();
  refreshButton.disabled = true;
  refreshButton.textContent = "正在启动…";
  try {
    const status = await fetchJson("./api/refresh", { method: "POST" });
    previousRefreshState = status.status;
    renderRefreshStatus(status);
  } catch (error) {
    if (error.body?.status) renderRefreshStatus(error.body);
    else showError(`无法启动整理：${error.message}`);
    await checkRefreshStatus();
  }
});

speechPlay.addEventListener("click", () => {
  speechController.setRate(speechRate.value);
  speechController.play(buildContinuousSpeechQueue({ brief: digest.brief, items: visibleItems() }));
});

speechPause.addEventListener("click", () => {
  if (speechController.status === "paused") speechController.resume();
  else speechController.pause();
});

speechStop.addEventListener("click", () => speechController.stop());
speechRate.addEventListener("change", () => speechController.setRate(speechRate.value));

filters.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-category]");
  if (!button) return;
  speechController.stop();
  activeCategory = button.dataset.category;
  renderFilters();
  renderFeed();
  renderSpeechState(speechController.snapshot());
});

feed.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-speak-item]");
  if (!button) return;
  const item = (digest.items ?? []).find((entry) => String(entry.id ?? entry.url) === button.dataset.speakItem);
  if (!item) return;
  speechController.setRate(speechRate.value);
  speechController.play(buildSingleSpeechQueue(item));
});

views.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");
  if (button) setView(button.dataset.view);
});

historyList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-date]");
  if (button) {
    speechController.stop();
    loadHistory(button.dataset.date);
  }
});

errorClose.addEventListener("click", clearError);
window.addEventListener("popstate", () => {
  const params = new URLSearchParams(location.search);
  setView(params.get("view"), params.get("date"));
});

const params = new URLSearchParams(location.search);
await setView(params.get("view"), params.get("date"));
await checkRefreshStatus();
setInterval(checkRefreshStatus, 2000);
renderSpeechState(speechController.snapshot());
window.addEventListener("pagehide", () => speechController.stop({ silent: true }));

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js");
}
