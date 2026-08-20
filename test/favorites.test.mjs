import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listFavoriteIds, listFavorites, readFavorites, saveFavorite } from "../src/lib/favorites.mjs";

test("收藏按日期写入且重复收藏保持幂等", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "news-radar-favorites-"));
  const digest = {
    date: "2026-08-20",
    items: [{ id: "a", title: "A", url: "https://example.com/a" }]
  };
  const now = new Date("2026-08-20T12:00:00.000Z");

  const first = await saveFavorite(root, digest, "a", now);
  const second = await saveFavorite(root, digest, "a", now);
  assert.equal(first.alreadySaved, false);
  assert.equal(second.alreadySaved, true);
  assert.equal(second.collection.items.length, 1);
  assert.equal(second.collection.items[0].favoritedAt, now.toISOString());
  assert.deepEqual(await listFavoriteIds(root), ["a"]);
  assert.equal((await listFavorites(root)).dates[0].totalItems, 1);
  assert.equal((await readFavorites(root, "2026-08-20")).items[0].title, "A");

  const stored = JSON.parse(await readFile(path.join(root, "data/favorites/2026-08-20.json"), "utf8"));
  assert.equal(stored.items.length, 1);
});

test("不能收藏当前整理结果中不存在的卡片", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "news-radar-favorites-missing-"));
  await assert.rejects(
    saveFavorite(root, { date: "2026-08-20", items: [] }, "missing"),
    { code: "FAVORITE_NOT_FOUND" }
  );
});
