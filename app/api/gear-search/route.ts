type SearchResult = {
  title?: string;
  link?: string;
  snippet?: string;
};

type ImageResult = {
  title?: string;
  link?: string;
  source?: string;
  original?: string;
  thumbnail?: string;
  original_width?: number;
  original_height?: number;
};

type SuggestedValue = {
  value: number | null;
  evidence: string | null;
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function numberFrom(text: string): number {
  return Number(text.replace(",", "."));
}

function findSuggested(
  blocks: string[],
  patterns: RegExp[],
): SuggestedValue {
  for (const block of blocks) {
    for (const pattern of patterns) {
      const match = block.match(pattern);
      if (match?.[1]) {
        const value = numberFrom(match[1]);
        if (Number.isFinite(value)) {
          return {
            value,
            evidence: block.length > 240 ? `${block.slice(0, 237)}...` : block,
          };
        }
      }
    }
  }
  return { value: null, evidence: null };
}

function classifyImage(item: ImageResult): "front" | "back" | "unknown" {
  const haystack = `${item.title ?? ""} ${item.link ?? ""}`.toLowerCase();
  if (/\b(rear|back|backside|achterkant|rearview)\b/.test(haystack)) return "back";
  if (/\b(front|frontpanel|voorkant|frontview)\b/.test(haystack)) return "front";
  return "unknown";
}

async function serpRequest(params: Record<string, string>, apiKey: string) {
  const url = new URL("https://serpapi.com/search.json");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("api_key", apiKey);
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok || data.error) {
    throw new Error(String(data.error ?? `Search service returned status ${response.status}`));
  }
  return data;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { query?: unknown };
    const query = typeof body.query === "string" ? body.query.trim().slice(0, 160) : "";
    if (query.length < 2) {
      return new Response(JSON.stringify({ error: "Enter a brand and model number." }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const browserKey = request.headers.get("x-serpapi-key")?.trim();
    const apiKey = process.env.SERPAPI_KEY?.trim() || browserKey;
    if (!apiKey) {
      return new Response(JSON.stringify({
        error: "The search service has not been connected yet.",
        needsKey: true,
      }), { status: 401, headers: jsonHeaders });
    }

    const [webData, imageData] = await Promise.all([
      serpRequest({
        engine: "google",
        q: `${query} rack units RU height weight kg depth mm dimensions specification datasheet pdf`,
        hl: "en",
        gl: "nl",
        num: "10",
      }, apiKey),
      serpRequest({
        engine: "google_images",
        q: `${query} rackmount front panel rear panel product`,
        hl: "en",
        gl: "nl",
        tbs: "isz:l",
      }, apiKey),
    ]);

    const organic = Array.isArray(webData.organic_results)
      ? (webData.organic_results as SearchResult[]).slice(0, 8)
      : [];
    const knowledge = webData.knowledge_graph as Record<string, unknown> | undefined;
    const blocks = [
      knowledge ? JSON.stringify(knowledge) : "",
      ...organic.map((item) => `${item.title ?? ""}. ${item.snippet ?? ""}`),
    ].filter(Boolean);

    const he = findSuggested(blocks, [
      /(?:rack\s*(?:units?)?|rack\s*height|height|hoogte)\s*[:\-]?\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:ru|u|he)\b/i,
      /\b(\d{1,2}(?:[.,]\d+)?)\s*(?:ru|rack\s*units?|he)\b/i,
    ]);
    const weight = findSuggested(blocks, [
      /(?:weight|gewicht|net\s*weight)\s*[:\-]?\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*kg\b/i,
      /\b(\d{1,3}(?:[.,]\d{1,2})?)\s*kg\b/i,
    ]);
    const depth = findSuggested(blocks, [
      /(?:depth|diepte)\s*[:\-]?\s*(\d{2,4}(?:[.,]\d+)?)\s*mm\b/i,
      /\b\d{2,4}\s*[x×]\s*\d{2,4}\s*[x×]\s*(\d{2,4})\s*mm\b/i,
    ]);

    const rawImages = Array.isArray(imageData.images_results)
      ? imageData.images_results as ImageResult[]
      : [];
    const images = rawImages
      .filter((item) => item.original || item.thumbnail)
      .slice(0, 16)
      .map((item, index) => ({
        id: `img-${index}`,
        title: item.title ?? "Product photo",
        source: item.source ?? "",
        sourceUrl: item.link ?? "",
        imageUrl: item.original ?? item.thumbnail ?? "",
        thumbnailUrl: item.thumbnail ?? item.original ?? "",
        width: item.original_width ?? null,
        height: item.original_height ?? null,
        suggestedSide: classifyImage(item),
      }));

    return new Response(JSON.stringify({
      query,
      suggestions: {
        he,
        weight,
        depth,
      },
      sources: organic.map((item) => ({
        title: item.title ?? "Source",
        url: item.link ?? "",
        snippet: item.snippet ?? "",
      })).filter((item) => item.url),
      images,
      usage: { searchesUsed: 2 },
    }), { status: 200, headers: jsonHeaders });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Search failed.",
    }), { status: 502, headers: jsonHeaders });
  }
}
