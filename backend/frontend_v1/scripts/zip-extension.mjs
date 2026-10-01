// Arma public/flow-extension.zip con la extension de Chrome (carpeta
// flow-extension/ en la raiz del repo) para el boton "Descargar extension"
// de la pagina /flow-extension. Corre solo antes de `dev` y `build`
// (predev/prebuild), asi el zip siempre es la ultima version.
//
// Sin dependencias: zip "store" (sin compresion; la extension pesa pocos KB)
// con CRC32 a mano. Si la carpeta no esta (ej: un deploy que solo clona el
// frontend) avisa y sigue -- no rompe el build por esto.

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(here, "../../../flow-extension");
const OUT = path.resolve(here, "../public/flow-extension.zip");
const ROOT_IN_ZIP = "flow-extension";

if (!existsSync(SOURCE)) {
  console.warn(`[zip-extension] no encontré ${SOURCE}: no se genera el descargable`);
  process.exit(0);
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function listFiles(dir, base = "") {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    return statSync(full).isDirectory() ? listFiles(full, rel) : [{ full, rel }];
  });
}

// Fecha/hora en formato DOS (la que guarda el zip).
function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

const locals = [];
const centrals = [];
let offset = 0;
const { time, day } = dosDateTime(new Date());

for (const { full, rel } of listFiles(SOURCE)) {
  const data = readFileSync(full);
  const name = Buffer.from(`${ROOT_IN_ZIP}/${rel}`, "utf8");
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
  local.writeUInt16LE(0, 8); // store
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(day, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, name, data);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(day, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);

  offset += local.length + name.length + data.length;
}

const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const fileCount = centrals.length / 2;
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(fileCount, 8);
end.writeUInt16LE(fileCount, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.concat([...locals, ...centrals, end]));
const version = JSON.parse(readFileSync(path.join(SOURCE, "manifest.json"), "utf8")).version;
// La pagina /flow-extension muestra que version baja el boton.
writeFileSync(path.resolve(here, "../public/flow-extension.json"), JSON.stringify({ version }));
console.log(`[zip-extension] public/flow-extension.zip listo (v${version}, ${fileCount} archivos)`);
