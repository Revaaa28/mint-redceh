// Mint RedCeh — Walrus Memory layer.
// Every verified board check is written to Walrus Memory (namespace
// "mintredceh") as a plain-text record: the listing, its contract, the
// bucket verdict and the chain facts AS READ AT THAT MOMENT. The ask box
// answers ONLY from these records — when a contract first appeared on the
// radar, how its checks evolved, whether its bucket ever changed.
// Deterministic parsing, no LLM: if it is not in a memory, the radar
// does not claim to know it.
import { getSuiCheckpoint } from "./tatum.js";

export function composeListingMemory(entry, checkpoint) {
  const f = entry.facts || {};
  const facts = [];
  if (f.pending) facts.push(`chain facts pending: ${f.pending}`);
  else {
    facts.push(`Sourcify: ${f.sourcify}`);
    if (f.onchainName) facts.push(`on-chain name: ${f.onchainName} (${f.onchainSymbol || "?"})`);
    if (f.supplyNow) facts.push(`minted: ${f.supplyNow}${f.supplyMax ? "/" + f.supplyMax : ""}`);
    if (f.supplyNote) facts.push(f.supplyNote);
    if (f.tokenSupply) facts.push(`token total supply: ${f.tokenSupply}`);
    if (f.probes) for (const [k, v] of Object.entries(f.probes)) facts.push(`${k}: ${v}`);
  }
  const signals = entry.signals.map((s) => `[${s.type}] ${s.text}`).join("; ");
  return [
    `Mint RedCeh check — ${entry.name} (${entry.id})`,
    `Contract: ${entry.contract || "not yet confirmed"} · BNB Chain (56)`,
    `Bucket: ${entry.bucket}`,
    `Claim: ${entry.claim.headline} | mint price: ${entry.claim.mintPrice} | supply: ${entry.claim.supply}`,
    `Chain facts: ${facts.join("; ")}`,
    `Signals: ${signals}`,
    `Checked: ${f.checkedAt || new Date().toISOString()} · Sui checkpoint: ${checkpoint} (via Tatum)`,
  ].join("\n");
}

const RE = {
  head: /^Mint RedCeh check — (.+) \((.+)\)$/m,
  contract: /^Contract: (\S+) ·/m,
  bucket: /^Bucket: (\S+)$/m,
  facts: /^Chain facts: (.+)$/m,
  checked: /^Checked: (\S+) · Sui checkpoint: (\S+)/m,
};

export function parseListingMemory(text, blobId, createdAt) {
  if (!text) return null;
  const head = text.match(RE.head);
  if (!head) return null;
  return {
    blobId,
    createdAt,
    name: head[1],
    id: head[2],
    contract: text.match(RE.contract)?.[1] || null,
    bucket: text.match(RE.bucket)?.[1] || null,
    facts: text.match(RE.facts)?.[1] || "",
    checkedAt: text.match(RE.checked)?.[1] || createdAt,
    checkpoint: text.match(RE.checked)?.[2] || null,
    text,
  };
}

