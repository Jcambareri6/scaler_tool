// COMPROBAR HECHOS antes de la voz (como comprobarHechos.js de MaV): saca las
// afirmaciones verificables del guion (cifras, fechas, nombres, records), las
// contrasta con Wikipedia y corrige SOLO las que la fuente contradice. Un
// guion que pedimos denso en datos no puede salir con un dato inventado.
//
// Haiku: 1 llamada para sacar las afirmaciones + 1 cada 6 para juzgarlas.
// Si algo falla, el guion sigue igual (nunca frena la generacion).

import Anthropic from "@anthropic-ai/sdk";
import { fetchWithTimeout } from "./http.js";
import { WIKIMEDIA_UA } from "./documentalSources.js";

export const FACTCHECK_MODEL = "claude-haiku-5-5";
const MAX_CLAIMS = 25;
const CLAIMS_PER_CALL = 6;
const SOURCE_CHARS = 6000;
const NOT_A_CONTRADICTION = /\bno (menciona|se menciona|dice|habla|aparece|figura|especifica|indica)|sin menci[oó]n|no hay (datos|informaci[oó]n)/i;

interface Claim {
  frase: string; // copiada tal cual del guion
  afirmacion: string;
  buscar: string; // articulo de Wikipedia donde estaria
}

export interface FactChange {
  antes: string;
  despues: string;
  por: string;
  fuente: string;
}

function jsonOf<T>(text: string): T | null {
  const a = text.search(/[[{]/);
  const b = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (a < 0 || b < a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1)) as T;
  } catch {
    return null;
  }
}

async function ask(client: Anthropic, prompt: string, maxTokens: number): Promise<string> {
  const message = await client.messages.create({ model: FACTCHECK_MODEL, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] });
  return message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

// Texto del articulo de Wikipedia mas parecido a `query` (es, si no en).
async function wikipedia(query: string): Promise<{ title: string; url: string; text: string } | null> {
  for (const lang of ["es", "en"]) {
    try {
      const api = `https://${lang}.wikipedia.org/w/api.php`;
      const search = await fetchWithTimeout(`${api}?action=query&list=search&srlimit=1&format=json&srsearch=${encodeURIComponent(query)}`, { headers: { "User-Agent": WIKIMEDIA_UA } }, 15_000);
      const hit = ((await search.json()) as { query?: { search?: { title: string }[] } }).query?.search?.[0];
      if (!hit) continue;
      const page = await fetchWithTimeout(`${api}?action=query&prop=extracts&explaintext=1&format=json&redirects=1&titles=${encodeURIComponent(hit.title)}`, { headers: { "User-Agent": WIKIMEDIA_UA } }, 15_000);
      const pages = ((await page.json()) as { query?: { pages?: Record<string, { extract?: string }> } }).query?.pages ?? {};
      const text = Object.values(pages)[0]?.extract ?? "";
      if (text.length > 200) return { title: hit.title, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`, text: text.slice(0, SOURCE_CHARS) };
    } catch {
      // otra wiki
    }
  }
  return null;
}

export async function comprobarHechos(client: Anthropic, script: string): Promise<{ text: string; changes: FactChange[]; checked: number }> {
  const claimsRaw = await ask(
    client,
    `Guion:\n"""\n${script.slice(0, 30000)}\n"""\n\nSaca hasta ${MAX_CLAIMS} afirmaciones VERIFICABLES (cifras, fechas, nombres, cargos, records, distancias). Para cada una: "frase" copiada TAL CUAL del guion (la oracion o el pedazo que la contiene, exacto, para poder reemplazarlo), "afirmacion" en pocas palabras, y "buscar": el titulo del articulo de Wikipedia donde estaria (la persona, el lugar o el hecho). Responde SOLO JSON: [{"frase": "...", "afirmacion": "...", "buscar": "..."}]`,
    4000
  );
  const claims = (jsonOf<Claim[]>(claimsRaw) ?? []).filter((c) => c && typeof c.frase === "string" && script.includes(c.frase) && c.buscar).slice(0, MAX_CLAIMS);
  if (claims.length === 0) return { text: script, changes: [], checked: 0 };

  const sources = new Map<string, Awaited<ReturnType<typeof wikipedia>>>();
  for (const c of claims) if (!sources.has(c.buscar)) sources.set(c.buscar, await wikipedia(c.buscar));

  const changes: FactChange[] = [];
  let text = script;
  for (let i = 0; i < claims.length; i += CLAIMS_PER_CALL) {
    const batch = claims.slice(i, i + CLAIMS_PER_CALL).filter((c) => sources.get(c.buscar));
    if (batch.length === 0) continue;
    const blocks = batch
      .map((c, k) => {
        const src = sources.get(c.buscar)!;
        return `### Afirmacion ${k + 1}\nFrase del guion: "${c.frase}"\nAfirma: ${c.afirmacion}\nFuente (Wikipedia, "${src.title}"):\n${src.text}`;
      })
      .join("\n\n");
    const raw = await ask(
      client,
      `${blocks}\n\nPara cada afirmacion, segun SU fuente: "ok" (la fuente lo confirma o no lo contradice), "falso" (la fuente dice OTRA cosa concreta) o "sin_fuente" (la fuente no habla de eso). Solo en "falso", "corregida": la MISMA frase del guion con el dato corregido segun la fuente (mismo tono, cifras en letras si el guion las tiene en letras), y "por": el dato de la fuente. Un redondeo razonable ("unos 170", "mas de 900") NO es falso. Que la fuente NO MENCIONE algo no es "falso", es "sin_fuente": solo es falso si la fuente afirma OTRO dato concreto sobre lo mismo. En "por" copia la frase de la fuente que lo contradice. Responde SOLO JSON: [{"i": numero, "veredicto": "ok|falso|sin_fuente", "corregida": "...", "por": "..."}]`,
      3000
    ).catch(() => "");
    for (const v of jsonOf<{ i: number; veredicto: string; corregida?: string; por?: string }[]>(raw) ?? []) {
      const c = batch[Number(v.i) - 1];
      if (!c || v.veredicto !== "falso" || typeof v.corregida !== "string" || !v.corregida.trim() || v.corregida === c.frase) continue;
      // "La fuente no menciona X" no es una contradiccion (en la prueba cambio
      // "sede de gobierno de verano" por "cuartel militar"): no se toca.
      if (NOT_A_CONTRADICTION.test(String(v.por ?? ""))) continue;
      if (!text.includes(c.frase)) continue;
      text = text.replace(c.frase, v.corregida.trim());
      changes.push({ antes: c.frase, despues: v.corregida.trim(), por: String(v.por ?? "").slice(0, 300), fuente: sources.get(c.buscar)!.url });
    }
  }
  return { text, changes, checked: claims.length };
}
