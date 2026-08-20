import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPublishBranch,
  buildStaticDigest,
  pushStaticDigest,
  scheduledRunDue
} from "./lib/static-publish.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const fixtureIndex = args.indexOf("--fixture");
const fixturePath = fixtureIndex >= 0 ? args[fixtureIndex + 1] : null;
const noPush = args.includes("--no-push");
const scheduled = args.includes("--scheduled");

function optionNumber(name, fallback, min, max) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min}-${max} 之间的整数`);
  }
  return value;
}

const scheduledHour = optionNumber("--hour", 17, 0, 23);
const scheduledMinute = optionNumber("--minute", 0, 0, 59);

function progress(phase) {
  const messages = {
    collecting: "正在拉取最新信息…",
    analyzing: "Codex 正在分类、过滤和分析…"
  };
  console.log(messages[phase] ?? phase);
}

async function main() {
  if (fixtureIndex >= 0 && !fixturePath) throw new Error("--fixture 后必须提供文件路径");
  const preferences = JSON.parse(await readFile(path.join(root, "config/sources.json"), "utf8"));
  const timezone = preferences.timezone ?? "Asia/Shanghai";

  if (scheduled) {
    const due = await scheduledRunDue({ root, hour: scheduledHour, minute: scheduledMinute });
    if (!due.due) {
      console.log(`跳过：${due.reason}（${due.date}，${timezone}）。`);
      return;
    }
  }

  if (!noPush) await assertPublishBranch(root);
  const result = await buildStaticDigest({ root, fixturePath, onProgress: progress });
  console.log(`静态晚报已生成：${result.collected.items.length} 条候选，精选 ${result.digest.items.length} 条。`);
  console.log(`文件：${result.outputPath}`);

  if (noPush) {
    console.log("已按要求跳过 Git 提交和推送。");
    return;
  }

  const published = await pushStaticDigest({ root, digest: result.digest });
  console.log(published.committed ? "已提交并推送到 GitHub，Pages 将自动部署。" : "数据没有变化；已确认远端同步。" );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
