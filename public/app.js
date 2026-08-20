import {
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
let digest = { items: [] };
let activeCategory = "全部";
let activeView = "today";
let activeDate = null;
let previousRefreshState = null;
let highlightedItemId = null;
let activeSpeechItemId = null;
const favoriteIds = new Set();
const cardRates = new Map();
const followedCities = ["杭州", "衢州", "伊春"];

function visibleItems() {
  const items = digest.items ?? [];
  if (activeView === "cities") {
    const cityItems = items.filter((item) => item.city);
    return activeCategory === "全部" ? cityItems : cityItems.filter((item) => item.city === activeCategory);
  }
  const viewItems = activeView === "today" ? items.filter((item) => !item.city) : items;
  return activeCategory === "全部" ? viewItems : viewItems.filter((item) => item.category === activeCategory);
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
  if (!active && !["error"].includes(state.status)) activeSpeechItemId = null;
  const currentId = String(state.entry?.itemId ?? activeSpeechItemId ?? "");
  for (const card of feed.querySelectorAll(".card[data-item-id]")) {
    const itemId = card.dataset.itemId;
    const isCurrent = active && itemId === currentId;
    const play = card.querySelector("[data-speak-item]");
    const stop = card.querySelector("[data-stop-item]");
    const rate = card.querySelector("[data-rate-item]");
    const status = card.querySelector("[data-card-speech-status]");
    if (play) play.disabled = !state.supported || isCurrent;
    if (stop) stop.disabled = !isCurrent;
    if (rate) rate.disabled = !state.supported;
    if (!status) continue;
    if (!state.supported) status.textContent = "当前浏览器不支持朗读";
    else if (isCurrent && state.status === "preparing") status.textContent = "正在准备…";
    else if (isCurrent && state.status === "playing") status.textContent = "正在朗读";
    else if (isCurrent && state.status === "paused") status.textContent = "已暂停";
    else if (itemId === currentId && state.status === "error") status.textContent = state.error ?? "朗读失败";
    else status.textContent = "";
  }
  highlightSpeakingItem(active ? currentId : null);
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

function itemKey(item) {
  return String(item?.id ?? item?.url ?? "");
}

function cardDate(item) {
  const raw = item?.publishedAt ?? item?.collectedDate ?? digest.date ?? item?.favoritedAt ?? digest.generatedAt;
  const date = raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) return { value: "", label: "日期未知" };
  return {
    value: date.toISOString(),
    label: new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date)
  };
}

