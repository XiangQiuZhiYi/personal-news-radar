import { readdir } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJson, readJsonIfExists } from "./history.mjs";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function itemKey(item = {}) {
  return String(item.id ?? item.url ?? "").trim();
}

function emptyCollection(date) {
  return {
    version: 1,
    date,
    createdAt: null,
    updatedAt: null,
    items: []
  };
}

export async function saveFavorite(root, digest, itemId, now = new Date()) {
  const key = String(itemId ?? "").trim();
  const item = (digest?.items ?? []).find((entry) => itemKey(entry) === key);
  if (!item) {
    const error = new Error("当前整理结果中没有找到这条信息");
    error.code = "FAVORITE_NOT_FOUND";
    throw error;
  }

  const date = DATE_PATTERN.test(digest.date ?? "")
    ? digest.date
    : now.toISOString().slice(0, 10);
  const filePath = path.join(root, "data/favorites", `${date}.json`);
  const existing = await readJsonIfExists(filePath) ?? emptyCollection(date);
  const alreadySaved = (existing.items ?? []).some((entry) => itemKey(entry) === key);
  if (alreadySaved) return { collection: existing, item, alreadySaved: true };

  const savedAt = now.toISOString();
  const collection = {
    ...existing,
    version: 1,
    date,
    createdAt: existing.createdAt ?? savedAt,
    updatedAt: savedAt,
    items: [...(existing.items ?? []), {
      ...item,
      collectedDate: date,
      favoritedAt: savedAt
    }]
  };
  await atomicWriteJson(filePath, collection);
  return { collection, item, alreadySaved: false };
}

export async function listFavorites(root) {
  const directory = path.join(root, "data/favorites");
  let names = [];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return { dates: [], errors: [] };
    throw error;
  }

  const dates = [];
  const errors = [];
  for (const name of names.filter((entry) => entry.endsWith(".json")).sort().reverse()) {
    const date = path.basename(name, ".json");
    if (!DATE_PATTERN.test(date)) continue;
    try {
      const collection = await readJsonIfExists(path.join(directory, name));
      dates.push({
        date,
        updatedAt: collection.updatedAt,
        totalItems: collection.items?.length ?? 0
      });
    } catch {
      errors.push({ date, error: "收藏文件无法读取" });
    }
  }
  return { dates, errors };
}

export async function readFavorites(root, date) {
  if (!DATE_PATTERN.test(date ?? "")) {
    const error = new Error("收藏日期格式无效");
    error.code = "INVALID_DATE";
    throw error;
  }
  return readJsonIfExists(path.join(root, "data/favorites", `${date}.json`));
}

export async function listFavoriteIds(root) {
  const listing = await listFavorites(root);
  const ids = new Set();
  for (const entry of listing.dates) {
    const collection = await readFavorites(root, entry.date);
    for (const item of collection?.items ?? []) {
      const key = itemKey(item);
      if (key) ids.add(key);
    }
  }
  return [...ids];
}
