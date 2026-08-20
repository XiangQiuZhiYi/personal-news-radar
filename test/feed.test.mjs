import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dedupeItems, interleaveBatches, parseFeed, parseHtmlList } from "../src/lib/feed.mjs";

test("解析 RSS 条目并清理 HTML", async () => {
  const xml = await readFile(new URL("./fixtures/sample-rss.xml", import.meta.url), "utf8");
  const items = parseFeed(xml, { name: "测试源", url: "https://example.com/feed" });
  assert.equal(items.length, 3);
  assert.equal(items[0].source, "测试源");
  assert.equal(items[0].url, "https://example.com/battery-pilot");
  assert.match(items[0].description, /中试数据/);
  assert.match(items[0].publishedAt, /^2026-08-03T02:00:00/);
});

test("按链接和标准化标题精确去重", () => {
  const items = [
    { id: "1", title: "同一条消息！", url: "https://example.com/a?utm_source=x" },
    { id: "2", title: "其他标题", url: "https://example.com/a" },
    { id: "3", title: "同一条消息", url: "https://example.com/c" }
  ];
  assert.deepEqual(dedupeItems(items).map((item) => item.id), ["1"]);
});

test("按来源轮询候选，避免高频来源挤掉其他来源", () => {
  const batches = [
    [{ id: "a1" }, { id: "a2" }, { id: "a3" }],
    [{ id: "b1" }],
    [{ id: "c1" }, { id: "c2" }]
  ];
  assert.deepEqual(interleaveBatches(batches).map((item) => item.id), [
    "a1", "b1", "c1", "a2", "c2", "a3"
  ]);
});

test("解析城市网页列表并保留城市、类型和日期", () => {
  const html = `<ul>
    <li><a href="/news/202608/t20260820_1.shtml" title="杭州公共交通服务调整">杭州公共交通服务调整</a><span>2026-08-20</span></li>
    <li><a href="/next">下一页</a></li>
  </ul>`;
  const items = parseHtmlList(html, {
    name: "杭州本地来源",
    url: "https://example.com/list.html",
    city: "杭州",
    cityKind: "政策与新闻",
    categoryHint: "杭州本地",
    region: "domestic"
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].city, "杭州");
  assert.equal(items[0].cityKind, "政策与新闻");
  assert.equal(items[0].url, "https://example.com/news/202608/t20260820_1.shtml");
  assert.match(items[0].publishedAt, /^2026-08-20T04:00:00/);
});
