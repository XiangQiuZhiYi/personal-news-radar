import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCodexExecutable } from "../src/lib/codex.mjs";

const label = "com.personal-news-radar.daily";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

function optionNumber(name, fallback, min, max) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min}-${max} 之间的整数`);
  }
  return value;
}

function xml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;"
  })[character]);
}

const hour = optionNumber("--hour", 22, 0, 23);
const minute = optionNumber("--minute", 0, 0, 59);
const home = os.homedir();
const plistPath = path.join(home, "Library/LaunchAgents", `${label}.plist`);
const logDirectory = path.join(root, "logs");
const environment = {
  HOME: home,
  CODEX_BIN: await resolveCodexExecutable()
};
for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"]) {
  if (process.env[key]) environment[key] = process.env[key];
}

const environmentXml = Object.entries(environment)
  .map(([key, value]) => `      <key>${xml(key)}</key>\n      <string>${xml(value)}</string>`)
  .join("\n");

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${xml(process.execPath)}</string>
      <string>${xml(path.join(root, "src/daily.mjs"))}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${xml(root)}</string>
    <key>EnvironmentVariables</key>
    <dict>
${environmentXml}
    </dict>
    <key>StartCalendarInterval</key>
    <dict>
      <key>Hour</key>
      <integer>${hour}</integer>
      <key>Minute</key>
      <integer>${minute}</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>${xml(path.join(logDirectory, "daily.log"))}</string>
    <key>StandardErrorPath</key>
    <string>${xml(path.join(logDirectory, "daily-error.log"))}</string>
    <key>ProcessType</key>
    <string>Background</string>
  </dict>
</plist>
`;

if (dryRun) {
  process.stdout.write(plist);
} else {
  await mkdir(path.dirname(plistPath), { recursive: true });
  await mkdir(logDirectory, { recursive: true });
  await writeFile(plistPath, plist, { mode: 0o600 });
  const target = `gui/${process.getuid()}`;
  try {
    execFileSync("launchctl", ["bootout", target, plistPath], { stdio: "ignore" });
  } catch {
    // The task may not have been loaded before; bootstrap below is authoritative.
  }
  execFileSync("launchctl", ["bootstrap", target, plistPath], { stdio: "inherit" });
  console.log(`已安装每日任务：每天 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  console.log(`配置：${plistPath}`);
  console.log(`日志：${logDirectory}`);
}
