// Lead Defteri · zero-knowledge sync endpoint.
//
// The app encrypts every record on the device (AES-256-GCM, key derived from the
// user's sync code). This function only ever sees:
//   space    HMAC-derived 64-hex id of the sync space (not the code itself)
//   rid      HMAC of the record id
//   p        base64 ciphertext
//   u        client timestamp in ms (last-write-wins)
// One JSON document per space lives in Netlify Blobs. Writes use the blob's ETag
// (onlyIfMatch / onlyIfNew), so concurrent pushes from two devices never overwrite
// each other, and every stored record gets a monotonically increasing `s` so
// clients can pull "everything after s" without gaps.
import { getDeployStore, getStore } from "@netlify/blobs";

type Rec = { u: number; d: boolean; p: string; s: number };
type Doc = { v: 1; e: string; seq: number; recs: Record<string, Rec> };

const HEX64 = /^[0-9a-f]{64}$/;
const MAX_ROWS = 500;
const MAX_PAYLOAD = 262144;
const MAX_RECORDS = 100000;
const PAGE = 2000;
const HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  // The app may also be opened from a local file (origin "null"); responses only carry ciphertext.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function blobStore() {
  const opts = { name: "lead-defteri", consistency: "strong" as const };
  // Deploy previews get their own store so test data never reaches production.
  return globalThis.Netlify?.context?.deploy?.context === "production" ? getStore(opts) : getDeployStore(opts);
}

function cleanRows(input: unknown) {
  if (!Array.isArray(input) || input.length > MAX_ROWS) throw new HttpError(400, "invalid rows");
  return input.map((r) => {
    const rid = String(r?.rid ?? "");
    const u = Number(r?.u);
    const p = String(r?.p ?? "");
    if (!HEX64.test(rid) || !Number.isFinite(u) || u <= 0 || p.length > MAX_PAYLOAD) throw new HttpError(400, "invalid row");
    return { rid, u, d: r?.d === true, p };
  });
}

function newEpoch(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ETag first, then data: if another write lands in between, the stale ETag makes the
// conditional write below fail and the push is retried on fresh data.
async function readForUpdate(store: ReturnType<typeof getStore>, key: string) {
  const { blobs } = await store.list({ prefix: key });
  const hit = blobs.find((b) => b.key === key);
  if (!hit) return null;
  if (!hit.etag) throw new Error("blob store returned no etag");
  const data = (await store.get(key, { type: "json" })) as Doc | null;
  return data ? { data, etag: hit.etag } : null;
}

async function push(store: ReturnType<typeof getStore>, key: string, input: unknown): Promise<number> {
  const rows = cleanRows(input);
  for (let attempt = 0; attempt < 16; attempt++) {
    const cur = await readForUpdate(store, key);
    const doc: Doc = cur?.data ?? { v: 1, e: newEpoch(), seq: 0, recs: {} };
    let count = Object.keys(doc.recs).length;
    let changed = false;
    for (const r of rows) {
      const old = doc.recs[r.rid];
      if (old && old.u >= r.u) continue;
      if (!old && ++count > MAX_RECORDS) throw new HttpError(413, "space quota exceeded");
      doc.recs[r.rid] = { u: r.u, d: r.d, p: r.p, s: ++doc.seq };
      changed = true;
    }
    if (!changed) return doc.seq;
    const cond = cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true };
    const res = await store.setJSON(key, doc, { metadata: { seq: doc.seq, e: doc.e }, ...cond });
    if (res.modified) return doc.seq;
    await new Promise((ok) => setTimeout(ok, 40 + Math.random() * 120 * (attempt + 1)));
  }
  throw new HttpError(409, "busy, retry");
}

async function pull(store: ReturnType<typeof getStore>, key: string, since: number, epoch: string) {
  const meta = await store.getMetadata(key);
  if (!meta) return { rows: [], more: false, cursor: 0, epoch: "" };
  // A different epoch means the space was wiped and recreated: send everything.
  if (meta.metadata?.e !== epoch) since = 0;
  if (Number(meta.metadata?.seq ?? 0) <= since) return { rows: [], more: false, cursor: since, epoch: meta.metadata?.e ?? "" };
  const doc = (await store.get(key, { type: "json" })) as Doc | null;
  if (!doc) return { rows: [], more: false, cursor: 0, epoch: "" };
  const fresh = Object.entries(doc.recs).filter(([, r]) => r.s > since).sort((a, b) => a[1].s - b[1].s);
  const page = fresh.slice(0, PAGE);
  return {
    rows: page.map(([rid, r]) => ({ rid, updated_at: r.u, deleted: r.d, payload: r.p, seq: r.s })),
    more: fresh.length > PAGE,
    cursor: page.length ? page[page.length - 1][1].s : since,
    epoch: doc.e,
  };
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  if (req.method !== "POST") return reply({ message: "method not allowed" }, 405);
  try {
    const body = await req.json().catch(() => {
      throw new HttpError(400, "invalid json");
    });
    const space = String(body?.p_space ?? "");
    if (!HEX64.test(space)) throw new HttpError(400, "invalid space");
    const fn = new URL(req.url).pathname.split("/").pop();
    const store = blobStore();
    const key = `space/${space}`;
    if (fn === "push") return reply({ seq: await push(store, key, body.p_rows) });
    if (fn === "pull") return reply(await pull(store, key, Math.max(0, Number(body.p_since) || 0), String(body.p_epoch ?? "")));
    if (fn === "wipe") {
      await store.delete(key);
      return reply({ ok: true });
    }
    throw new HttpError(404, "not found");
  } catch (e) {
    if (e instanceof HttpError) return reply({ message: e.message }, e.status);
    console.error(e);
    return reply({ message: "server error" }, 500);
  }
};

export const config = { path: "/api/sync/*" };
