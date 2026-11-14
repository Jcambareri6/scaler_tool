// Carga la biblioteca de musica del formato documental (tabla music_library).
//   npx tsx scripts/seed-music.ts musica.json
//
// musica.json: lista de pistas CON LICENCIA DE USO COMERCIAL, por ejemplo las
// de Kevin MacLeod (incompetech.com, CC BY 4.0: se acreditan solas en la
// descripcion) o musica propia / comprada:
// [
//   { "mood": "documental", "title": "Nombre", "author": "Kevin MacLeod",
//     "license": "CC BY 4.0", "source_page": "https://incompetech.com/...",
//     "file": "./pistas/nombre.mp3" }          <- archivo local, o
//     "url": "https://.../nombre.mp3"           <- URL publica
// ]
// Animos: documental, tension, triste, epico, misterio, esperanza.
// Cada pista se sube a R2 (o Supabase Storage) en skaler-music/<animo>/.
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { supabase } from "../src/lib/supabase.js";
import { uploadPublicFile } from "../src/lib/storage.js";

interface Track {
  mood: string;
  title: string;
  author?: string;
  license: string;
  source_page?: string;
  file?: string;
  url?: string;
}

const MOODS = ["documental", "tension", "triste", "epico", "misterio", "esperanza"];
const listPath = process.argv[2];
if (!listPath) throw new Error("Uso: npx tsx scripts/seed-music.ts musica.json");
const tracks = JSON.parse(readFileSync(listPath, "utf-8")) as Track[];
const baseDir = path.dirname(path.resolve(listPath));

for (const track of tracks) {
  if (!MOODS.includes(track.mood)) throw new Error(`Animo invalido "${track.mood}" en "${track.title}"`);
  if (/\bNC\b|\bND\b/i.test(track.license)) throw new Error(`"${track.title}": licencia ${track.license} no permite uso comercial o modificaciones`);
  let body: Buffer;
  if (track.file) body = readFileSync(path.resolve(baseDir, track.file));
  else if (track.url) {
    const res = await fetch(track.url);
    if (!res.ok) throw new Error(`No se pudo bajar ${track.url} (${res.status})`);
    body = Buffer.from(await res.arrayBuffer());
  } else throw new Error(`"${track.title}" sin file ni url`);
  const slug = track.title.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const url = await uploadPublicFile({ bucket: "music", path: `${track.mood}/${slug}.mp3`, contentType: "audio/mpeg", body, r2Prefix: "skaler-music" });
  const { error } = await supabase.from("music_library").insert({
    mood: track.mood,
    title: track.title,
    author: track.author ?? null,
    license: track.license,
    source_page: track.source_page ?? null,
    url,
  });
  if (error) throw new Error(error.message);
  console.log(`✓ ${track.mood} · ${track.title} → ${url}`);
}
process.exit(0);
