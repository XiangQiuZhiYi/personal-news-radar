import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCodexFilter } from "./codex.mjs";
import { mergeCodexResult } from "./digest.mjs";
import { dedupeItems, fetchFeeds, parseFeed } from "./feed.mjs";
import { runIdFor } from "./history.mjs";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function readJson(root, relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

export function dateInTimezone(date, timezone) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

async function collect(root, config, fixturePath) {
  if (!fixturePath) return fetchFeeds(config);
  const absoluteFixturePath = path.resolve(root, fixturePath);
  const xml = await readFile(absoluteFixturePath, "utf8");
  const items = dedupeItems(parseFeed(xml, {
    name: "测试信息源",
    url: `file://${absoluteFixturePath}`,
    categoryHint: "测试",
    region: "domestic"
  }));
  return { items, errors: [], sourceCount: 1 };
}

export async function generateDigest({
  root = projectRoot,
  fixturePath = null,
  onProgress = () => {},
  now = () => new Date(),
  startedAt: providedStartedAt = null,
  runId: providedRunId = null
} = {}) {
  const startedAt = providedStartedAt ?? now();
  const runId = providedRunId ?? runIdFor(startedAt);
  const [sourceConfig, preferences] = await Promise.all([
    readJson(root, "config/sources.json"),
    readJson(root, "config/preferences.json")
  ]);
  const date = dateInTimezone(startedAt, sourceConfig.timezone ?? "Asia/Shanghai");

  await onProgress("collecting");
  const collected = await collect(root, sourceConfig, fixturePath);

  let codexResult;
  if (collected.items.length === 0) {
    codexResult = {
      brief: "今天没有采集到符合时间范围的新内容。",
      items: [],
      discardedReasons: ["没有可供筛选的候选信息"]
    };
  } else {
    await onProgress("analyzing");
    codexResult = await runCodexFilter({
      candidates: collected.items,
      preferences,
      schemaPath: path.join(root, "schema/codex-digest.schema.json")
    });
  }

  const completedAt = now();
  const digest = mergeCodexResult(collected.items, codexResult, {
    generatedAt: completedAt.toISOString(),
    date,
    sourceCount: collected.sourceCount,
    errors: collected.errors,
    maxSelectedPerSource: preferences.maxSelectedPerSource,
    maxSelectedPerCategory: preferences.maxSelectedPerCategory,
    maxSelectedPerCity: preferences.maxSelectedPerCity,
    maxInternationalItems: preferences.maxInternationalItems
  });
  const run = {
    id: runId,
    date,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    sources: collected.sourceCount,
    candidates: collected.items.length,
    selected: digest.items.length,
    failedSources: collected.errors.length
  };

  return { digest, run, collected };
}
