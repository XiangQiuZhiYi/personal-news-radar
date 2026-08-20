import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("静态页面提供城市、日期、单条朗读和浏览器收藏", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8")
  ]);

  assert.match(html, /data-view="cities">关注城市/);
  assert.match(html, /每天 17:00/);
  assert.doesNotMatch(html, /refresh-button|获取最新消息/);
  assert.doesNotMatch(html, /播放所有|speech-play/);
  assert.match(app, /followedCities = \["杭州", "衢州", "伊春"\]/);
  assert.match(app, /data-speak-item/);
  assert.match(app, /data-stop-item/);
  assert.match(app, /data-rate-item/);
  assert.match(app, /data-favorite-item/);
  assert.match(app, /<time class="card-date"/);
  assert.match(app, /\.\/data\/latest\.json/);
  assert.doesNotMatch(app, /\.\/api\//);
  assert.match(app, /saveFavoriteItem\(browserStorage\(\)/);
});
