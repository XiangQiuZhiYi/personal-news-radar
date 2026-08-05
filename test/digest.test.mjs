import test from "node:test";
import assert from "node:assert/strict";
import { mergeCodexResult } from "../src/lib/digest.mjs";

test("只接受真实 candidateId，并保留原始链接", () => {
  const candidates = [{
    id: "real",
    source: "真实来源",
    title: "真实标题",
    url: "https://example.com/real"
  }];
  const result = mergeCodexResult(candidates, {
    brief: "摘要",
    discardedReasons: [],
    items: [
      {
        candidateId: "fake",
        category: "其他",
        score: 100,
        importance: "必读",
        summary: "不存在",
        whyItMatters: "不存在",
        impactForPeople: "不存在",
        confidence: "低",
        topics: []
      },
      {
        candidateId: "real",
        category: "科技",
        score: 88,
        importance: "值得读",
        summary: "有效摘要",
        whyItMatters: "有效原因",
        impactForPeople: "普通人影响",
        impactAnalysis: {
          impactLevel: "间接",
          direction: "有利",
          changeStatement: "测试人群的办理时间下降。",
          affectedGroups: ["测试人群"],
          impactPath: "测试路径",
          shortTerm: "短期测试",
          mediumLongTerm: "长期测试",
          actions: ["测试行动"],
          uncertainties: "测试不确定性"
        },
        confidence: "高",
        topics: ["测试"]
      }
    ]
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].url, "https://example.com/real");
  assert.equal(result.items[0].summary, "有效摘要");
  assert.equal(result.items[0].impactForPeople, "普通人影响");
  assert.equal(result.items[0].impactAnalysis.impactPath, "测试路径");
  assert.equal(result.items[0].impactAnalysis.direction, "有利");
});

test("限制单一来源和分类占据整份简报", () => {
  const candidates = [
    { id: "a", source: "同一来源", title: "A", url: "https://example.com/a" },
    { id: "b", source: "同一来源", title: "B", url: "https://example.com/b" },
    { id: "c", source: "其他来源", title: "C", url: "https://example.com/c" }
  ];
  const item = (candidateId, category) => ({
    candidateId,
    category,
    score: 80,
    importance: "值得读",
    summary: "摘要",
    whyItMatters: "原因",
    impactForPeople: "普通人影响",
    confidence: "高",
    topics: []
  });
  const result = mergeCodexResult(candidates, {
    brief: "摘要",
    discardedReasons: [],
    items: [item("a", "科技"), item("b", "商业"), item("c", "科技")]
  }, {
    maxSelectedPerSource: 1,
    maxSelectedPerCategory: 1
  });
  assert.deepEqual(result.items.map((entry) => entry.id), ["a"]);
});

test("移除模型自行计算且可能不准确的数量前缀", () => {
  const result = mergeCodexResult([], {
    brief: "从 57 条候选信息中筛选出 19 条。重点关注跨领域变化。",
    discardedReasons: [],
    items: []
  });
  assert.equal(result.brief, "重点关注跨领域变化。");
});

test("国际信息数量受硬上限约束", () => {
  const candidates = [
    { id: "i1", source: "国际一", region: "international", url: "https://example.com/i1" },
    { id: "i2", source: "国际二", region: "international", url: "https://example.com/i2" },
    { id: "d1", source: "国内一", region: "domestic", url: "https://example.com/d1" }
  ];
  const item = (candidateId) => ({
    candidateId,
    category: "国际",
    score: 80,
    importance: "值得读",
    summary: "摘要",
    whyItMatters: "原因",
    impactForPeople: "普通人影响",
    confidence: "高",
    topics: []
  });
  const result = mergeCodexResult(candidates, {
    brief: "重点",
    discardedReasons: [],
    items: [item("i1"), item("i2"), item("d1")]
  }, { maxInternationalItems: 1 });
  assert.deepEqual(result.items.map((entry) => entry.id), ["i1", "d1"]);
  assert.equal(result.stats.domesticSelected, 1);
  assert.equal(result.stats.internationalSelected, 1);
});
