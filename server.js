// Mint RedCeh local/plain server — zero-dependency node:http.
// The request logic lives in src/handler.js (shared with api/index.js
// for the Vercel deployment).
import http from "node:http";
import { handle } from "./src/handler.js";

const PORT = Number(process.env.PORT || 8787);
const server = http.createServer(handle);
server.listen(PORT, () => {
  console.log(`Mint RedCeh listening on http://localhost:${PORT}`);
});
