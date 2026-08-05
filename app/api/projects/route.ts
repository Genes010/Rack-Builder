const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

type ProjectPayload = {
  name?: unknown;
  state?: unknown;
};

type RackState = {
  library?: unknown[];
  racks?: unknown[];
  external?: unknown[];
};

function usedGearCount(state: RackState) {
  const ids = new Set<string>();
  for (const rack of state.racks ?? []) {
    if (!rack || typeof rack !== "object") continue;
    const placed = (rack as { placed?: unknown }).placed;
    if (!Array.isArray(placed)) continue;
    for (const item of placed) {
      if (!item || typeof item !== "object") continue;
      const libId = (item as { libId?: unknown }).libId;
      if (typeof libId === "string" && !libId.startsWith("blank")) ids.add(libId);
    }
  }
  for (const item of state.external ?? []) {
    if (!item || typeof item !== "object") continue;
    const libId = (item as { libId?: unknown }).libId;
    if (typeof libId === "string") ids.add(libId);
  }
  return ids.size;
}

interface ProjectStatement {
  bind(...values: unknown[]): ProjectStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

interface ProjectDatabase {
  prepare(query: string): ProjectStatement;
  batch(statements: ProjectStatement[]): Promise<unknown>;
}

interface ProjectObject {
  text(): Promise<string>;
}

interface ProjectBucket {
  get(key: string): Promise<ProjectObject | null>;
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}

type RuntimeBindings = { DB: ProjectDatabase; BUCKET: ProjectBucket };

function getBindings(): RuntimeBindings {
  const bindings = (globalThis as typeof globalThis & { __rackBuilderBindings?: RuntimeBindings }).__rackBuilderBindings;
  if (!bindings?.DB || !bindings?.BUCKET) throw new Error("Project storage is unavailable.");
  return bindings;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function cleanName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 80) : "";
}

function projectId(request: Request) {
  return new URL(request.url).searchParams.get("id")?.trim() ?? "";
}

function validId(value: string) {
  return /^[0-9a-f-]{36}$/i.test(value);
}

async function ensureSchema(db: ProjectDatabase) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS rack_projects (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      object_key TEXT NOT NULL,
      rack_count INTEGER DEFAULT 0 NOT NULL,
      gear_count INTEGER DEFAULT 0 NOT NULL,
      size_bytes INTEGER DEFAULT 0 NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS rack_projects_updated_at_idx ON rack_projects (updated_at)"),
  ]);
}

async function readPayload(request: Request): Promise<{ name: string; state: RackState; text: string } | Response> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 25_000_000) return json({ error: "This project is too large to save." }, 413);
  let body: ProjectPayload;
  try {
    body = JSON.parse(raw) as ProjectPayload;
  } catch {
    return json({ error: "Invalid project data." }, 400);
  }
  const name = cleanName(body.name);
  const state = body.state as RackState;
  if (!name) return json({ error: "Enter a project name." }, 400);
  if (!state || !Array.isArray(state.racks) || !Array.isArray(state.library)) {
    return json({ error: "The rack project data is incomplete." }, 400);
  }
  const text = JSON.stringify(state);
  if (new TextEncoder().encode(text).byteLength > 24_000_000) return json({ error: "This project is too large to save." }, 413);
  return { name, state, text };
}

export async function GET(request: Request) {
  try {
    const { DB, BUCKET } = getBindings();
    await ensureSchema(DB);
    const id = projectId(request);
    if (!id) {
      const result = await DB.prepare(
        "SELECT id, name, rack_count AS rackCount, gear_count AS gearCount, size_bytes AS sizeBytes, created_at AS createdAt, updated_at AS updatedAt FROM rack_projects ORDER BY updated_at DESC",
      ).all();
      return json({ projects: result.results });
    }
    if (!validId(id)) return json({ error: "Invalid project id." }, 400);
    const row = await DB.prepare(
      "SELECT id, name, object_key AS objectKey, rack_count AS rackCount, gear_count AS gearCount, created_at AS createdAt, updated_at AS updatedAt FROM rack_projects WHERE id = ?",
    ).bind(id).first<Record<string, unknown>>();
    if (!row) return json({ error: "Project not found." }, 404);
    const object = await BUCKET.get(String(row.objectKey));
    if (!object) return json({ error: "The saved project file is missing." }, 404);
    const state = JSON.parse(await object.text()) as RackState;
    return json({ project: { ...row, state } });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not load projects." }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const { DB, BUCKET } = getBindings();
    await ensureSchema(DB);
    const payload = await readPayload(request);
    if (payload instanceof Response) return payload;
    const id = crypto.randomUUID();
    const objectKey = `rack-projects/${id}.json`;
    const now = Date.now();
    const sizeBytes = new TextEncoder().encode(payload.text).byteLength;
    const gearCount = usedGearCount(payload.state);
    await BUCKET.put(objectKey, payload.text, { httpMetadata: { contentType: "application/json; charset=utf-8" } });
    try {
      await DB.prepare(
        "INSERT INTO rack_projects (id, name, object_key, rack_count, gear_count, size_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(id, payload.name, objectKey, payload.state.racks?.length ?? 0, gearCount, sizeBytes, now, now).run();
    } catch (error) {
      await BUCKET.delete(objectKey);
      throw error;
    }
    return json({ project: { id, name: payload.name, rackCount: payload.state.racks?.length ?? 0, gearCount, sizeBytes, createdAt: now, updatedAt: now } }, 201);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not save project." }, 500);
  }
}

export async function PUT(request: Request) {
  try {
    const { DB, BUCKET } = getBindings();
    await ensureSchema(DB);
    const id = projectId(request);
    if (!validId(id)) return json({ error: "Invalid project id." }, 400);
    const existing = await DB.prepare("SELECT object_key AS objectKey, created_at AS createdAt FROM rack_projects WHERE id = ?").bind(id).first<Record<string, unknown>>();
    if (!existing) return json({ error: "Project not found." }, 404);
    const payload = await readPayload(request);
    if (payload instanceof Response) return payload;
    const now = Date.now();
    const objectKey = String(existing.objectKey);
    const sizeBytes = new TextEncoder().encode(payload.text).byteLength;
    const gearCount = usedGearCount(payload.state);
    await BUCKET.put(objectKey, payload.text, { httpMetadata: { contentType: "application/json; charset=utf-8" } });
    await DB.prepare(
      "UPDATE rack_projects SET name = ?, rack_count = ?, gear_count = ?, size_bytes = ?, updated_at = ? WHERE id = ?",
    ).bind(payload.name, payload.state.racks?.length ?? 0, gearCount, sizeBytes, now, id).run();
    return json({ project: { id, name: payload.name, rackCount: payload.state.racks?.length ?? 0, gearCount, sizeBytes, createdAt: existing.createdAt, updatedAt: now } });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not update project." }, 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const { DB, BUCKET } = getBindings();
    await ensureSchema(DB);
    const id = projectId(request);
    if (!validId(id)) return json({ error: "Invalid project id." }, 400);
    const existing = await DB.prepare("SELECT object_key AS objectKey FROM rack_projects WHERE id = ?").bind(id).first<Record<string, unknown>>();
    if (!existing) return json({ error: "Project not found." }, 404);
    await BUCKET.delete(String(existing.objectKey));
    await DB.prepare("DELETE FROM rack_projects WHERE id = ?").bind(id).run();
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not delete project." }, 500);
  }
}
