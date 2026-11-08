// Mint RedCeh — periodic auto-check runner.
// One run: re-verify every listing on-chain, compare facts against the last
// run, write a fresh Walrus Memory round when something changed (or at least
// once a day), refresh the public board via git push (Vercel auto-deploys),
// and print ONE JSON summary line for the scheduler:
//   { ok, changed:[ids], wrote:n, pushed:bool, alerts:[...] }
// Alerts (report-worthy): AGC refund obligations no longer fully backed by
// the mint contract's BNB balance; any listing's supply reaching its max.
import { readFile, writeFile, stat, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { buildBoard } from '../src/verify.js';
import { createStore } from '../src/memory.js';
import { writeBoardMemories } from '../src/radar-memory.js';

const DATA = new URL('../data/', import.meta.url);
const PREV = new URL('board.prev.json', DATA);
const LOG = new URL('autocheck-log.json', DATA);
const BOARD = new URL('board.json', DATA);

const factsOf = (board) => {
  const out = {};
  for (const e of board) {
    const f = e.facts || {};
    out[e.id] = {
      bucket: e.bucket ?? null,
      sourcify: f.sourcify ?? null,
      supplyNow: f.supplyNow ?? null,
      supplyMax: f.supplyMax ?? null,
      tokenSupply: f.tokenSupply ?? null,
      pending: f.pending ?? null,
      probes: f.probes ?? null,
    };
  }
  return out;
};

function git(args) {
  return execFileSync('git', ['-c', 'user.name=elle', '-c', 'user.email=elle@revelle.ai', ...args], {
    cwd: new URL('..', DATA).pathname,
    encoding: 'utf8',
  }).trim();
}

async function readJson(url, fallback) {
  try { return JSON.parse(await readFile(url, 'utf8')); } catch { return fallback; }
}

const summary = { ok: false, changed: [], wrote: 0, pushed: false, alerts: [] };
const LOCK = new URL('autocheck.lock', DATA);
try {
  const st = await stat(LOCK).catch(() => null);
  if (st && Date.now() - st.mtimeMs < 15 * 60 * 1000) {
    console.log(JSON.stringify({ ok: false, error: 'another autocheck run holds the lock' }));
    process.exit(0);
  }
} catch { /* lock check is best-effort */ }
await writeFile(LOCK, String(process.pid)).catch(() => {});
try {
  const prev = await readJson(PREV, null);
  const log = await readJson(LOG, { lastWriteAt: 0, errorStreak: 0 });

  const board = await buildBoard({ write: true, log: false });
  const now = factsOf(board);
  const changed = [];
  let meaningful = false;
  const band = (f) => {
    if (!f || f.supplyNow == null || f.supplyMax == null) return null;
    try {
      const max = BigInt(f.supplyMax);
      if (max === 0n) return null;
      return Number((BigInt(f.supplyNow) * 10n) / max);
    } catch { return null; }
  };
  const num = (v) => parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''));
  if (prev) {
    for (const id of Object.keys(now)) {
      if (JSON.stringify(now[id]) !== JSON.stringify(prev[id])) changed.push(id);
      // Meaningful = worth a memory: bucket moved, verification status
      // flipped, a supply crossed a 10% band of its max, or AGC moved >0.5%.
      if (now[id].bucket !== prev[id]?.bucket) meaningful = true;
      if (now[id].sourcify !== prev[id]?.sourcify) meaningful = true;
      const b0 = band(prev[id]); const b1 = band(now[id]);
      if (b0 !== null && b1 !== null && b0 !== b1) meaningful = true;
      if (id === 'agentic-coin' && now[id].probes && prev[id]?.probes) {
        for (const k of ['Refund obligations (refundOwed)', 'Mint contract BNB balance']) {
          const a = num(prev[id].probes[k]); const b = num(now[id].probes[k]);
          if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && Math.abs(b - a) / a > 0.005) meaningful = true;
        }
      }
    }
  }
  summary.changed = prev ? changed : Object.keys(now);

  // Alerts from live facts.
  for (const e of board) {
    const f = e.facts || {};
    if (f.supplyNow && f.supplyMax && BigInt(f.supplyNow) >= BigInt(f.supplyMax)) {
      summary.alerts.push(`${e.name}: supply reached its max (${f.supplyNow}/${f.supplyMax})`);
    }
    if (e.id === 'agentic-coin' && f.probes) {
      const owed = parseFloat(String(f.probes['Refund obligations (refundOwed)'] || '').replace(/[^0-9.]/g, ''));
      const bal = parseFloat(String(f.probes['Mint contract BNB balance'] || '').replace(/[^0-9.]/g, ''));
      if (Number.isFinite(owed) && Number.isFinite(bal) && bal < owed - 0.001) {
        summary.alerts.push(`Agentic Coin (AGC): refund obligations ${owed} BNB exceed the mint contract balance ${bal} BNB — refunds no longer fully backed`);
      }
    }
  }

  // Memory write: on a MEANINGFUL change (or any alert), or at least daily.
  // Small supply ticks refresh the board only — they never flood the memory.
  summary.meaningful = meaningful || summary.alerts.length > 0;
  const dueDaily = Date.now() - (log.lastWriteAt || 0) > 24 * 3600 * 1000;
  if ((prev && (summary.meaningful || dueDaily))) {
      const store = await createStore();
      const res = await writeBoardMemories(store, board);
      summary.wrote = res.written?.length ?? 0;
      log.lastWriteAt = Date.now();
  }

  // Persist bookkeeping BEFORE git, so a git hiccup can never lose the
  // memory-write timestamp or the facts baseline.
  await writeFile(PREV, JSON.stringify(now, null, 2));
  log.errorStreak = 0;
  log.lastRunAt = Date.now();
  await writeFile(LOG, JSON.stringify(log, null, 2));

  // Public board refresh: commit + push only when facts actually changed.
  // Tolerant of races: if the board file is already committed (e.g. swept
  // into a concurrent commit), that counts as refreshed.
  if (prev && changed.length > 0) {
    git(['add', 'data/board.json']);
    const dirty = git(['status', '--porcelain', '--', 'data/board.json']);
    if (dirty) {
      git(['commit', '-q', '-m', `autocheck ${new Date().toISOString()}: ${changed.join(', ')}`]);
      git(['push', '-q']);
    }
    summary.pushed = true;
  } else if (prev) {
    git(['checkout', '--', 'data/board.json']); // discard checkedAt-only churn
  }

  summary.ok = true;
} catch (err) {
  summary.error = String(err && err.message ? err.message : err).slice(0, 300);
  try {
    const log = await readJson(LOG, { lastWriteAt: 0, errorStreak: 0 });
    log.errorStreak = (log.errorStreak || 0) + 1;
    summary.errorStreak = log.errorStreak;
    await writeFile(LOG, JSON.stringify(log, null, 2));
  } catch { /* bookkeeping is best-effort */ }
}
await unlink(LOCK).catch(() => {});
console.log(JSON.stringify(summary));
