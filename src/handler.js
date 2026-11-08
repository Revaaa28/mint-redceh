// Mint RedCeh request handler — shared by the plain node:http server
// (server.js) and the Vercel serverless entry (api/index.js).
//
//   GET  /              single-page UI (public/index.html)
//   GET  /api/board     the verified board (data/board.json, written by
//                       src/verify.js; refreshed by POST /api/refresh)
//   GET  /api/status    listing counts + last check time
//   POST /api/refresh   re-run the on-chain verification now. If
//                       OBSERVE_TOKEN is set, the request must carry the
//                       same value in the x-observe-token header.
import { readFile } from "node:fs/promises";
import { buildBoard } from "./verify.js";
import { createStore } from "./memory.js";
import { askRadar, parseListingMemory, writeBoardMemories } from "./radar-memory.js";

const INDEX_HTML = new URL("../public/index.html", import.meta.url);
const FAVICON_SVG = new URL("../public/favicon.svg", import.meta.url);
const OG_PNG = new URL("../public/og.png", import.meta.url);
const BOARD_JSON = new URL("../data/board.json", import.meta.url);

let boardCache = null; // { at, data }
const BOARD_TTL_MS = 30_000;

// Walrus reads are slow; cache listAll briefly per warm instance
// (invalidated whenever this process writes a new memory).
let storePromise = null;
async function getStore() {
  if (!storePromise) {
    storePromise = (async () => {
      const store = await createStore();
      const rawListAll = store.listAll.bind(store);
      let cache = null;
      let inflight = null;
      store.listAll = () => {
        if (cache && Date.now() - cache.at < 60_000) return Promise.resolve(cache.data);
        if (!inflight) {
          inflight = rawListAll()
            .then((data) => { cache = { at: Date.now(), data }; return data; })
            .finally(() => { inflight = null; });
        }
        return inflight;
      };
      store.invalidateCache = () => { cache = null; };
      return store;
    })();
  }
  return storePromise;
}

async function getBoard() {
  if (boardCache && Date.now() - boardCache.at < BOARD_TTL_MS) return boardCache.data;
  let data;
  try {
    data = JSON.parse(await readFile(BOARD_JSON, "utf8"));
  } catch {
    data = await buildBoard(); // first run anywhere: verify live, then serve
  }
  boardCache = { at: Date.now(), data };
  return data;
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj, null, 2));
}

export async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/") {
      const html = await readFile(INDEX_HTML, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (req.method === "GET" && url.pathname === "/favicon.svg") {
      const svg = await readFile(FAVICON_SVG);
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" });
      res.end(svg);
      return;
    }
    if (req.method === "GET" && url.pathname === "/og.png") {
      const png = await readFile(OG_PNG);
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
      res.end(png);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/board") {
      sendJson(res, 200, { listings: await getBoard() });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/status") {
      const board = await getBoard();
      const counts = { real: 0, berpotensi: 0, indikasi: 0 };
      let lastChecked = null;
      for (const e of board) {
        if (counts[e.bucket] !== undefined) counts[e.bucket]++;
        const t = e.facts?.checkedAt;
        if (t && (!lastChecked || t > lastChecked)) lastChecked = t;
      }
      sendJson(res, 200, { app: "Mint RedCeh", listings: board.length, counts, lastChecked });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/refresh") {
      const token = process.env.OBSERVE_TOKEN;
      if (token && req.headers["x-observe-token"] !== token) {
        sendJson(res, 403, { error: "OBSERVE_TOKEN set: missing or wrong x-observe-token header" });
        return;
      }
      const board = await buildBoard();
      boardCache = { at: Date.now(), data: board };
      sendJson(res, 200, { ok: true, listings: board.length });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/memories") {
      const store = await getStore();
      const all = await store.listAll();
      const memories = all
        .map((e) => parseListingMemory(e.text, e.blobId, e.createdAt))
        .filter(Boolean)
        .reverse(); // newest first
      sendJson(res, 200, { mode: store.mode, namespace: store.namespace, count: memories.length, memories });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/ask") {
      const q = url.searchParams.get("q");
      if (!q) {
        sendJson(res, 400, { error: "missing ?q= parameter" });
        return;
      }
      const store = await getStore();
      sendJson(res, 200, await askRadar(store, q));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/remember") {
      const token = process.env.OBSERVE_TOKEN;
      if (token && req.headers["x-observe-token"] !== token) {
        sendJson(res, 403, { error: "OBSERVE_TOKEN set: missing or wrong x-observe-token header" });
        return;
      }
      const store = await getStore();
      const board = await buildBoard();
      boardCache = { at: Date.now(), data: board };
      const { checkpoint, written } = await writeBoardMemories(store, board);
      if (store.invalidateCache) store.invalidateCache();
      sendJson(res, 200, { ok: true, checkpoint, written });
      return;
    }
    sendJson(res, 404, { error: "not found" });
  } catch (e) {
    sendJson(res, 500, { error: String(e?.message || e) });
  }
}
