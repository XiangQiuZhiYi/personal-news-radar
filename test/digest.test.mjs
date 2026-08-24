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

test("来源专属采用上限优先于全局上限", () => {
  const candidates = [
    { id: "a", source: "产品资讯", title: "A", url: "https://example.com/a" },
    { id: "b", source: "产品资讯", title: "B", url: "https://example.com/b" },
    { id: "c", source: "技术资讯", title: "C", url: "https://example.com/c" },
    { id: "d", source: "技术资讯", title: "D", url: "https://example.com/d" }
  ];
  const item = (candidateId) => ({
    candidateId,
    category: candidateId,
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
    items: candidates.map(({ id }) => item(id))
  }, {
    maxSelectedPerSource: 3,
    maxSelectedBySource: { "产品资讯": 1, "技术资讯": 2 }
  });
  assert.deepEqual(result.items.map((entry) => entry.id), ["a", "c", "d"]);
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

test("关注城市条目保留城市标记并受单城市上限约束", () => {
  const candidates = [
    { id: "h1", source: "杭州一", city: "杭州", url: "https://example.com/h1" },
    { id: "h2", source: "杭州二", city: "杭州", url: "https://example.com/h2" },
    { id: "q1", source: "衢州一", city: "衢州", url: "https://example.com/q1" }
  ];
  const item = (candidateId) => ({
    candidateId,
    category: "政策",
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
    items: [item("h1"), item("h2"), item("q1")]
  }, { maxSelectedPerCity: 1 });

  assert.deepEqual(result.items.map((entry) => entry.id), ["h1", "q1"]);
  assert.equal(result.stats.citySelected, 2);
  assert.deepEqual(result.stats.cities, { "杭州": 1, "衢州": 1 });
});

test("相邻领域和陌生领域机会分别受硬上限约束", () => {
  const candidates = ["a1", "a2", "a3", "u1", "u2", "u3", "u4", "n1"].map((id) => ({
    id,
    source: `来源-${id}`,
    url: `https://example.com/${id}`
  }));
  const item = (candidateId, topics) => ({
    candidateId,
    category: "商业",
    score: 80,
    importance: "值得读",
    summary: "摘要",
    whyItMatters: "原因",
    impactForPeople: "普通人影响",
    confidence: "高",
    topics
  });
  const result = mergeCodexResult(candidates, {
    brief: "重点",
    discardedReasons: [],
    items: [
      item("a1", ["相邻领域机会"]),
      item("a2", ["相邻领域机会"]),
      item("a3", ["相邻领域机会"]),
      item("u1", ["陌生领域机会"]),
      item("u2", ["陌生领域机会"]),
      item("u3", ["陌生领域机会"]),
      item("u4", ["陌生领域机会"]),
      item("n1", ["其他主题"])
    ]
  }, {
    maxAdjacentOpportunityItems: 2,
    maxUnfamiliarOpportunityItems: 3
  });

  assert.deepEqual(result.items.map((entry) => entry.id), ["a1", "a2", "u1", "u2", "u3", "n1"]);
  assert.equal(result.stats.adjacentOpportunitySelected, 2);
  assert.equal(result.stats.unfamiliarOpportunitySelected, 3);
});

test("六个互斥板块分别受每日硬上限约束", () => {
  const sectionLimits = {
    "关注城市": 2,
    "职业/收入/技术": 2,
    "国家级": 1,
    "实用提醒": 1,
    "国际": 1,
    "热点": 1
  };
  const candidates = [
    { id: "c1", source: "c1", city: "杭州", region: "domestic" },
    { id: "c2", source: "c2", city: "衢州", region: "domestic" },
    { id: "c3", source: "c3", city: "伊春", region: "domestic" },
    { id: "a1", source: "a1", region: "domestic" },
    { id: "u1", source: "u1", region: "domestic" },
    { id: "u2", source: "u2", region: "domestic" },
    { id: "n1", source: "n1", region: "domestic" },
    { id: "n2", source: "n2", region: "domestic" },
    { id: "r1", source: "r1", region: "domestic" },
    { id: "r2", source: "r2", region: "domestic" },
    { id: "i1", source: "i1", region: "international" },
    { id: "i2", source: "i2", region: "international" },
    { id: "h1", source: "h1", region: "domestic" },
    { id: "h2", source: "h2", region: "domestic" },
    { id: "wrong-city", source: "wrong-city", city: "杭州", region: "domestic" }
  ];
  const item = (candidateId, contentSection, topics = []) => ({
    candidateId,
    contentSection,
    category: "其他",
    score: 80,
    importance: "值得读",
    summary: "摘要",
    whyItMatters: "原因",
    impactForPeople: "普通人影响",
    confidence: "高",
    topics
  });
  const result = mergeCodexResult(candidates, {
    brief: "重点",
    discardedReasons: [],
    items: [
      item("c1", "关注城市"), item("c2", "关注城市"), item("c3", "关注城市"),
      item("a1", "职业/收入/技术", ["相邻领域机会"]),
      item("u1", "职业/收入/技术", ["陌生领域机会"]),
      item("u2", "职业/收入/技术", ["陌生领域机会"]),
      item("n1", "国家级"), item("n2", "国家级"),
      item("r1", "实用提醒"), item("r2", "实用提醒"),
      item("i1", "国际"), item("i2", "国际"),
      item("h1", "热点"), item("h2", "热点"),
      item("wrong-city", "热点")
    ]
  }, {
    sectionLimits,
    maxAdjacentOpportunityItems: 2,
    maxUnfamiliarOpportunityItems: 3,
    maxInternationalItems: 2,
    maxSelectedPerCity: 3
  });

  assert.deepEqual(result.stats.sections, {
    "关注城市": 2,
    "职业/收入/技术": 2,
    "国家级": 1,
    "实用提醒": 1,
    "国际": 1,
    "热点": 1
  });
  assert.equal(result.items.length, 8);
  assert.ok(result.items.every((entry) => entry.id !== "wrong-city"));
});
