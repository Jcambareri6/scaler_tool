// Prueba EN VIVO de los buscadores del documental (necesita red a Wikidata,
// Commons, Openverse y archive.org).   npx tsx scripts/tests/sources.live.ts
import { commercialLicense, searchArchiveVideos, searchCommonsImages, searchOpenverseImages, searchWikidataImage } from "../../src/lib/documentalSources.js";
import assert from "node:assert/strict";

assert.equal(commercialLicense("cc-by-sa-4.0"), "CC BY-SA 4.0");
assert.equal(commercialLicense("by-nc-sa"), null);
assert.equal(commercialLicense("cc-by-nd-2.0"), null);
assert.equal(commercialLicense("pd"), "Dominio público");
assert.equal(commercialLicense("cc0"), "CC0");
assert.equal(commercialLicense("by"), "CC BY");
console.log("licencias OK");

const show = (label: string, list: { provider: string; type: string; license: string; author?: string; title?: string; url: string }[]) =>
  console.log(`\n${label}: ${list.length}\n` + list.map((c) => `  ${c.provider} ${c.type} [${c.license}] ${c.title?.slice(0, 50) ?? ""} — ${c.author?.slice(0, 30) ?? "?"}\n    ${c.url.slice(0, 100)}`).join("\n"));

const run = async (label: string, fn: () => Promise<Parameters<typeof show>[1]>) => {
  try { show(label, await fn()); } catch (e) { console.log(`\n${label}: ERROR ${(e as Error).message}`); }
};
await run("Wikidata: Albert Einstein", () => searchWikidataImage("Albert Einstein"));
await run("Commons: Chernobyl reactor", () => searchCommonsImages("Chernobyl nuclear power plant"));
await run("Openverse: steam locomotive", () => searchOpenverseImages("steam locomotive"));
await run("archive.org: atomic bomb test 1950s", () => searchArchiveVideos("atomic bomb test", 1955));
