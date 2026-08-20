import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildSingleSpeechQueue,
  chooseSpeechVoice,
  SpeechController
} from "../public/speech.js";

const article = {
  id: "article-1",
  title: "有用标题",
  summary: "有用摘要",
  impactForPeople: "普通人可能减少通勤时间。",
  impactAnalysis: {
    impactLevel: "直接",
    direction: "有利",
    changeStatement: "通勤者的平均等候时间下降，备用路线选择增加。",
    affectedGroups: ["每天通勤的上班族", "公共交通乘客"],
    impactPath: "线路调整先改变班次，再影响等候和通勤时间。",
    shortTerm: "部分线路会率先调整时刻表。",
    mediumLongTerm: "居住和就业地点的可达性可能变化。",
    actions: ["出发前检查最新时刻表", "保留一条备用路线"],
    uncertainties: "具体效果取决于线路和实施时间。"
  },
  whyItMatters: "这段为什么值得看不应被朗读",
  source: "不应朗读的来源",
  category: "不应朗读的分类",
  score: 99,
  topics: ["不应朗读的话题"]
};

test("卡片朗读只包含本条标题、摘要和普通人影响", () => {
  const queue = buildSingleSpeechQueue(article);
  const spoken = queue.map((entry) => entry.text).join(" ");
  assert.doesNotMatch(spoken, /今日概览|第1条/);
  assert.match(spoken, /有用标题/);
  assert.match(spoken, /有用摘要/);
  assert.match(spoken, /普通人可能减少通勤时间/);
  assert.match(spoken, /变化方向。有利/);
  assert.match(spoken, /通勤者的平均等候时间下降/);
  assert.match(spoken, /每天通勤的上班族/);
  assert.match(spoken, /出发前检查最新时刻表/);
  assert.match(spoken, /具体效果取决于线路和实施时间/);
  assert.doesNotMatch(spoken, /为什么值得看不应被朗读/);
  assert.doesNotMatch(spoken, /不应朗读的来源|不应朗读的分类|不应朗读的话题|99/);
});

test("旧历史缺少普通人影响时不生成占位语音", () => {
  const queue = buildSingleSpeechQueue({ id: "old", title: "旧标题", summary: "旧摘要" });
  assert.deepEqual(queue.map((entry) => entry.kind), ["title", "summary"]);
  assert.doesNotMatch(queue.map((entry) => entry.text).join(" "), /普通人的影响/);
});

test("优先选择本地中文音色并可回退默认音色", () => {
  const defaultVoice = { lang: "en-US", default: true, localService: true };
  const remoteChinese = { lang: "zh-CN", default: false, localService: false };
  const localChinese = { lang: "zh-TW", default: false, localService: true };
  assert.equal(chooseSpeechVoice([defaultVoice, remoteChinese, localChinese]), localChinese);
  assert.equal(chooseSpeechVoice([defaultVoice]), defaultVoice);
});

test("朗读控制器支持 1.15 倍语速", () => {
  const controller = new SpeechController({ synthesis: null, Utterance: null });
  assert.equal(controller.setRate("1.15"), 1.15);
});

class MockUtterance {
  constructor(text) {
    this.text = text;
    this.onstart = null;
    this.onend = null;
    this.onerror = null;
  }
}

function mockSynthesis() {
  return {
    spoken: [],
    cancelCount: 0,
    pauseCount: 0,
    resumeCount: 0,
    speak(utterance) { this.spoken.push(utterance); },
    cancel() { this.cancelCount += 1; },
    pause() { this.pauseCount += 1; },
    resume() { this.resumeCount += 1; },
    getVoices() { return [{ lang: "zh-CN", localService: true }]; },
    addEventListener() {},
    removeEventListener() {}
  };
}

test("朗读控制器支持暂停、继续、错误跳过和自然完成", () => {
  const synthesis = mockSynthesis();
  const states = [];
  const controller = new SpeechController({
    synthesis,
    Utterance: MockUtterance,
    onStateChange: (state) => states.push(state)
  });
  const queue = [
    { kind: "title", text: "第一段", itemId: "a", itemIndex: 0, itemTotal: 1, mode: "single" },
    { kind: "summary", text: "第二段", itemId: "a", itemIndex: 0, itemTotal: 1, mode: "single" }
  ];

  assert.equal(controller.play(queue), true);
  synthesis.spoken[0].onstart();
  assert.equal(controller.pause(), true);
  assert.equal(controller.resume(), true);
  synthesis.spoken[0].onend();
  synthesis.spoken[1].onstart();
  synthesis.spoken[1].onerror();

  assert.equal(synthesis.pauseCount, 1);
  assert.equal(synthesis.resumeCount, 1);
  assert.equal(states.at(-1).status, "completed");
  assert.equal(states.at(-1).warning, "部分内容未能播放");
});

test("停止或开始新播放后旧发话事件不会继续队列", () => {
  const synthesis = mockSynthesis();
  const controller = new SpeechController({ synthesis, Utterance: MockUtterance });
  const oldQueue = [
    { kind: "title", text: "旧一", itemId: "old", itemIndex: 0, itemTotal: 1 },
    { kind: "summary", text: "旧二", itemId: "old", itemIndex: 0, itemTotal: 1 }
  ];
  controller.play(oldQueue);
  const oldUtterance = synthesis.spoken[0];
  controller.play([{ kind: "title", text: "新内容", itemId: "new", itemIndex: 0, itemTotal: 1 }]);
  oldUtterance.onend();
  assert.deepEqual(synthesis.spoken.map((utterance) => utterance.text), ["旧一", "新内容"]);
  controller.stop();
  assert.equal(controller.status, "stopped");
});

test("Codex Schema 要求结构化的普通人影响分析", async () => {
  const schema = JSON.parse(await readFile(new URL("../schema/codex-digest.schema.json", import.meta.url), "utf8"));
  const itemSchema = schema.properties.items.items;
  assert.ok(itemSchema.required.includes("impactForPeople"));
  assert.ok(itemSchema.required.includes("impactAnalysis"));
  assert.equal(itemSchema.properties.impactForPeople.type, "string");
  assert.deepEqual(itemSchema.properties.impactAnalysis.required, [
    "impactLevel",
    "direction",
    "changeStatement",
    "affectedGroups",
    "impactPath",
    "shortTerm",
    "mediumLongTerm",
    "actions",
    "uncertainties"
  ]);
});
