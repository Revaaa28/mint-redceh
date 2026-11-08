// Tatum Sui GraphQL gateway — current mainnet checkpoint.
//
// The gateway answers basic reads with NO API key (verified in the spike,
// SPIKE.md Q2). If TATUM_API_KEY is set it is sent as the x-api-key header,
// which is the documented flow. Results are cached for 30s so one watcher
// round costs at most one request. Any failure returns null — the watcher
// stamps "unknown" and carries on; it must never crash on Tatum being down.
const GATEWAY = "https://sui-mainnet.gateway.tatum.io/graphql";
const CACHE_MS = 30_000;

let cache = { value: null, fetchedAt: 0 };

export async function getSuiCheckpoint() {
  const now = Date.now();
  if (cache.value != null && now - cache.fetchedAt < CACHE_MS) {
    return cache.value;
  }
  try {
    const headers = { "Content-Type": "application/json" };
    if (process.env.TATUM_API_KEY) headers["x-api-key"] = process.env.TATUM_API_KEY;
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: "{ checkpoint { sequenceNumber } }" }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const seq = data?.data?.checkpoint?.sequenceNumber;
    if (typeof seq !== "number") return null;
    cache = { value: seq, fetchedAt: now };
    return seq;
  } catch {
    return null;
  }
}
