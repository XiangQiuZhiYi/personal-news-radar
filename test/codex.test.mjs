import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveCodexExecutable, runCodexFilter } from "../src/lib/codex.mjs";

test("CODEX_BIN 显式配置具有最高优先级", async () => {
  const configured = path.join("custom", "codex.exe");
  assert.equal(await resolveCodexExecutable({
    env: { CODEX_BIN: configured, PATH: "" },
    platform: "win32",
    localBinRoot: null
  }), configured);
});

test("Windows 可自动发现 Codex Desktop 附带的 CLI", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "news-radar-codex-"));
  const versionDir = path.join(root, "desktop-version");
  const executable = path.join(versionDir, "codex.exe");
  await mkdir(versionDir, { recursive: true });
  await writeFile(executable, "test");

  assert.equal(await resolveCodexExecutable({
    env: { PATH: "" },
    platform: "win32",
    localBinRoot: root
  }), executable);
});

test("Codex CLI 不存在时返回可操作的错误", async () => {
  const previous = process.env.CODEX_BIN;
  process.env.CODEX_BIN = path.join(os.tmpdir(), "missing-codex-cli.exe");
  try {
    await assert.rejects(runCodexFilter({
      candidates: [],
      preferences: {
        maxSelectedItems: 1,
        maxSelectedPerSource: 1,
        maxSelectedPerCategory: 1,
        maxInternationalItems: 0,
        explorationRatio: 0,
        language: "简体中文"
      },
      schemaPath: path.join(os.tmpdir(), "schema.json"),
      timeoutMs: 1000
    }), (error) => error.code === "CODEX_NOT_FOUND" && /CODEX_BIN/.test(error.message));
  } finally {
    if (previous === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = previous;
  }
});
