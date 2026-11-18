// Freno, clasificacion de errores y limpieza de credenciales de YouTube (sin red).
//   npx tsx scripts/tests/youtubeGuard.test.ts
import assert from "node:assert/strict";
process.env.YT_FRENO_FALLOS = "3";
process.env.YT_FRENO_PAUSA_MS = "300";
const { clasificar, frenoYoutube, limpiar, Semaforo } = await import("../../src/lib/youtubeGuard.js");
const { BLOCKED_CHANNEL } = await import("../../src/lib/youtubeSource.js");

// Nunca la clave del proxy en logs ni en la base (credenciales inventadas).
const msg = limpiar("yt-dlp 1: ERROR: Unable to connect to proxy http://customer-FAKEUSER-cc-US-sessid-abc:FAKEPASS123@proxy.example.com:7777");
assert.ok(!msg.includes("FAKEPASS123") && !msg.includes("FAKEUSER"), msg);
console.log("limpiar OK:", msg);

assert.equal(clasificar(new Error("Sign in to confirm you're not a bot")), "bloqueo");
assert.equal(clasificar(new Error("HTTP Error 429: Too Many Requests")), "bloqueo");
assert.equal(clasificar(new Error("yt-dlp tardo mas de 90 s")), "red");
assert.equal(clasificar(new Error("Video unavailable. This video is private")), "roto");
console.log("clasificar OK");

// 3 bloqueos seguidos abren el freno; despues falla al instante; tras la pausa, 1 intento de prueba.
const bloqueo = () => Promise.reject(new Error("Sign in to confirm you're not a bot"));
for (let i = 0; i < 3; i++) await assert.rejects(frenoYoutube.correr(bloqueo));
assert.ok(frenoYoutube.abierto(), "abre tras 3 bloqueos");
let llamado = false;
await assert.rejects(frenoYoutube.correr(async () => ((llamado = true), 1)), /freno/);
assert.equal(llamado, false, "con el freno abierto no se llama a YouTube");
await new Promise((r) => setTimeout(r, 350));
assert.equal(await frenoYoutube.correr(async () => 7), 7, "intento de prueba pasa y cierra");
assert.ok(!frenoYoutube.abierto());
// Un video roto no cuenta para el freno.
for (let i = 0; i < 5; i++) await assert.rejects(frenoYoutube.correr(() => Promise.reject(new Error("Video unavailable"))));
assert.ok(!frenoYoutube.abierto(), "videos rotos no abren el freno");
console.log("freno OK");

// Semaforo: nunca mas de N a la vez.
const s = new Semaforo(2);
let at = 0;
let max = 0;
await Promise.all(Array.from({ length: 6 }, () => s.con(async () => { at += 1; max = Math.max(max, at); await new Promise((r) => setTimeout(r, 20)); at -= 1; })));
assert.equal(max, 2);
console.log("semaforo OK");

assert.ok(BLOCKED_CHANNEL.test("Some Podcast") && BLOCKED_CHANNEL.test("Juan Vlogs"));
assert.ok(!BLOCKED_CHANNEL.test("Lincoln Corda") && !BLOCKED_CHANNEL.test("ZOOM in"));
console.log("canales OK");

// Puntaje: primero el que nombra el lugar y es toma limpia; las listas abajo.
{
  const { rankYouTube } = await import("../../src/lib/youtubeSource.js");
  const r = rankYouTube(
    [
      { title: "TOP 10 caminos más peligrosos del mundo", duration: 600 },
      { title: "Hiking vlog Spain trip", duration: 900 },
      { title: "Caminito del Rey desde el aire 4K drone", duration: 420 },
      { title: "Caminito del Rey recorrido completo", duration: 2400 },
    ],
    "Caminito del Rey walkway drone"
  );
  assert.equal(r[0]!.title, "Caminito del Rey desde el aire 4K drone");
  assert.equal(r[r.length - 1]!.title, "TOP 10 caminos más peligrosos del mundo");
  console.log("puntaje OK");
}
