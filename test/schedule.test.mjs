import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

test("launchd 默认每天 17:00 运行静态发布并在登录后检查补跑", async () => {
  const script = new URL("../scripts/install-schedule.mjs", import.meta.url);
  const result = await execFile(process.execPath, [script.pathname, "--dry-run"], { encoding: "utf8" });
  assert.match(result.stdout, /<string>17<\/string>/);
  assert.match(result.stdout, /<integer>17<\/integer>/);
  assert.match(result.stdout, /src\/publish\.mjs/);
  assert.match(result.stdout, /<string>--scheduled<\/string>/);
  assert.match(result.stdout, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(result.stdout, /daily-error\.log/);
});