// Write one memory per listing. Sequential with a pause — the Walrus
// relayer allows ~180 weighted requests/min per delegate key.
export async function writeBoardMemories(store, board) {
  const checkpoint = await getSuiCheckpoint();
  const written = [];
  for (const entry of board) {
    const text = composeListingMemory(entry, checkpoint);
    const { blobId } = await store.remember(text);
    written.push({ id: entry.id, blobId });
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { checkpoint, written };
}

// Parse pool for a read: listAll() plus a targeted recall merge.
// On the Walrus backend, listAll() joins texts from a few broad recalls
// only, so most memories come back text-less and unparseable — the ask
// box and the history panels would only ever "know" the handful of
// listings those broad recalls happened to surface. A targeted recall
// for the subject actually being asked about finds that listing's own
// records reliably, so merge its texts in (by blob id) before parsing.
// Read-path only; the stored memories are never touched.
async function loadParsedWithRecall(store, queries) {
  const all = await store.listAll();
  const textByBlob = new Map();
  const createdByBlob = new Map();
  for (const e of all) {
    if (e.createdAt) createdByBlob.set(e.blobId, e.createdAt);
    if (e.text) textByBlob.set(e.blobId, e.text);
  }
  for (const q of queries) {
    if (!q) continue;
    try {
      const hits = await store.recall(q, 100);
      for (const h of hits) {
        if (h.text && !textByBlob.has(h.blobId)) textByBlob.set(h.blobId, h.text);
        if (h.createdAt && !createdByBlob.has(h.blobId)) createdByBlob.set(h.blobId, h.createdAt);
      }
    } catch {
      /* targeted recall is best-effort; the broad pool still applies */
    }
  }
  const parsed = [];
  for (const [blobId, text] of textByBlob) {
    const p = parseListingMemory(text, blobId, createdByBlob.get(blobId) ?? null);
    if (p) parsed.push(p);
  }
  return parsed;
}

// Full check history for ONE listing, by exact seed id — backs the
// per-card "check history" panel on the site.
export async function historyForListing(store, id) {
  const parsed = await loadParsedWithRecall(store, [id, String(id).replace(/[-_]+/g, " ")]);
  const checks = parsed
    .filter((p) => p.id === id)
    .sort((a, b) => (a.checkedAt < b.checkedAt ? -1 : 1));
  if (!checks.length) return { found: false, id };
  const first = checks[0];
  return {
    found: true,
    id,
    name: first.name,
    contract: first.contract,
    firstSeen: first.checkedAt,
    timesChecked: checks.length,
    currentBucket: checks[checks.length - 1].bucket,
    bucketHistory: [...new Set(checks.map((c) => c.bucket))],
    checks: checks.map((c) => ({
      at: c.checkedAt,
      bucket: c.bucket,
      facts: c.facts,
      blobId: c.blobId,
      checkpoint: c.checkpoint,
    })),
  };
}

// Answer a question from memory only. Matches by listing name, id, or
// contract address fragment; returns the full check history per listing.
// boardHints (the current board's id/name/contract triples) are used for
// ONE thing: a raw contract fragment cannot be found by semantic recall,
// so the board's verified contracts identify which listing to recall by
// name. The answer itself still comes only from memory records.
export async function askRadar(store, q, boardHints = []) {
  const query = String(q || "").trim().toLowerCase();
  if (!query) return { found: false, error: "empty query" };
  const recallQueries = [String(q).trim()];
  if (/0x[0-9a-f]{6,}/.test(query) || /^[0-9a-f]{10,}$/.test(query)) {
    for (const h of boardHints) {
      if (h?.contract && h.contract.toLowerCase().includes(query)) {
        recallQueries.push(h.name, h.id);
      }
    }
  }
  const parsed = await loadParsedWithRecall(store, recallQueries);
  const byId = new Map();
  for (const p of parsed) {
    if (!byId.has(p.id)) byId.set(p.id, []);
    byId.get(p.id).push(p);
  }
  const queryTokens = query.split(/[^a-z0-9]+/).filter((t) => t.length > 1);
  const results = [];
  for (const [id, checks] of byId) {
    const first = checks[0];
    const hay = `${first.name} ${id} ${first.contract || ""}`.toLowerCase();
    // Exact substring, or every query token present (so "Agentic Coin
    // AGC" still matches the board name "Agentic Coin (AGC)").
    const hit =
      hay.includes(query) ||
      (queryTokens.length > 1 && queryTokens.every((t) => hay.includes(t)));
    if (!hit) continue;
    checks.sort((a, b) => (a.checkedAt < b.checkedAt ? -1 : 1));
    const buckets = [...new Set(checks.map((c) => c.bucket))];
    results.push({
      id,
      name: first.name,
      contract: first.contract,
      firstSeen: checks[0].checkedAt,
      timesChecked: checks.length,
      currentBucket: checks[checks.length - 1].bucket,
      bucketHistory: buckets,
      checks: checks.map((c) => ({
        at: c.checkedAt,
        bucket: c.bucket,
        facts: c.facts,
        blobId: c.blobId,
        checkpoint: c.checkpoint,
      })),
    });
  }
  return { found: results.length > 0, results };
}
