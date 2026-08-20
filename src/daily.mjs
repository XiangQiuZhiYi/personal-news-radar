import { generateDigest, projectRoot } from "./lib/generate.mjs";
import { acquireRefreshLock } from "./lib/runtime.mjs";

const args = process.argv.slice(2);
const fixtureIndex = args.indexOf("--fixture");
const fixturePath = fixtureIndex >= 0 ? args[fixtureIndex + 1] : null;

async function main() {
  if (fixtureIndex >= 0 && !fixturePath) throw new Error("--fixture 后必须提供文件路径");
  const lock = await acquireRefreshLock(projectRoot);
  try {
    const result = await generateDigest({ root: projectRoot, fixturePath });
    console.log(`完成：${result.collected.items.length} 条候选，本次选出 ${result.digest.items.length} 条。`);
    console.log("本次结果未写入文件；只有在网页中点击收藏的信息才会保存。");
    if (result.collected.errors.length > 0) {
      console.warn(`${result.collected.errors.length} 个信息源采集失败。`);
    }
  } finally {
    await lock.release();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
