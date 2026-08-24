import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildCodexExecArgs,
  buildPrompt,
  CODEX_MODEL,
  CODEX_MODEL_PROVIDER,
  CODEX_OPENAI_BASE_URL,
  CODEX_REASONING_EFFORT,
  CODEX_SERVICE_TIER,
  DEFAULT_CODEX_TIMEOUT_MS,
  parseCodexJsonLine,
  resolveCodexExecutable,
  runCodexFilter
} from "../src/lib/codex.mjs";

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
    maxSelectedBySource: {
      "爱范儿": 2,
      "人人都是产品经理": 1
    },
    maxSelectedPerCategory: 4,
    minSelectedPerCity: 1,
    maxSelectedPerCity: 3,
    maxInternationalItems: 2,
    followedCities: ["杭州", "衢州", "伊春"],
    careerOpportunity: {
      currentFields: ["前端开发", "UI设计"],
      minAdjacentItems: 1,
      maxAdjacentItems: 2,
      minUnfamiliarItems: 2,
      maxUnfamiliarItems: 3
    },
    sectionTargets: [
      { section: "关注城市", minItems: 4, maxItems: 6, selectionStandard: "政策、公共服务、机会和风险" },
      { section: "职业/收入/技术", minItems: 3, maxItems: 5, selectionStandard: "改变工作方法或职业判断" },
      { section: "国家级", minItems: 2, maxItems: 4, selectionStandard: "明确传导到个人" },
      { section: "实用提醒", minItems: 1, maxItems: 3, selectionStandard: "截止时间、安全、价格和办事变化" },
      { section: "国际", minItems: 0, maxItems: 2, selectionStandard: "对国内生活或工作明确传导" },
      { section: "热点", minItems: 0, maxItems: 2, selectionStandard: "有新增事实或长期意义" }
    ],
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
  assert.match(prompt, /至少保留 1 条、最多保留 3 条/);
  assert.match(prompt, /先让每个有合格候选的城市至少入选一条/);
  assert.match(prompt, /关注城市：4-6 条/);
  assert.match(prompt, /职业\/收入\/技术：3-5 条/);
  assert.match(prompt, /国家级：2-4 条/);
  assert.match(prompt, /实用提醒：1-3 条/);
  assert.match(prompt, /国际：0-2 条/);
  assert.match(prompt, /热点：0-2 条/);
  assert.match(prompt, /爱范儿最多 2 条/);
  assert.match(prompt, /人人都是产品经理最多 1 条/);
  assert.match(prompt, /板块互斥/);
  assert.match(prompt, /前端开发.*UI设计/s);
  assert.match(prompt, /只用于判断能力迁移距离，不是信息边界/);
  assert.match(prompt, /选择 1-2 条“相邻领域机会”和 2-3 条“陌生领域机会”/);
  assert.match(prompt, /相邻领域机会.*数月内可以验证的进入路径/s);
  assert.match(prompt, /陌生领域机会.*当前领域之外/s);
  assert.match(prompt, /融资、发布会、企业宣传和行业预测单独出现时证据不足/);
  assert.match(prompt, /topics 中加入且只加入一个标签/);
  assert.match(prompt, /实用提醒.*个人现在可执行的动作/s);
  assert.match(prompt, /热点.*纯情绪争议/s);
});

test("后台 Codex 调用隔离用户配置并固定模型、推理、速度和 HTTPS 传输", () => {
  const args = buildCodexExecArgs({
    schemaPath: "schema/codex-digest.schema.json",
    prompt: "测试提示"
  });
  assert.ok(args.includes("--ignore-user-config"));
  assert.ok(args.includes("--json"));
  assert.ok(args.includes("--ephemeral"));
  assert.equal(args[args.indexOf("--model") + 1], "gpt-5.6-terra");
  assert.ok(args.includes('model_reasoning_effort="high"'));
  assert.ok(args.includes('service_tier="default"'));
  assert.ok(args.includes('model_provider="openai-http"'));
  assert.ok(args.includes('model_providers.openai-http.name="OpenAI HTTPS"'));
  assert.ok(args.includes('model_providers.openai-http.base_url="https://chatgpt.com/backend-api/codex"'));
  assert.ok(args.includes("model_providers.openai-http.requires_openai_auth=true"));
  assert.ok(args.includes("model_providers.openai-http.supports_websockets=false"));
  assert.equal(CODEX_MODEL, "gpt-5.6-terra");
  assert.equal(CODEX_MODEL_PROVIDER, "openai-http");
  assert.equal(CODEX_OPENAI_BASE_URL, "https://chatgpt.com/backend-api/codex");
  assert.equal(CODEX_REASONING_EFFORT, "high");
  assert.equal(CODEX_SERVICE_TIER, "default");
  assert.equal(DEFAULT_CODEX_TIMEOUT_MS, 30 * 60 * 1000);
});

test("Codex JSONL 事件可提取最终结果和连接错误", () => {
  const connectionError = parseCodexJsonLine(JSON.stringify({
    type: "error",
    message: "Reconnecting... 2/5 (request timed out)"
  }));
  assert.equal(connectionError.level, "error");
  assert.match(connectionError.message, /request timed out/);

  const transportError = parseCodexJsonLine(JSON.stringify({
    type: "item.completed",
    item: { type: "error", message: "Falling back from WebSockets to HTTPS transport" }
  }));
  assert.equal(transportError.level, "error");
  assert.match(transportError.message, /HTTPS transport/);

  const final = parseCodexJsonLine(JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text: "{\"brief\":\"完成\"}" }
  }));
  assert.equal(final.finalMessage, "{\"brief\":\"完成\"}");
  assert.equal(final.message, null);
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
