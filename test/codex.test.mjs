import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildPrompt, resolveCodexExecutable, runCodexFilter } from "../src/lib/codex.mjs";

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

test("macOS 可在 PATH 缺失时发现桌面应用附带的 CLI", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "news-radar-codex-mac-"));
  const executable = path.join(root, "ChatGPT.app", "Contents", "Resources", "codex");
  await mkdir(path.dirname(executable), { recursive: true });
  await writeFile(executable, "test");

  assert.equal(await resolveCodexExecutable({
    env: { PATH: "", HOME: root },
    platform: "darwin",
    localBinRoot: null,
    macBundleCandidates: [executable]
  }), executable);
});

test("影响分析要求明确方向而不是模糊措辞", () => {
  const prompt = buildPrompt({
    maxSelectedItems: 10,
    maxSelectedPerSource: 3,
    maxSelectedPerCategory: 4,
    minSelectedPerCity: 2,
    maxSelectedPerCity: 5,
    maxInternationalItems: 2,
    followedCities: ["杭州", "衢州", "伊春"],
    explorationRatio: 0.1,
    language: "简体中文"
  });
  assert.match(prompt, /有利.*不利.*分化.*当前不变/s);
  assert.match(prompt, /具体人群 \+ 具体指标 \+ 方向/);
  assert.match(prompt, /当前不变；当\/若/);
  assert.match(prompt, /不得以“可能、或将、有望、预计、存在变化/);
  assert.match(prompt, /除 uncertainties 专门说明证据边界外/);
  assert.match(prompt, /条件 → 对象 → 上升\/下降等明确方向/);
  assert.match(prompt, /杭州.*衢州.*伊春/s);
  assert.match(prompt, /至少保留 2 条、最多保留 5 条/);
  assert.match(prompt, /先满足每个关注城市的最低数量/);
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
