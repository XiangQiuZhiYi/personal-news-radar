import test from "node:test";
import assert from "node:assert/strict";
import {
  FAVORITES_STORAGE_KEY,
  favoritesForDate,
  listFavoriteDates,
  readFavoriteItems,
  saveFavoriteItem
} from "../public/storage.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
}

test("静态页面只在用户点击收藏后写入浏览器存储", () => {
  const storage = memoryStorage();
  assert.deepEqual(readFavoriteItems(storage), []);
  assert.equal(storage.getItem(FAVORITES_STORAGE_KEY), null);

  const first = saveFavoriteItem(storage, {
    id: "news-1",
    title: "测试新闻",
    url: "https://example.com/news-1"
  }, new Date("2026-08-20T09:30:00.000Z"));
  assert.equal(first.alreadySaved, false);
  assert.equal(readFavoriteItems(storage).length, 1);

  const duplicate = saveFavoriteItem(storage, { id: "news-1", title: "重复" }, new Date("2026-08-20T10:00:00.000Z"));
  assert.equal(duplicate.alreadySaved, true);
  assert.equal(readFavoriteItems(storage).length, 1);
});

test("浏览器收藏可以按收藏日期查看", () => {
  const items = [
    { id: "2", favoriteDate: "2026-08-20", favoritedAt: "2026-08-20T10:00:00.000Z" },
    { id: "1", favoriteDate: "2026-08-19", favoritedAt: "2026-08-19T10:00:00.000Z" },
    { id: "3", favoriteDate: "2026-08-20", favoritedAt: "2026-08-20T11:00:00.000Z" }
  ];
  assert.deepEqual(listFavoriteDates(items), [
    { date: "2026-08-20", totalItems: 2 },
    { date: "2026-08-19", totalItems: 1 }
  ]);
  assert.deepEqual(favoritesForDate(items, "2026-08-20").map((item) => item.id), ["2", "3"]);
});
