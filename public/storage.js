export const FAVORITES_STORAGE_KEY = "personal-news-radar:favorites:v1";

function itemKey(item) {
  return String(item?.id ?? item?.url ?? "");
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function readFavoriteItems(storage) {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(FAVORITES_STORAGE_KEY) ?? "null");
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

export function saveFavoriteItem(storage, item, now = new Date()) {
  if (!storage) throw new Error("当前浏览器不支持本地收藏");
  const key = itemKey(item);
  if (!key) throw new Error("这条信息缺少可收藏的标识");

  const existing = readFavoriteItems(storage);
  const duplicate = existing.find((entry) => itemKey(entry) === key);
  if (duplicate) return { item: duplicate, alreadySaved: true };

  const favoritedAt = now.toISOString();
  const saved = {
    ...item,
    favoritedAt,
    favoriteDate: localDateKey(now)
  };
  const collection = {
    version: 1,
    updatedAt: favoritedAt,
    items: [saved, ...existing]
  };
  storage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(collection));
  return { item: saved, alreadySaved: false };
}

export function listFavoriteDates(items) {
  const totals = new Map();
  for (const item of items) {
    const date = item.favoriteDate ?? String(item.favoritedAt ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    totals.set(date, (totals.get(date) ?? 0) + 1);
  }
  return [...totals.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, totalItems]) => ({ date, totalItems }));
}

export function favoritesForDate(items, date) {
  return items.filter((item) => (
    item.favoriteDate ?? String(item.favoritedAt ?? "").slice(0, 10)
  ) === date);
}
