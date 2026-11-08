// MemoryStore — one interface, two backends.
//
//   MemWalStore : real Walrus Memory via @mysten-incubation/memwal against
//                 the mainnet relayer. Used when MEMWAL_KEY (delegate private
//                 key) and MEMWAL_ACCOUNT_ID are set in the environment.
//   LocalStore  : JSON file at data/local-memories.json, blob ids "local-<n>".
//                 Used automatically when the creds are absent (dry mode).
//
// Interface (all async):
//   remember(text)          -> { blobId }   (MemWal: waits for the job to
//                                            finish so the blob_id is real)
//   recall(query, limit=20) -> [{ blobId, text, distance, createdAt }]
//   listAll()               -> [{ blobId, text|null, createdAt }] oldest first
//   count()                 -> number of memories in the namespace
//   .mode / .modeLabel / .namespace describe which backend is live.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const RELAYER_URL = "https://relayer.memory.walrus.xyz";
export const NAMESPACE = process.env.MEMWAL_NAMESPACE || "mintredceh";
const LOCAL_FILE = fileURLToPath(new URL("../data/local-memories.json", import.meta.url));

export function hasMemWalCreds() {
  return Boolean(process.env.MEMWAL_KEY && process.env.MEMWAL_ACCOUNT_ID);
}

// ---------------------------------------------------------------- LocalStore
class LocalStore {
  constructor(file = LOCAL_FILE, namespace = NAMESPACE) {
    this.mode = "local";
    this.modeLabel = "LOCAL DRY MODE";
    this.namespace = namespace;
    this.file = file;
  }

  _load() {
    if (!existsSync(this.file)) return { nextId: 1, entries: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8"));
      if (Array.isArray(parsed)) return { nextId: parsed.length + 1, entries: parsed };
      return { nextId: parsed.nextId ?? parsed.entries.length + 1, entries: parsed.entries ?? [] };
    } catch {
      return { nextId: 1, entries: [] };
    }
  }

  _save(state) {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, this.file);
  }

  async remember(text) {
    const state = this._load();
    const blobId = `local-${state.nextId}`;
    state.entries.push({ blobId, text, createdAt: new Date().toISOString() });
    state.nextId += 1;
    this._save(state);
    return { blobId };
  }

  async recall(query, limit = 20) {
    const terms = [...new Set(String(query).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1))];
    const { entries } = this._load();
    const scored = [];
    for (const e of entries) {
      const hay = e.text.toLowerCase();
      const hits = terms.filter((t) => hay.includes(t)).length;
      if (hits > 0) scored.push({ ...e, distance: 1 / (1 + hits) });
    }
    // Most keyword hits first, newest first on ties — a stand-in for the
    // relayer's semantic ranking, good enough for dry mode.
    scored.sort((a, b) => a.distance - b.distance || (a.createdAt < b.createdAt ? 1 : -1));
    return scored.slice(0, limit).map(({ blobId, text, createdAt, distance }) => ({ blobId, text, createdAt, distance }));
  }

  async listAll() {
    const { entries } = this._load();
    return entries.map(({ blobId, text, createdAt }) => ({ blobId, text, createdAt }));
  }

  async count() {
    return this._load().entries.length;
  }
}

// -------------------------------------------------------------- MemWalStore
class MemWalStore {
  constructor(client, namespace = NAMESPACE) {
    this.mode = "walrus";
    this.modeLabel = "WALRUS MAINNET";
    this.namespace = namespace;
    this.client = client;
  }

  static async create() {
    const { MemWal } = await import("@mysten-incubation/memwal");
    const client = MemWal.create({
      key: process.env.MEMWAL_KEY,
      accountId: process.env.MEMWAL_ACCOUNT_ID,
      serverUrl: RELAYER_URL,
      namespace: NAMESPACE,
    });
    return new MemWalStore(client, NAMESPACE);
  }

  async remember(text) {
    // rememberAndWait polls the relayer job to completion (~20s typical) so
    // callers always get the real Walrus blob_id back.
    const res = await this.client.rememberAndWait(text, undefined, { timeoutMs: 120_000 });
    return { blobId: res.blob_id };
  }

  async recall(query, limit = 20) {
    const res = await this.client.recall({ query, limit, namespace: this.namespace });
    return (res.results || []).map((r) => ({
      blobId: r.blob_id,
      text: r.text,
      distance: r.distance,
      createdAt: r.created_at ?? null,
    }));
  }

  // Full inventory (blob ids + write times) from listMemories, which is
  // metadata-only; texts are joined in from a broad recall. A memory whose
  // text the recall window missed comes back with text: null — counted, but
  // never parsed or quoted by the brain.
  async _inventory() {
    const out = [];
    let cursor;
    let more = true;
    while (more) {
      const page = await this.client.listMemories({ cursor, limit: 500, namespace: this.namespace });
      for (const m of page.memories || []) out.push({ blobId: m.blob_id, createdAt: m.created_at });
      cursor = page.next_cursor ?? undefined;
      more = Boolean(page.has_more);
    }
    return out;
  }

  async listAll() {
    const inventory = await this._inventory();
    const textByBlob = new Map();
    for (const q of [
      "Mint RedCeh check",
      "Mint RedCeh check bucket chain facts signals contract",
      "Agent Cards Agent Zet Pixel Boyz Cretivox EnigmaAgent CodexNFT Gull Agentic Coin",
    ]) {
      try {
        const hits = await this.recall(q, 100);
        for (const h of hits) if (!textByBlob.has(h.blobId)) textByBlob.set(h.blobId, h.text);
      } catch {
        /* recall is best-effort here; inventory still counts */
      }
      if (textByBlob.size >= inventory.length) break;
    }
    return inventory
      .map((e) => ({ ...e, text: textByBlob.get(e.blobId) ?? null }))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }

  async count() {
    return (await this._inventory()).length;
  }
}

// ------------------------------------------------------------------ factory
/** Pick the backend from the environment: real MemWal iff creds are present. */
export async function createStore() {
  if (hasMemWalCreds()) return MemWalStore.create();
  return new LocalStore();
}

export { LocalStore, MemWalStore };
