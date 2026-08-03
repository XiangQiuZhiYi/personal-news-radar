const feed = document.querySelector("#feed");
const filters = document.querySelector("#filters");
const brief = document.querySelector("#brief");
const stats = document.querySelector("#stats");
const errors = document.querySelector("#errors");
const updatedAt = document.querySelector("#updated-at");

let digest;
let activeCategory = "全部";

function escapeHtml(value = "") {
  return value.replace(/[&<>'"]/g, (character) => ({
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

function renderFilters() {
  const categories = ["全部", ...new Set(digest.items.map((item) => item.category))];
  filters.innerHTML = categories.map((category) => `
    <button class="filter ${category === activeCategory ? "active" : ""}" data-category="${escapeHtml(category)}">
      ${escapeHtml(category)}
    </button>
  `).join("");
}

function renderFeed() {
  const items = activeCategory === "全部"
    ? digest.items
    : digest.items.filter((item) => item.category === activeCategory);
  if (items.length === 0) {
    feed.innerHTML = '<div class="empty">这个分类今天没有入选内容。</div>';
    return;
  }
  feed.innerHTML = items.map((item) => `
    <article class="card">
      <div class="card-top">
        <span class="badge ${item.importance === "必读" ? "must" : ""}">${escapeHtml(item.importance)}</span>
        <span>${escapeHtml(item.category)}</span>
        <span>·</span>
        <span>${item.region === "international" ? "国际" : "国内"}</span>
        <span>·</span>
        <span>${item.score} 分</span>
        <span>·</span>
        <span>${escapeHtml(item.source)}</span>
      </div>
      <h2><a href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></h2>
      <p class="summary">${escapeHtml(item.summary)}</p>
      <div class="why"><strong>为什么值得看</strong>${escapeHtml(item.whyItMatters)}</div>
      <div class="topics">${item.topics.map((topic) => `<span class="topic">#${escapeHtml(topic)}</span>`).join("")}</div>
    </article>
  `).join("");
}

filters.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-category]");
  if (!button) return;
  activeCategory = button.dataset.category;
  renderFilters();
  renderFeed();
});

try {
  const response = await fetch(`./data/latest.json?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  digest = await response.json();
  brief.textContent = digest.brief;
  stats.innerHTML = [
    `${digest.stats.sources} 个信息源`,
    `${digest.stats.candidates} 条候选`,
    `精选 ${digest.stats.selected} 条`,
    `国内 ${digest.stats.domesticSelected ?? 0} 条`
  ].map((value) => `<span>${value}</span>`).join("");
  updatedAt.textContent = `生成于 ${new Date(digest.generatedAt).toLocaleString("zh-CN")}`;
  if (digest.sourceErrors?.length) {
    errors.hidden = false;
    errors.textContent = `${digest.sourceErrors.length} 个信息源本次采集失败，不影响其他来源的简报。`;
  }
  renderFilters();
  renderFeed();
} catch (error) {
  brief.textContent = "今天的简报尚未生成。请先运行每日采集任务。";
  feed.innerHTML = `<div class="empty">读取失败：${escapeHtml(error.message)}</div>`;
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js");
}
