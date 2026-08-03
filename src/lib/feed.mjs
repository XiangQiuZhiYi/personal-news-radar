import { createHash } from "node:crypto";

const XML_ENTITIES = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: "\"",
  nbsp: " "
};

export function decodeEntities(value = "") {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return XML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function cleanText(value = "", maxLength = 2400) {
  const text = decodeEntities(
    value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, maxLength);
}

function tagContent(block, tagNames) {
  for (const tag of tagNames) {
    const escaped = tag.replace(":", "\\:");
    const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
    if (match) return match[1];
  }
  return "";
}

function atomLink(block) {
  const alternate = block.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i);
  if (alternate) return alternate[1];
  const href = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i);
  return href?.[1] ?? "";
}

function safeIsoDate(value) {
  const timestamp = Date.parse(cleanText(value));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function stableId(sourceName, url, title) {
  return createHash("sha256")
    .update(`${sourceName}\n${url}\n${title}`)
    .digest("hex")
    .slice(0, 16);
}

function extractFeedTitle(xml) {
  const channel = xml.match(/<channel\b[^>]*>([\s\S]*?)<\/channel>/i)?.[1];
  const scope = channel ?? xml;
  return cleanText(tagContent(scope, ["title"]), 200);
}

export function parseFeed(xml, source = {}) {
  const rssBlocks = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => ({
    type: "rss",
    body: match[1]
  }));
  const atomBlocks = [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((match) => ({
    type: "atom",
    body: match[1]
  }));
  const blocks = rssBlocks.length > 0 ? rssBlocks : atomBlocks;
  const feedTitle = source.name || extractFeedTitle(xml) || "未知来源";

  return blocks
    .map(({ type, body }) => {
      const title = cleanText(tagContent(body, ["title"]), 500);
      const link = type === "atom"
        ? atomLink(body)
        : cleanText(tagContent(body, ["link", "guid"]), 2000);
      const description = cleanText(
        tagContent(body, ["content:encoded", "content", "summary", "description"])
      );
      const publishedAt = safeIsoDate(
        tagContent(body, ["published", "updated", "pubDate", "dc:date"])
      );

      if (!title || !link) return null;
      return {
        id: stableId(feedTitle, link, title),
        source: feedTitle,
        sourceUrl: source.url ?? "",
        categoryHint: source.categoryHint ?? "",
        region: source.region ?? "domestic",
        title,
        url: decodeEntities(link),
        description,
        publishedAt
      };
    })
    .filter(Boolean);
}

export function canonicalUrl(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|source$|campaign$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

export function normalizedTitle(value) {
  return value
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .slice(0, 160);
}

export function dedupeItems(items) {
  const seenUrls = new Set();
  const seenTitles = new Set();
  return items.filter((item) => {
    const url = canonicalUrl(item.url);
    const title = normalizedTitle(item.title);
    if (seenUrls.has(url) || seenTitles.has(title)) return false;
    seenUrls.add(url);
    seenTitles.add(title);
    return true;
  });
}

export function interleaveBatches(batches) {
  const interleaved = [];
  const maxLength = Math.max(0, ...batches.map((batch) => batch.length));
  for (let index = 0; index < maxLength; index += 1) {
    for (const batch of batches) {
      if (batch[index]) interleaved.push(batch[index]);
    }
  }
  return interleaved;
}

export async function fetchFeeds(config, now = new Date()) {
  const sources = config.sources.filter((source) => source.enabled !== false);
  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const response = await fetch(source.url, {
        headers: {
          accept: "application/atom+xml, application/rss+xml, application/xml, text/xml, */*",
          "user-agent": "PersonalNewsRadar/0.1 (+local personal reader)"
        },
        signal: AbortSignal.timeout(config.requestTimeoutMs ?? 15000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();
      return parseFeed(xml, source).slice(0, config.maxItemsPerSource ?? 30);
    })
  );

  const errors = [];
  const itemBatches = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      itemBatches.push(result.value);
    } else {
      errors.push({
        source: sources[index].name,
        url: sources[index].url,
        error: result.reason?.message ?? String(result.reason)
      });
    }
  });

  const cutoff = now.getTime() - (config.sinceHours ?? 36) * 60 * 60 * 1000;
  const recentBatches = itemBatches.map((batch) => batch.filter((item) => {
      if (!item.publishedAt) return true;
      return Date.parse(item.publishedAt) >= cutoff;
    }));

  return {
    items: dedupeItems(interleaveBatches(recentBatches)).slice(0, config.maxCandidates ?? 100),
    errors,
    sourceCount: sources.length
  };
}
