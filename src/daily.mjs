import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dedupeItems, fetchFeeds, parseFeed } from "./lib/feed.mjs";
import { runCodexFilter } from "./lib/codex.mjs";
import { mergeCodexResult } from "./lib/digest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const fixtureIndex = args.indexOf("--fixture");
const fixturePath = fixtureIndex >= 0 ? args[fixtureIndex + 1] : null;

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

function dateInTimezone(date, timezone) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

async function collect(config) {
  if (!fixturePath) return fetchFeeds(config);
  const xml = await readFile(path.resolve(root, fixturePath), "utf8");
  const items = dedupeItems(parseFeed(xml, {
    name: "测试信息源",
    url: `file://${path.resolve(root, fixturePath)}`,
    categoryHint: "测试"
  }));
  return { items, errors: [], sourceCount: 1 };
}

async function main() {
  const startedAt = new Date();
  const [sourceConfig, preferences] = await Promise.all([
    readJson("config/sources.json"),
    readJson("config/preferences.json")
  ]);
  const date = dateInTimezone(startedAt, sourceConfig.timezone ?? "Asia/Shanghai");
  const collected = await collect(sourceConfig);

  await mkdir(path.join(root, "data/raw"), { recursive: true });
  await writeFile(
    path.join(root, `data/raw/${date}.json`),
    `${JSON.stringify({ generatedAt: startedAt.toISOString(), ...collected }, null, 2)}\n`
  );

  let codexResult;
  if (collected.items.length === 0) {
    codexResult = {
      brief: "今天没有采集到符合时间范围的新内容。",
      items: [],
      discardedReasons: ["没有可供筛选的候选信息"]
    };
  } else {
    codexResult = await runCodexFilter({
      candidates: collected.items,
      preferences,
      schemaPath: path.join(root, "schema/codex-digest.schema.json")
    });
  }

  const digest = mergeCodexResult(collected.items, codexResult, {
    generatedAt: new Date().toISOString(),
    date,
    sourceCount: collected.sourceCount,
    errors: collected.errors,
    maxSelectedPerSource: preferences.maxSelectedPerSource,
    maxSelectedPerCategory: preferences.maxSelectedPerCategory,
    maxInternationalItems: preferences.maxInternationalItems
  });

  const archiveDirectory = path.join(root, "public/data/archive");
  await mkdir(archiveDirectory, { recursive: true });
  const json = `${JSON.stringify(digest, null, 2)}\n`;
  await Promise.all([
    writeFile(path.join(root, "public/data/latest.json"), json),
    writeFile(path.join(archiveDirectory, `${date}.json`), json)
  ]);

  console.log(`完成：${collected.items.length} 条候选，Codex 选出 ${digest.items.length} 条。`);
  console.log(`结果：${path.join(root, "public/data/latest.json")}`);
  if (collected.errors.length > 0) {
    console.warn(`${collected.errors.length} 个信息源采集失败，详情已写入结果。`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
