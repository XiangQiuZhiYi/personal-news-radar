const IMPORTANCE_ORDER = { "必读": 0, "值得读": 1, "可选": 2 };

function cleanBrief(value = "") {
  return value
    .replace(/^从\s*\d+\s*条候选(?:信息)?中(?:筛选出|保留)\s*\d+\s*条[。；，]?\s*/u, "")
    .trim();
}

export function mergeCodexResult(candidates, codexResult, metadata = {}) {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const used = new Set();
  const sourceCounts = new Map();
  const categoryCounts = new Map();
  const maxPerSource = metadata.maxSelectedPerSource ?? Number.POSITIVE_INFINITY;
  const maxPerCategory = metadata.maxSelectedPerCategory ?? Number.POSITIVE_INFINITY;
  const maxInternationalItems = metadata.maxInternationalItems ?? Number.POSITIVE_INFINITY;
  let internationalCount = 0;
  const items = [];

  for (const selected of codexResult.items ?? []) {
    const original = byId.get(selected.candidateId);
    if (!original || used.has(original.id)) continue;
    if ((sourceCounts.get(original.source) ?? 0) >= maxPerSource) continue;
    if ((categoryCounts.get(selected.category) ?? 0) >= maxPerCategory) continue;
    if (original.region === "international" && internationalCount >= maxInternationalItems) continue;
    used.add(original.id);
    if (original.region === "international") internationalCount += 1;
    sourceCounts.set(original.source, (sourceCounts.get(original.source) ?? 0) + 1);
    categoryCounts.set(selected.category, (categoryCounts.get(selected.category) ?? 0) + 1);
    items.push({
      ...original,
      category: selected.category,
      score: Math.max(0, Math.min(100, Number(selected.score) || 0)),
      importance: selected.importance,
      summary: selected.summary,
      whyItMatters: selected.whyItMatters,
      confidence: selected.confidence,
      topics: selected.topics
    });
  }

  items.sort((a, b) => {
    const importance = (IMPORTANCE_ORDER[a.importance] ?? 9) - (IMPORTANCE_ORDER[b.importance] ?? 9);
    return importance || b.score - a.score;
  });

  return {
    version: 1,
    generatedAt: metadata.generatedAt ?? new Date().toISOString(),
    date: metadata.date,
    brief: cleanBrief(codexResult.brief),
    stats: {
      sources: metadata.sourceCount ?? 0,
      candidates: candidates.length,
      selected: items.length,
      domesticSelected: items.filter((item) => item.region !== "international").length,
      internationalSelected: items.filter((item) => item.region === "international").length,
      failedSources: metadata.errors?.length ?? 0
    },
    sourceErrors: metadata.errors ?? [],
    discardedReasons: codexResult.discardedReasons ?? [],
    items
  };
}