function rateOptions(selected) {
  return [["0.8", "0.8×"], ["1", "1.0×"], ["1.15", "1.15×"], ["1.25", "1.25×"]]
    .map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`)
    .join("");
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
  const categoryItems = activeView === "today"
    ? (digest.items ?? []).filter((item) => !item.city)
    : digest.items ?? [];
  const categories = activeView === "cities"
    ? ["全部", ...followedCities]
    : ["全部", ...new Set(categoryItems.map((item) => item.category))];
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
    feed.innerHTML = `<div class="empty">${activeView === "cities" ? "本次整理没有收录该城市的高价值政策或新闻。" : "这个分类没有收录内容。"}</div>`;
    return;
  }
  feed.innerHTML = items.map((item) => {
    const key = itemKey(item);
    const date = cardDate(item);
    const saved = favoriteIds.has(key) || activeView === "favorites";
    const rate = cardRates.get(key) ?? "1";
    return `
    <article class="card" data-item-id="${escapeHtml(key)}">
      <div class="card-top">
        <span class="badge ${item.importance === "必读" ? "must" : ""}">${escapeHtml(item.importance)}</span>
        ${item.city ? `<span class="badge city-badge">${escapeHtml(item.city)} · ${escapeHtml(item.cityKind || "本地")}</span>` : ""}
        <span>${escapeHtml(item.category)}</span>
        <span>·</span>
        <span>${item.region === "international" ? "国际" : "国内"}</span>
        <span>·</span>
        <span>${Number(item.score) || 0} 分</span>
        <span>·</span>
        <span>${escapeHtml(item.source)}</span>
        <span>·</span>
        <time class="card-date" datetime="${escapeHtml(date.value)}">${escapeHtml(date.label)}</time>
      </div>
      <h2><a href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></h2>
      <p class="summary">${escapeHtml(item.summary)}</p>
      <div class="why"><strong>为什么值得看</strong>${escapeHtml(item.whyItMatters)}</div>
      ${renderImpact(item)}
      <div class="topics">${(item.topics ?? []).map((topic) => `<span class="topic">#${escapeHtml(topic)}</span>`).join("")}</div>
      <div class="card-controls">
        <button class="card-control speak-item" type="button" data-speak-item="${escapeHtml(key)}" ${speechController.supported ? "" : "disabled"}>朗读</button>
        <button class="card-control stop-item" type="button" data-stop-item="${escapeHtml(key)}" disabled>停止</button>
        <label class="card-rate"><span>语速</span><select data-rate-item="${escapeHtml(key)}" aria-label="本条朗读语速">${rateOptions(rate)}</select></label>
        <button class="card-control favorite-item ${saved ? "saved" : ""}" type="button" data-favorite-item="${escapeHtml(key)}" ${saved ? "disabled" : ""}>${saved ? "已收藏" : "收藏"}</button>
        <span class="card-speech-status" data-card-speech-status aria-live="polite"></span>
      </div>
    </article>
  `; }).join("");
  renderSpeechState(speechController.snapshot());
}

function renderStats() {
  if (activeView === "favorites") {
    stats.innerHTML = [`收藏 ${digest.items?.length ?? 0} 条`]
      .map((value) => `<span>${escapeHtml(value)}</span>`).join("");
    return;
  }
  if (activeView === "cities") {
    const cityItems = (digest.items ?? []).filter((item) => item.city);
    stats.innerHTML = [
      `城市精选 ${cityItems.length} 条`,
      ...followedCities.map((city) => `${city} ${cityItems.filter((item) => item.city === city).length} 条`)
    ].map((value) => `<span>${escapeHtml(value)}</span>`).join("");
    return;
  }
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
    `综合精选 ${(digest.items ?? []).filter((item) => !item.city).length} 条`,
    `关注城市 ${digest.stats?.citySelected ?? (digest.items ?? []).filter((item) => item.city).length} 条`,
    `国内 ${digest.stats?.domesticSelected ?? 0} 条`
  ].map((value) => `<span>${escapeHtml(value)}</span>`).join("");
}

function renderDigest(nextDigest, { favoriteCollection = false } = {}) {
  speechController.stop({ silent: true });
  highlightSpeakingItem(null);
  digest = nextDigest;
  activeCategory = "全部";
  briefLabel.textContent = favoriteCollection
    ? `${digest.date} 收藏记录`
    : activeView === "cities" ? "关注城市：政策与新闻" : "本次整理概览";
  brief.textContent = activeView === "cities" && !favoriteCollection
    ? "固定追踪杭州、衢州、伊春，优先展示会改变公共服务、就业、住房、教育、医疗、交通、安全或产业环境的信息。"
    : digest.brief || "这次整理没有生成概览。";
  renderStats();
  const timestamp = digest.updatedAt ?? digest.generatedAt;
  updatedAt.textContent = timestamp
    ? `${favoriteCollection ? "收藏更新于" : "生成于"} ${new Date(timestamp).toLocaleString("zh-CN")}`
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
    const [nextDigest, saved] = await Promise.all([
      fetchJson("./api/current"),
      fetchJson("./api/favorites/ids")
    ]);
    favoriteIds.clear();
    for (const id of saved.ids ?? []) favoriteIds.add(String(id));
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
  if (activeView === "favorites") {
    url.searchParams.set("view", "favorites");
    if (activeDate) url.searchParams.set("date", activeDate);
    else url.searchParams.delete("date");
  } else {
    if (activeView === "cities") url.searchParams.set("view", "cities");
    else url.searchParams.delete("view");
    url.searchParams.delete("date");
  }
  history.replaceState(null, "", url);
}

function renderHistoryButtons(entries) {
  if (entries.length === 0) {
    historyList.innerHTML = '<div class="empty">还没有收藏记录。</div>';
    return;
  }
  historyList.innerHTML = entries.map((entry) => `
    <button type="button" class="history-date ${entry.date === activeDate ? "active" : ""}" data-date="${entry.date}">
      <strong>${entry.date}</strong>
      <span>${entry.totalItems} 条收藏</span>
    </button>
  `).join("");
}

async function loadFavorites(selectedDate = activeDate) {
  try {
    const listing = await fetchJson("./api/favorites");
    if (listing.errors?.length) showError(`${listing.errors.length} 个收藏文件无法读取。`);
    const entries = listing.dates ?? [];
    activeDate = entries.some((entry) => entry.date === selectedDate) ? selectedDate : entries[0]?.date ?? null;
    renderHistoryButtons(entries);
    updateLocation();
    if (!activeDate) {
      renderDigest({ version: 1, date: "", brief: "还没有收藏记录。", stats: {}, items: [] }, { favoriteCollection: true });
      return;
    }
    const collection = await fetchJson(`./api/favorites/${encodeURIComponent(activeDate)}`);
    const favoriteDigest = {
      version: 1,
      date: collection.date,
      generatedAt: collection.updatedAt,
      brief: `这一天收藏了 ${collection.items?.length ?? 0} 条信息。`,
      stats: { selected: collection.items?.length ?? 0 },
      items: collection.items ?? []
    };
    for (const item of favoriteDigest.items) favoriteIds.add(itemKey(item));
    renderDigest(favoriteDigest, { favoriteCollection: true });
    renderHistoryButtons(entries);
  } catch (error) {
    showError(`收藏记录读取失败：${error.message}`);
  }
}

async function setView(view, selectedDate = null) {
  speechController.stop();
  activeView = ["favorites", "history"].includes(view) ? "favorites" : view === "cities" ? "cities" : "today";
  activeDate = activeView === "favorites" ? selectedDate : null;
  for (const button of views.querySelectorAll("[data-view]")) {
    button.classList.toggle("active", button.dataset.view === activeView);
  }
  historyBrowser.hidden = activeView !== "favorites";
  updateLocation();
  if (activeView === "favorites") await loadFavorites(activeDate);
  else await loadToday();
}

function renderRefreshStatus(status) {
  const remainingMinutes = Math.max(1, Math.ceil((status.cooldownRemainingMs ?? 0) / 60000));
  if (status.status === "running") {
    const phases = { collecting: "正在获取信息", analyzing: "Codex 正在整理" };
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
      if (activeView === "favorites") await loadFavorites(activeDate);
      else await loadToday();
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

filters.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-category]");
  if (!button) return;
  speechController.stop();
  activeCategory = button.dataset.category;
  renderFilters();
  renderFeed();
  renderSpeechState(speechController.snapshot());
});

feed.addEventListener("change", (event) => {
  const select = event.target.closest("select[data-rate-item]");
  if (!select) return;
  cardRates.set(select.dataset.rateItem, select.value);
  if (select.dataset.rateItem === activeSpeechItemId) speechController.setRate(select.value);
});

feed.addEventListener("click", async (event) => {
  const speakButton = event.target.closest("button[data-speak-item]");
  if (speakButton) {
    const item = (digest.items ?? []).find((entry) => itemKey(entry) === speakButton.dataset.speakItem);
    if (!item) return;
    const rate = cardRates.get(speakButton.dataset.speakItem) ?? "1";
    activeSpeechItemId = speakButton.dataset.speakItem;
    speechController.setRate(rate);
    speechController.play(buildSingleSpeechQueue(item));
    return;
  }

  const stopButton = event.target.closest("button[data-stop-item]");
  if (stopButton) {
    if (stopButton.dataset.stopItem === activeSpeechItemId) speechController.stop();
    return;
  }

  const favoriteButton = event.target.closest("button[data-favorite-item]");
  if (!favoriteButton || favoriteButton.disabled) return;
  const itemId = favoriteButton.dataset.favoriteItem;
  favoriteButton.disabled = true;
  favoriteButton.textContent = "收藏中…";
  try {
    await fetchJson("./api/favorites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId })
    });
    favoriteIds.add(itemId);
    favoriteButton.classList.add("saved");
    favoriteButton.textContent = "已收藏";
  } catch (error) {
    favoriteButton.disabled = false;
    favoriteButton.textContent = "收藏";
    showError(`收藏失败：${error.message}`);
  }
});

views.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");
  if (button) setView(button.dataset.view);
});

historyList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-date]");
  if (button) {
    speechController.stop();
    loadFavorites(button.dataset.date);
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
