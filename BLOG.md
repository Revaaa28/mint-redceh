# Mint RedCeh: a free-mint radar that checks the claim against the chain — and remembers every check

*Built by ELLE for the Total Recall hackathon (Tatum × Walrus).*
*Live: https://mint-redceh.vercel.app · Code: https://github.com/Revaaa28/mint-redceh*

## The problem: "free" is the most abused word in the Agentic ID ecosystem

Since Binance opened free Agent ID (.ai) claims, the BNB Chain has filled up with projects offering "free mints" to Agent ID holders. Some are genuinely free. Many are not: a mint advertised as free quietly skims a creator fee on every mint, locks a "refundable" deposit inside a contract, or keeps advertising a free quota that ran out long ago. The project's page will never tell you this. The contract will — if somebody reads it.

Mint RedCeh is that somebody. It is a read-only radar for free mints in the Binance Agentic ID ecosystem on BNB Chain. For every listing it shows two columns side by side:

- **Page claim** — what the project's own site says, quoted as a claim, never as a fact.
- **On-chain facts** — name, symbol, supply, verification status and money flows, read directly from the contract.

Each listing gets one of three labels, always with its evidence attached: **Clear** (the free lane is proven by the contract itself), **Potential** (a real project with a gap in the evidence), or **Fee-Farm Indication** (the chain contradicts the "free" claim).

## How the radar verifies

Every listing passes through the same gate:

1. **Read the claim.** The project's official page must publish its mint terms. No published terms, nothing to verify — the project does not board.
2. **Read the chain.** Name, symbol and supply come from the contract itself via public BSC RPC; verification status comes from Sourcify. Site counters are never trusted.
3. **Follow the money.** Mint price, per-mint creator fees, deposits dressed up as free mints, and — for refund-style systems — the contract's refund obligations versus its actual BNB balance, probed live at every check.
4. **Remember everything.** Every check is written to Walrus Memory (below). Labels are re-judged at every capture, and a label change leaves a trail instead of overwriting history.

## How it uses Walrus Memory

Mint RedCeh's memory is not a log file — it is the product's second surface. Every verification of every listing is written as a memory to **Walrus Memory on mainnet** (namespace `mintredceh`): the listing, its contract, its label, the chain facts as read at that moment, and the evidence signals. Thirty-one memories were written on day one alone, and the count grows with every cycle.

That memory is queryable in two places on the site:

- **Ask the Radar** — a question box that answers *only* from memory: when a contract was first seen, what each check found, whether its label ever changed. If it is not in memory, the radar says it does not know. Every answer links to the underlying Walrus blob and its Sui checkpoint.
- **Check history on every card** — the full recorded timeline for that listing, blob by blob.

Because history is append-only memory rather than a database row that gets overwritten, "what did the radar believe last Tuesday, and why?" is always answerable — that is the difference between a listing site and a radar with a past.

## How it uses Tatum

Each memory is stamped with the current **Sui checkpoint**, read at write time through **Tatum's Sui GraphQL gateway**. The checkpoint anchors every check in Sui's timeline: a memory does not just say *what* the radar found, it proves *when* in chain-time the finding was recorded, and the stamp travels inside the memory text itself. (BNB Chain contract reads go through public BSC RPC endpoints; the Sui-side data — the checkpoint that timestamps the radar's memory — comes from Tatum.)

## How it learned over time

The radar launched on 8 November 2026 with eight hand-researched listings. Within its first day, its own checks had already changed what it could say:

- **Floppy Agents** boards as *Potential*, not Clear: its launchpad page still advertises a free mint, but the chain reads `minted: 3333/3333` — the free window is closed. The radar shows both facts, side by side.
- **CodexNFT** claims "all 6,666 mints FREE", while its contract takes a 0.000075 BNB creator fee on every mint. Label: *Fee-Farm Indication*, with the arithmetic on the card.
- **Agentic Coin (AGC)** calls a refundable 0.002 BNB-per-share deposit a "free mint". The radar does not argue — it probes: refund obligations versus the mint contract's BNB balance at every capture (equal at every check so far, ~105.7 BNB). The day they diverge, the radar raises an alert.
- **The board grows itself.** A discovery lane sweeps the ecosystem's lead sources, runs new projects through the same gate, and boards the ones that pass — Paw Gang boarded this way on day one. A candidate whose official presence cannot be verified (a project called Pandora) is held off the board until it can be.
- **Listings move.** Every two hours the radar re-captures every listing and re-judges it: labels move between buckets as evidence changes, and a listing whose contract dies or whose project ends is removed. Each of those decisions is itself written to Walrus Memory, so the radar's judgement history is as inspectable as its data.

That is what "learning" means here: not a model quietly drifting, but a public, append-only record of observations and decisions that anyone can replay.

## What it is not

Mint RedCeh never mints for you, never moves funds, and never promises value. Its labels are one radar's reading of public evidence — not a definitive reference, not financial advice. The radar re-captures every listing every two hours, and a label can change from one capture to the next. Always do your own research.

---

*Mint RedCeh — Mint in gold, Red in red, Ceh in white. Built by ELLE.*
