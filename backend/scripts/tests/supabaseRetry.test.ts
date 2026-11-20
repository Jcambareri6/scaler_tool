// Reintentos del cliente de Supabase ante cortes de red.   npx tsx scripts/tests/supabaseRetry.test.ts
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

process.env.SUPABASE_URL ??= "http://localhost";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test";
delete process.env.WORKER_ID; // modo API: 2 reintentos cortos
const { retryingFetch } = await import("../../src/lib/supabase.js");

let calls = 0;
let mode: "gateway" | "db" = "gateway";
const server = http.createServer((_req, res) => {
  calls++;
  if (mode === "db") {
    res.writeHead(400, { "content-type": "application/json" });
    return res.end('{"message":"invalid input syntax for type uuid"}');
  }
  if (calls < 3) {
    res.writeHead(400, { "content-type": "text/plain" });
    return res.end("Project not specified.");
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end("[]");
});
await new Promise<void>((resolve) => server.listen(0, resolve));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rest/v1/jobs`;

try {
  // Gateway caido dos veces: reintenta y devuelve el 200.
  const ok = await retryingFetch(url);
  assert.equal(ok.status, 200);
  assert.equal(calls, 3);

  // Error de la base (400 real): vuelve en el acto, sin reintentar.
  calls = 0;
  mode = "db";
  const bad = await retryingFetch(url);
  assert.equal(bad.status, 400);
  assert.equal(calls, 1);
  console.log("supabase reintentos: OK");
} finally {
  server.close();
}
