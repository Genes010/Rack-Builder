const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

interface LibraryObject {
  text(): Promise<string>;
}

interface LibraryBucket {
  get(key: string): Promise<LibraryObject | null>;
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
}

type RuntimeBindings = { BUCKET: LibraryBucket };
const libraryKey = "rack-library/permanent-gear-library.json";

function getBucket() {
  const bindings = (globalThis as typeof globalThis & { __rackBuilderBindings?: RuntimeBindings }).__rackBuilderBindings;
  if (!bindings?.BUCKET) throw new Error("Permanent gear storage is unavailable.");
  return bindings.BUCKET;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function validGearLibrary(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.length <= 2000 && value.every((gear) =>
    gear && typeof gear === "object" && typeof (gear as Record<string, unknown>).id === "string" && typeof (gear as Record<string, unknown>).name === "string"
  );
}

export async function GET() {
  try {
    const object = await getBucket().get(libraryKey);
    if (!object) return json({ library: [] });
    const library = JSON.parse(await object.text()) as unknown;
    if (!validGearLibrary(library)) throw new Error("The saved gear library is invalid.");
    return json({ library });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not load the gear library." }, 500);
  }
}

export async function PUT(request: Request) {
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 25_000_000) return json({ error: "The gear library is too large to save." }, 413);
    let body: { library?: unknown };
    try {
      body = JSON.parse(raw) as { library?: unknown };
    } catch {
      return json({ error: "Invalid gear library data." }, 400);
    }
    if (!validGearLibrary(body.library)) return json({ error: "The gear library data is incomplete." }, 400);
    const unique = [...new Map(body.library.map((gear) => [String(gear.id), gear])).values()];
    const text = JSON.stringify(unique);
    const sizeBytes = new TextEncoder().encode(text).byteLength;
    if (sizeBytes > 24_000_000) return json({ error: "The gear library is too large to save." }, 413);
    await getBucket().put(libraryKey, text, { httpMetadata: { contentType: "application/json; charset=utf-8" } });
    return json({ ok: true, count: unique.length, sizeBytes });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not save the gear library." }, 500);
  }
}
