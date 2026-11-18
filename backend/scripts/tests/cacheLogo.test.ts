// Cache del documental (contra la base, con una fila de prueba que se borra),
// recorte del logo de esquina y creditos.
//   npx tsx --require dotenv/config scripts/tests/cacheLogo.test.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { supabase } from "../../src/lib/supabase.js";
import { cachedSearch, cachedShot, forgetShot, shotCacheKey, storeSearch, storeShot } from "../../src/lib/documentalCache.js";
import { cornerCrop } from "../../src/lib/youtubeSource.js";
import { buildCreditsText } from "../../src/modules/projects/documental.service.js";

const fake = { provider: "commons", external_id: "test-1", type: "IMAGE" as const, url: "https://example.org/x.jpg", license: "CC BY 4.0", source_page: "https://example.org", query: "q" };
const q = `__test__ ${Date.now()}`;
await storeSearch(q, [fake]);
assert.equal((await cachedSearch(q))?.[0]?.external_id, "test-1", "busqueda cacheada");
await supabase.from("yt_search_cache").delete().eq("query", q);
const stamp = Date.now();
const k = shotCacheKey(["Tema", "México", "lugar", "rumorosa", "La cuesta es peligrosa", 4, stamp]);
assert.equal(k, shotCacheKey(["tema", "Mexico", "lugar", "rumorosa", "la cuesta  es peligrosa", 4, stamp]), "la clave ignora mayusculas, tildes y espacios");
await storeShot(k, fake, "muestra la cuesta", "commons");
assert.equal((await cachedShot(k))?.candidate.external_id, "test-1", "plano cacheado");
await forgetShot(k);
assert.equal(await cachedShot(k), null, "el QA lo borra");
await storeShot(k, { ...fake, url: "C:/tmp/local.mp4" }, "x", "youtube");
assert.equal(await cachedShot(k), null, "un archivo local no se cachea");
console.log("cache OK");

// Logo en la esquina superior derecha: tras el recorte, ese rincon no esta.
const ff = createRequire(import.meta.url)("ffmpeg-static") as string;
const dir = mkdtempSync(path.join(tmpdir(), "logo-"));
const src = path.join(dir, "src.png");
spawnSync(ff, ["-y", "-f", "lavfi", "-i", "color=c=blue:s=640x360", "-vf", "drawbox=x=560:y=10:w=70:h=40:color=red:t=fill", "-frames:v", "1", src]);
const out = path.join(dir, "out.png");
spawnSync(ff, ["-y", "-i", src, "-vf", cornerCrop("tr")!, out]);
const probe = spawnSync(ff, ["-i", out, "-vf", "crop=60:40:iw-60:0,signalstats", "-f", "null", "-"], { encoding: "utf-8" }).stderr;
const hasRed = spawnSync(ff, ["-i", out, "-vf", "crop=60:40:iw-60:0,format=rgb24,colorchannelmixer=1:0:0:0:0:0:0:0:0:0:0:0,signalstats,metadata=print:key=lavfi.signalstats.YMAX", "-f", "null", "-"], { encoding: "utf-8" }).stderr;
assert.ok(probe.length > 0);
assert.ok(!/YMAX=2[0-9]{2}/.test(hasRed), "el logo rojo de la esquina ya no esta");
assert.equal(cornerCrop(undefined), null);
console.log("recorte de logo OK:", cornerCrop("tr"));

const text = buildCreditsText(
  [
    { title: "Bajando La Rumorosa", author: "Canal X", license: "YouTube (sin licencia verificada)", source: null, provider: "youtube", external_id: "abc@t30", start_seconds: 30 },
    { title: "Bajando La Rumorosa", author: "Canal X", license: "YouTube (sin licencia verificada)", source: null, provider: "youtube", external_id: "abc@t90", start_seconds: 90 },
    { title: "La Rumorosa mirador", author: "Juan", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/x", provider: "commons", external_id: "1", start_seconds: null },
  ],
  [{ title: "Floating Cities", author: "Kevin MacLeod", license: "CC BY 4.0", source_page: "https://incompetech.com" }],
  true
);
assert.equal(text.split("youtu.be/abc").length - 1, 1, "un video, una linea");
assert.ok(text.includes("youtu.be/abc?t=30") && text.includes("OpenStreetMap") && text.includes("Kevin MacLeod") && text.includes("CC BY-SA 4.0"));
console.log("creditos OK");
process.exit(0);
