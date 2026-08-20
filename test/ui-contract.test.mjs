import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("页面提供关注城市、卡片日期、单条朗读和收藏入口", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8")
  ]);

  assert.match(html, /data-view="cities">关注城市/);
  assert.doesNotMatch(html, /播放所有|speech-play/);
  assert.match(app, /followedCities = \["杭州", "衢州", "伊春"\]/);
  assert.match(app, /data-speak-item/);
  assert.match(app, /data-stop-item/);
  assert.match(app, /data-rate-item/);
  assert.match(app, /data-favorite-item/);
  assert.match(app, /<time class="card-date"/);
});
