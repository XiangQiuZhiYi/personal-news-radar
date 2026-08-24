const IMPORTANCE_ORDER = { "必读": 0, "值得读": 1, "可选": 2 };
const ADJACENT_OPPORTUNITY_TOPIC = "相邻领域机会";
const UNFAMILIAR_OPPORTUNITY_TOPIC = "陌生领域机会";

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
  const cityCounts = new Map();
  const maxPerSource = metadata.maxSelectedPerSource ?? Number.POSITIVE_INFINITY;
  const maxSelectedBySource = metadata.maxSelectedBySource ?? {};
  const maxPerCategory = metadata.maxSelectedPerCategory ?? Number.POSITIVE_INFINITY;
  const maxInternationalItems = metadata.maxInternationalItems ?? Number.POSITIVE_INFINITY;
  const maxPerCity = metadata.maxSelectedPerCity ?? Number.POSITIVE_INFINITY;
  const maxAdjacentItems = metadata.maxAdjacentOpportunityItems ?? Number.POSITIVE_INFINITY;
  const maxUnfamiliarItems = metadata.maxUnfamiliarOpportunityItems ?? Number.POSITIVE_INFINITY;
  const sectionLimits = metadata.sectionLimits ?? {};
  const configuredSections = Object.keys(sectionLimits);
  const sectionCounts = new Map(configuredSections.map((section) => [section, 0]));
  let internationalCount = 0;
  let adjacentOpportunityCount = 0;
  let unfamiliarOpportunityCount = 0;
  const items = [];

  for (const selected of codexResult.items ?? []) {
    const original = byId.get(selected.candidateId);
    if (!original || used.has(original.id)) continue;
    const sourceLimit = Math.min(maxPerSource, maxSelectedBySource[original.source] ?? Number.POSITIVE_INFINITY);
    if ((sourceCounts.get(original.source) ?? 0) >= sourceLimit) continue;
    if ((categoryCounts.get(selected.category) ?? 0) >= maxPerCategory) continue;
    if (original.city && (cityCounts.get(original.city) ?? 0) >= maxPerCity) continue;
    if (original.region === "international" && internationalCount >= maxInternationalItems) continue;
    const contentSection = selected.contentSection;
    if (configuredSections.length > 0 && !Object.hasOwn(sectionLimits, contentSection)) continue;
    if (contentSection && (sectionCounts.get(contentSection) ?? 0) >= (sectionLimits[contentSection] ?? Number.POSITIVE_INFINITY)) continue;
    if (configuredSections.length > 0 && original.city && contentSection !== "关注城市") continue;
    if (configuredSections.length > 0 && !original.city && contentSection === "关注城市") continue;
    if (configuredSections.length > 0 && original.region === "international" && contentSection !== "国际") continue;
    if (configuredSections.length > 0 && original.region !== "international" && contentSection === "国际") continue;
    const isAdjacentOpportunity = selected.topics?.includes(ADJACENT_OPPORTUNITY_TOPIC) ?? false;
    const isUnfamiliarOpportunity = selected.topics?.includes(UNFAMILIAR_OPPORTUNITY_TOPIC) ?? false;
    if (isAdjacentOpportunity && isUnfamiliarOpportunity) continue;
    const isCareerSection = contentSection === "职业/收入/技术";
    if (configuredSections.length > 0 && isCareerSection !== (isAdjacentOpportunity || isUnfamiliarOpportunity)) continue;
    if (isAdjacentOpportunity && adjacentOpportunityCount >= maxAdjacentItems) continue;
    if (isUnfamiliarOpportunity && unfamiliarOpportunityCount >= maxUnfamiliarItems) continue;
    used.add(original.id);
    if (original.region === "international") internationalCount += 1;
    if (isAdjacentOpportunity) adjacentOpportunityCount += 1;
    if (isUnfamiliarOpportunity) unfamiliarOpportunityCount += 1;
    if (contentSection) sectionCounts.set(contentSection, (sectionCounts.get(contentSection) ?? 0) + 1);
    sourceCounts.set(original.source, (sourceCounts.get(original.source) ?? 0) + 1);
    categoryCounts.set(selected.category, (categoryCounts.get(selected.category) ?? 0) + 1);
    if (original.city) cityCounts.set(original.city, (cityCounts.get(original.city) ?? 0) + 1);
    items.push({
      ...original,
      contentSection,
      category: selected.category,
      score: Math.max(0, Math.min(100, Number(selected.score) || 0)),
      importance: selected.importance,
      summary: selected.summary,
      whyItMatters: selected.whyItMatters,
      impactForPeople: selected.impactForPeople,
      impactAnalysis: selected.impactAnalysis,
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
      adjacentOpportunitySelected: adjacentOpportunityCount,
      unfamiliarOpportunitySelected: unfamiliarOpportunityCount,
      sections: Object.fromEntries(sectionCounts.entries()),
      citySelected: items.filter((item) => item.city).length,
      cities: Object.fromEntries([...cityCounts.entries()]),
      failedSources: metadata.errors?.length ?? 0
    },
    sourceErrors: metadata.errors ?? [],
    discardedReasons: codexResult.discardedReasons ?? [],
    items
  };
}
