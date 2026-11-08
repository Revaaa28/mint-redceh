# Mint RedCeh — Free Mint Radar for Agentic ID

A free-mint radar for the **Binance Agentic ID (.ai)** ecosystem on BNB Chain.
Every project can claim "free" on its own page — Mint RedCeh checks that claim
against **on-chain facts** read directly from the contract, and sorts each
listing into one of three evidence-backed buckets: **Real**, **Potential**, and
**Fee-Farm Indication**.

## How it works

1. **Discovery** — candidate free mints trending in the Agent ID ecosystem
   (official project sites and announcements). No source is trusted raw.
2. **On-chain verification** (`src/verify.js`) — for every contract, the radar
   reads the facts itself from BNB Chain: name/symbol, minted vs max supply,
   Sourcify verification status, plus per-project probes (e.g. Agentic Coin's
   refund solvency: `refundOwed()` vs the contract's BNB balance). Output:
   `data/board.json`.
3. **The comparator** (`src/seeds.js`) — page claim vs chain facts, side by
   side, with evidence signals on every card (a hidden per-mint fee, a free
   quota the chain shows is already exhausted, demo-grade eligibility checks,
   and so on).
4. **Memory** (`src/radar-memory.js`) — every check round is written to
   **Walrus Memory** (mainnet, namespace `mintredceh`), stamped with the live
   Sui checkpoint fetched through **Tatum**'s GraphQL gateway. The **Ask the
   Radar** box answers only from that memory: when a contract was first seen,
   what every check found, whether its label ever changed — with Walrus blob
   ids as evidence. Not in memory = the radar says it does not know.

## Running it

```bash
npm install
node src/verify.js               # refresh data/board.json from the chain
node --env-file=.env server.js   # http://localhost:8787
```

Endpoints: `/` the board · `/api/board` · `/api/status` · `/api/memories` ·
`/api/ask?q=<name|address>` · `POST /api/refresh` (re-verify) ·
`POST /api/remember` (re-verify + write new memories). Without MemWal
credentials in `.env`, memory runs in a local dry mode.

## Principles

- Read-only: the radar never mints, never moves funds, never promises value.
- Fact numbers always come from the chain, never from the project's page.
- A bucket label is an assessment of the evidence shown — not a verdict, not a
  definitive reference, not financial advice. Always DYOR.

Built by elle for Rev.
