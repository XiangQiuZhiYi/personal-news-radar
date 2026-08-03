import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalUrl, normalizedTitle } from "./feed.mjs";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const IMPORTANCE_ORDER = { "必读": 0, "值得读": 1, "可选": 2 };

export function runIdFor(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function atomicWriteJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

function aliases(item = {}) {
  const values = [];
  if (item.id) values.push(`id:${item.id}`);
  if (item.url) values.push(`url:${canonicalUrl(item.url)}`);
  if (item.title) values.push(`title:${normalizedTitle(item.title)}`);
  return values;
}

function sortItems(items) {
  return items.sort((left, right) => {
    const importance = (IMPORTANCE_ORDER[left.importance] ?? 9) - (IMPORTANCE_ORDER[right.importance] ?? 9);
    if (importance) return importance;
    const score = (Number(right.score) || 0) - (Number(left.score) || 0);
    if (score) return score;
    const published = Date.parse(right.publishedAt ?? "") - Date.parse(left.publishedAt ?? "");
    if (Number.isFinite(published) && published) return published;
    return String(left.id ?? left.url ?? "").localeCompare(String(right.id ?? right.url ?? ""));
  });
}

function lastRunStats(digest, run) {
  return {
    sources: run.sources ?? digest.stats?.sources ?? 0,
    candidates: run.candidates ?? digest.stats?.candidates ?? 0,
    selected: run.selected ?? digest.items?.length ?? 0,
    failedSources: run.failedSources ?? digest.stats?.failedSources ?? 0
  };
}

export function mergeDailyDigest(existing, digest, run) {
  if (!DATE_PATTERN.test(run.date)) throw new Error("历史记录日期格式无效");
  if (existing?.runs?.some((entry) => entry.id === run.id)) return existing;

  const completedAt = run.completedAt ?? digest.generatedAt ?? new Date().toISOString();
  const currentItems = (existing?.items ?? []).map((item) => ({ ...item }));
  const aliasIndex = new Map();
  currentItems.forEach((item, index) => aliases(item).forEach((alias) => aliasIndex.set(alias, index)));

  for (const incoming of digest.items ?? []) {
    const index = aliases(incoming).map((alias) => aliasIndex.get(alias)).find((value) => value !== undefined);
    if (index === undefined) {
      const item = {
        ...incoming,
        firstSeenAt: completedAt,
        lastSeenAt: completedAt,
        seenCount: 1
      };
      currentItems.push(item);
      aliases(item).forEach((alias) => aliasIndex.set(alias, currentItems.length - 1));
      continue;
    }

    const previous = currentItems[index];
    const item = {
      ...previous,
      ...incoming,
      id: previous.id ?? incoming.id,
      firstSeenAt: previous.firstSeenAt ?? completedAt,
      lastSeenAt: completedAt,
      seenCount: (Number(previous.seenCount) || 1) + 1
    };
    currentItems[index] = item;
    aliases(item).forEach((alias) => aliasIndex.set(alias, index));
  }

  const items = sortItems(currentItems);
  const runs = [
    ...(existing?.runs ?? []),
    {
      id: run.id,
      startedAt: run.startedAt,
      completedAt,
      candidates: run.candidates ?? digest.stats?.candidates ?? 0,
      selected: run.selected ?? digest.items?.length ?? 0,
      failedSources: run.failedSources ?? digest.stats?.failedSources ?? 0
    }
  ];

  return {
    version: 2,
    date: run.date,
    createdAt: existing?.createdAt ?? run.startedAt ?? completedAt,
    updatedAt: completedAt,
    generatedAt: completedAt,
    brief: digest.brief ?? "",
    stats: {
      refreshCount: runs.length,
      totalItems: items.length,
      domesticItems: items.filter((item) => item.region !== "international").length,
      internationalItems: items.filter((item) => item.region === "international").length,
      lastRun: lastRunStats(digest, run)
    },
    runs,
    sourceErrors: digest.sourceErrors ?? [],
    discardedReasons: digest.discardedReasons ?? [],
    items
  };
}

export async function saveDailyDigest(root, digest, run) {
  const historyPath = path.join(root, "data/history", `${run.date}.json`);
  const existing = await readJsonIfExists(historyPath);
  const daily = mergeDailyDigest(existing, digest, run);
  await atomicWriteJson(historyPath, daily);
  await atomicWriteJson(path.join(root, "public/data/latest.json"), daily);
  return daily;
}

function legacyRun(digest, date) {
  const completedAt = digest.generatedAt ?? `${date}T00:00:00.000Z`;
  return {
    id: `legacy-${runIdFor(new Date(completedAt))}`,
    date,
    startedAt: completedAt,
    completedAt,
    sources: digest.stats?.sources ?? 0,
    candidates: digest.stats?.candidates ?? 0,
    selected: digest.stats?.selected ?? digest.items?.length ?? 0,
    failedSources: digest.stats?.failedSources ?? digest.sourceErrors?.length ?? 0
  };
}

async function legacyFiles(root) {
  const archiveDirectory = path.join(root, "public/data/archive");
  let archiveNames = [];
  try {
    archiveNames = (await readdir(archiveDirectory))
      .filter((name) => DATE_PATTERN.test(path.basename(name, ".json")) && name.endsWith(".json"))
      .sort();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return [
    ...archiveNames.map((name) => path.join(archiveDirectory, name)),
    path.join(root, "public/data/latest.json")
  ];
}

export async function migrateLegacyHistory(root) {
  const migratedDates = new Set();
  for (const filePath of await legacyFiles(root)) {
    const digest = await readJsonIfExists(filePath);
    if (!digest) continue;
    const date = digest.date;
    if (!DATE_PATTERN.test(date ?? "")) continue;
    const historyPath = path.join(root, "data/history", `${date}.json`);
    const existing = await readJsonIfExists(historyPath);

    if (digest.version === 2) {
      if (!existing) {
        await atomicWriteJson(historyPath, digest);
        migratedDates.add(date);
      }
      continue;
    }

    const merged = mergeDailyDigest(existing, digest, legacyRun(digest, date));
    if (merged !== existing) {
      await atomicWriteJson(historyPath, merged);
      migratedDates.add(date);
    }
  }
  const history = await listHistory(root);
  if (history.dates[0]) {
    const latest = await readHistory(root, history.dates[0].date);
    await atomicWriteJson(path.join(root, "public/data/latest.json"), latest);
  }
  return [...migratedDates];
}

export async function listHistory(root) {
  const directory = path.join(root, "data/history");
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
      const digest = await readJsonIfExists(path.join(directory, name));
      dates.push({
        date,
        updatedAt: digest.updatedAt ?? digest.generatedAt,
        totalItems: digest.stats?.totalItems ?? digest.items?.length ?? 0,
        refreshCount: digest.stats?.refreshCount ?? digest.runs?.length ?? 1,
        brief: digest.brief ?? ""
      });
    } catch {
      errors.push({ date, error: "历史文件无法读取" });
    }
  }
  return { dates, errors };
}

export async function readHistory(root, date) {
  if (!DATE_PATTERN.test(date ?? "")) {
    const error = new Error("历史记录日期格式无效");
    error.code = "INVALID_DATE";
    throw error;
  }
  return readJsonIfExists(path.join(root, "data/history", `${date}.json`));
}
