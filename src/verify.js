// Mint RedCeh — live on-chain fact checker.
// For every seed listing, read the facts from BSC ourselves (never trust the
// project's page): name/symbol/supply from the contract, Sourcify match,
// plus per-seed probes (e.g. AGC refund solvency). Output: data/board.json.
// Usage: node src/verify.js
import { createPublicClient, http, fallback, parseAbiItem, formatEther } from 'viem';
import { bsc } from 'viem/chains';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SEEDS } from './seeds.js';

const client = createPublicClient({
  chain: bsc,
  transport: fallback([
    http('https://rpc-bsc.48.club'),
    http('https://bsc-dataseed.binance.org'),
    http('https://bsc.drpc.org'),
  ]),
});

const READ_ABI = [
  parseAbiItem('function name() view returns (string)'),
  parseAbiItem('function symbol() view returns (string)'),
  parseAbiItem('function totalSupply() view returns (uint256)'),
];
const MAX_CANDIDATES = ['maxSupply', 'MAX_SUPPLY', 'maxTotalSupply', 'MAX_MINT'];

async function tryRead(address, abiItem, args = []) {
  try {
    return await client.readContract({ address, abi: [abiItem], functionName: abiItem.name, args });
  } catch {
    return null;
  }
}

async function sourcify(address) {
  try {
    const r = await fetch(`https://sourcify.dev/server/v2/contract/56/${address}`);
    if (!r.ok) return null;
    const j = await r.json();
    return j.match ?? null; // 'exact_match' | 'match' | null
  } catch {
    return null;
  }
}

function humanTokens(raw /* bigint, 18dp */) {
  const whole = raw / 10n ** 18n;
  return whole.toLocaleString('en-US');
}

async function checkSeed(seed) {
  const facts = { checkedAt: new Date().toISOString() };
  if (!seed.contract) {
    facts.pending = 'alamat kontrak belum dikonfirmasi dari sumber resmi';
    return { ...seed, facts };
  }
  const [name, symbol, supply, match] = await Promise.all([
    tryRead(seed.contract, READ_ABI[0]),
    tryRead(seed.contract, READ_ABI[1]),
    tryRead(seed.contract, READ_ABI[2]),
    sourcify(seed.contract),
  ]);
  facts.sourcify = match ?? 'tidak terverifikasi';
  facts.onchainName = name;
  facts.onchainSymbol = symbol;
  facts.supplyNow = supply === null ? null : supply.toString();
  if (supply === null) {
    facts.supplyNote = 'totalSupply() tidak menjawab — getter non-standar, diverifikasi manual';
  }
  for (const fn of MAX_CANDIDATES) {
    const v = await tryRead(seed.contract, parseAbiItem(`function ${fn}() view returns (uint256)`));
    if (v !== null) { facts.supplyMax = v.toString(); facts.supplyMaxFn = fn; break; }
  }
  if (seed.token) {
    const ts = await tryRead(seed.token, READ_ABI[2]);
    if (ts !== null) facts.tokenSupply = humanTokens(ts);
  }
  if (seed.probes) {
    facts.probes = {};
    for (const p of seed.probes) {
      if (p.format === 'balance') {
        const bal = await client.getBalance({ address: p.address });
        facts.probes[p.label] = `${formatEther(bal)} BNB`;
      } else {
        const v = await tryRead(p.address, parseAbiItem(`function ${p.fn}() view returns (uint256)`));
        facts.probes[p.label] = v === null ? 'tidak terbaca' : `${formatEther(v)} BNB`;
      }
    }
  }
  return { ...seed, facts };
}

export async function buildBoard({ write = true, log = true } = {}) {
  const board = [];
  for (const seed of SEEDS) {
    const entry = await checkSeed(seed);
    board.push(entry);
    if (log) {
      const f = entry.facts;
      console.log(
        `${entry.name.padEnd(16)} sourcify=${f.sourcify ?? '-'} supply=${f.supplyNow ?? f.supplyNote ?? f.pending ?? '?'}${f.supplyMax ? '/' + f.supplyMax : ''}${f.probes ? ' probes=' + JSON.stringify(f.probes) : ''}`
      );
    }
  }
  if (write) {
    try {
      await mkdir(new URL('../data', import.meta.url), { recursive: true });
      await writeFile(new URL('../data/board.json', import.meta.url), JSON.stringify(board, null, 2));
      if (log) console.log(`\nboard.json written: ${board.length} listings`);
    } catch {
      // Read-only filesystem (serverless): the computed board is still served.
      if (log) console.log(`\nboard computed in memory: ${board.length} listings (fs read-only, not persisted)`);
    }
  }
  return board;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildBoard();
}
