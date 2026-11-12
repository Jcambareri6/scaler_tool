import { fetchWithTimeout } from "./http.js";
import { envInt } from "./env.js";
import { withRetry } from "./retry.js";
import type { ShotClass } from "./documentalStyles.js";

// SPOKES de busqueda del formato documental: cada clase de plano tiene una
// cadena de fuentes CON LICENCIA para uso comercial (ver filtro legal en
// PLAN-stock-con-graficos-estilo-mav.md). Nada de YouTube ni de material
// "no comercial" (NC) o "sin derivados" (ND): el video se monetiza y se
// recorta/anima.
//
// Este modulo solo BUSCA candidatos; el juez visual elige (director/visualJudge.ts)
// y el orquestador persiste el asset con su licencia para los creditos.

export interface VisualCandidate {
  provider: string;
  external_id: string;
  type: "VIDEO" | "IMAGE";
  // Archivo que se usa en el video (se copia a R2 antes del render).
  url: string;
  // Imagen chica para el juez (si no hay, el juez saca cuadros del video).
  thumb_url?: string;
  duration_seconds?: number;
  width?: number;
  height?: number;
  title?: string;
  author?: string;
  license: string;
  license_url?: string;
  // Pagina de la obra (creditos).
  source_page: string;
  // Que busqueda lo trajo (auditoria).
  query: string;
}

export const WIKIMEDIA_UA = "ScalerTool/1.0 (https://github.com/jcambareri6/scaler_tool)";
const RESULTS = envInt("DOCUMENTAL_RESULTS_PER_SOURCE", 4);
const MIN_IMAGE_WIDTH = 900;
// Mas ancho que esto es una panoramica: en 16:9 queda una franja.
const MAX_ASPECT = 2.4;
// archive.org: archivos de mas de esto no se usan (descarga y copia lentas).
const ARCHIVE_MAX_BYTES = 250 * 1024 * 1024;

// ---------- Limitador para Wikimedia (APIs con rate limit estricto) ----------

const WIKIMEDIA_MIN_INTERVAL_MS = envInt("WIKIMEDIA_MIN_INTERVAL_MS", 350, 0);
let wikimediaQueue: Promise<unknown> = Promise.resolve();
let lastWikimediaCall = 0;

async function wikimediaJson<T>(url: string): Promise<T> {
  const run = async (): Promise<T> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = lastWikimediaCall + WIKIMEDIA_MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastWikimediaCall = Date.now();
      const res = await fetchWithTimeout(url, { headers: { "User-Agent": WIKIMEDIA_UA, "Api-User-Agent": WIKIMEDIA_UA } }, 20_000);
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after")) || 2 ** attempt;
        await sleep(Math.min(20, retryAfter) * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`Wikimedia (${res.status}): ${(await res.text()).slice(0, 200)}`);
      return (await res.json()) as T;
    }
    throw new Error("Wikimedia (429): limite de pedidos");
  };
  const next = wikimediaQueue.then(run, run);
  wikimediaQueue = next.catch(() => undefined);
  return next;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  return withRetry(async () => {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": WIKIMEDIA_UA, ...headers } }, 20_000);
    if (!res.ok) throw new Error(`${new URL(url).host} (${res.status}): ${(await res.text()).slice(0, 120)}`);
    return (await res.json()) as T;
  }, { retries: 2, baseDelayMs: 1500 });
}

function stripHtml(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 200) : undefined;
}

// ---------- Licencias ----------

// Codigos de licencia legibles por maquina que se aceptan (uso comercial y
// con modificaciones). Commons: extmetadata.License ("pd", "cc0",
// "cc-by-4.0", "cc-by-sa-3.0"...). Openverse: "by", "by-sa", "cc0", "pdm".
export function commercialLicense(code: string | undefined): string | null {
  const c = (code ?? "").trim().toLowerCase();
  if (!c) return null;
  if (/\bnc\b|-nc-|-nc$|nd\b|-nd-|-nd$/.test(c)) return null;
  if (c === "pd" || c.startsWith("pd-") || c === "pdm" || c === "public domain") return "Dominio público";
  if (c === "cc0" || c.startsWith("cc0")) return "CC0";
  const m = c.match(/^(?:cc-)?(by-sa|by)(?:[- ]?(\d(?:\.\d)?))?/);
  if (m) return `CC ${m[1]!.toUpperCase()}${m[2] ? ` ${m[2]}` : ""}`;
  return null;
}

// ---------- Wikimedia Commons (fotos) ----------

interface CommonsPage {
  pageid: number;
  title: string;
  imageinfo?: {
    url: string;
    thumburl?: string;
    descriptionurl: string;
    width: number;
    height: number;
    mime: string;
    extmetadata?: Record<string, { value?: string }>;
  }[];
}

function commonsCandidate(page: CommonsPage, query: string): VisualCandidate | null {
  const info = page.imageinfo?.[0];
  if (!info || !/^image\/(jpeg|png|webp)/.test(info.mime)) return null;
  if (info.width < MIN_IMAGE_WIDTH || info.width / info.height > MAX_ASPECT) return null;
  const meta = info.extmetadata ?? {};
  const license = commercialLicense(meta.License?.value ?? meta.LicenseShortName?.value);
  if (!license) return null;
  return {
    provider: "commons",
    external_id: String(page.pageid),
    type: "IMAGE",
    // Miniatura de 1920 de ancho: alcanza para 1080p y pesa mucho menos que el original.
    url: info.thumburl ?? info.url,
    thumb_url: info.thumburl ? info.thumburl.replace(/\/\d+px-/, "/480px-") : info.url,
    width: info.width,
    height: info.height,
    title: page.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, ""),
    ...(stripHtml(meta.Artist?.value) ? { author: stripHtml(meta.Artist?.value)! } : {}),
    license,
    ...(meta.LicenseUrl?.value ? { license_url: meta.LicenseUrl.value } : {}),
    source_page: info.descriptionurl,
    query,
  };
}

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const IMAGEINFO = "url|size|mime|extmetadata";
const EXTMETA = "License|LicenseShortName|LicenseUrl|Artist|AttributionRequired";

export async function searchCommonsImages(query: string): Promise<VisualCandidate[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: "20",
    prop: "imageinfo",
    iiprop: IMAGEINFO,
    iiurlwidth: "1920",
    iiextmetadatafilter: EXTMETA,
  });
  const data = await wikimediaJson<{ query?: { pages?: (CommonsPage & { index?: number })[] } }>(`${COMMONS_API}?${params}`);
  return (data.query?.pages ?? [])
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .flatMap((p) => commonsCandidate(p, query) ?? [])
    .slice(0, RESULTS);
}

async function commonsFile(fileName: string, query: string): Promise<VisualCandidate | null> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    titles: `File:${fileName}`,
    prop: "imageinfo",
    iiprop: IMAGEINFO,
    iiurlwidth: "1920",
    iiextmetadatafilter: EXTMETA,
  });
  const data = await wikimediaJson<{ query?: { pages?: CommonsPage[] } }>(`${COMMONS_API}?${params}`);
  const page = data.query?.pages?.[0];
  return page ? commonsCandidate(page, query) : null;
}

// ---------- Wikidata (foto de una persona, cosa o lugar con nombre propio) ----------

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";

export async function searchWikidataImage(entity: string, language = "es"): Promise<VisualCandidate[]> {
  const search = await wikimediaJson<{ search?: { id: string }[] }>(
    `${WIKIDATA_API}?${new URLSearchParams({ action: "wbsearchentities", search: entity, language, uselang: language, format: "json", limit: "3", type: "item" })}`
  );
  const results: VisualCandidate[] = [];
  for (const hit of search.search ?? []) {
    // P18 = imagen principal de la entidad.
    const claims = await wikimediaJson<{ claims?: { P18?: { mainsnak?: { datavalue?: { value?: string } } }[] } }>(
      `${WIKIDATA_API}?${new URLSearchParams({ action: "wbgetclaims", entity: hit.id, property: "P18", format: "json" })}`
    );
    const file = claims.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (!file) continue;
    const candidate = await commonsFile(file, entity);
    if (candidate) results.push({ ...candidate, provider: "wikidata", external_id: hit.id });
    if (results.length >= 2) break;
  }
  return results;
}

// ---------- Openverse (fotos CC de Flickr y otros) ----------

interface OpenverseResult {
  id: string;
  title?: string;
  url: string;
  thumbnail?: string;
  creator?: string;
  license: string;
  license_version?: string;
  license_url?: string;
  foreign_landing_url: string;
  width?: number;
  height?: number;
}

export async function searchOpenverseImages(query: string): Promise<VisualCandidate[]> {
  const params = new URLSearchParams({ q: query, page_size: "20", license_type: "commercial,modification", mature: "false" });
  const data = await getJson<{ results?: OpenverseResult[] }>(`https://api.openverse.org/v1/images/?${params}`);
  return (data.results ?? [])
    .flatMap((r): VisualCandidate[] => {
      const license = commercialLicense(r.license);
      if (!license) return [];
      if ((r.width ?? 0) < MIN_IMAGE_WIDTH || (r.width && r.height && r.width / r.height > MAX_ASPECT)) return [];
      return [
        {
          provider: "openverse",
          external_id: r.id,
          type: "IMAGE",
          url: r.url,
          ...(r.thumbnail ? { thumb_url: r.thumbnail } : {}),
          ...(r.width ? { width: r.width } : {}),
          ...(r.height ? { height: r.height } : {}),
          ...(r.title ? { title: r.title } : {}),
          ...(r.creator ? { author: r.creator } : {}),
          license: r.license_version && !/^(CC0|Dominio)/.test(license) ? `${license} ${r.license_version}` : license,
          ...(r.license_url ? { license_url: r.license_url } : {}),
          source_page: r.foreign_landing_url,
          query,
        },
      ];
    })
    .slice(0, RESULTS);
}

// ---------- Internet Archive (video de archivo de dominio publico) ----------

interface ArchiveFile {
  name: string;
  format?: string;
  size?: string;
  length?: string;
  width?: string;
}

export async function searchArchiveVideos(query: string, year?: number): Promise<VisualCandidate[]> {
  // Solo dominio publico: la coleccion Prelinger (todo PD) o licencia PD/CC0 declarada.
  const yearFilter = year ? ` AND year:[${year - 8} TO ${year + 8}]` : "";
  const q = `(${query}) AND mediatype:movies AND (collection:prelinger OR licenseurl:*publicdomain*)${yearFilter}`;
  const params = new URLSearchParams({ q, rows: "8", output: "json" });
  params.append("fl[]", "identifier");
  params.append("fl[]", "title");
  params.append("fl[]", "licenseurl");
  params.append("fl[]", "year");
  const search = await getJson<{ response?: { docs?: { identifier: string; title?: string; licenseurl?: string; year?: string }[] } }>(
    `https://archive.org/advancedsearch.php?${params}`
  );
  const results: VisualCandidate[] = [];
  for (const doc of search.response?.docs ?? []) {
    const meta = await getJson<{ files?: ArchiveFile[]; metadata?: { creator?: string } }>(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`);
    const mp4 = (meta.files ?? [])
      .filter((f) => /\.mp4$/i.test(f.name) && Number(f.size ?? 0) > 0 && Number(f.size) < ARCHIVE_MAX_BYTES)
      .sort((a, b) => Number(b.width ?? 0) - Number(a.width ?? 0))[0];
    if (!mp4) continue;
    const thumb = (meta.files ?? []).find((f) => /__ia_thumb\.jpg$/i.test(f.name) || /\.thumbs\/.+\.jpg$/i.test(f.name));
    results.push({
      provider: "archive_org",
      external_id: doc.identifier,
      type: "VIDEO",
      url: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(mp4.name)}`,
      ...(thumb ? { thumb_url: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${thumb.name.split("/").map(encodeURIComponent).join("/")}` } : {}),
      ...(Number(mp4.length) > 0 ? { duration_seconds: Number(mp4.length) } : {}),
      ...(doc.title ? { title: doc.title } : {}),
      ...(meta.metadata?.creator ? { author: String(meta.metadata.creator).slice(0, 120) } : {}),
      license: "Dominio público",
      ...(doc.licenseurl ? { license_url: doc.licenseurl } : {}),
      source_page: `https://archive.org/details/${doc.identifier}`,
      query,
    });
    if (results.length >= RESULTS) break;
  }
  return results;
}

// ---------- Cadena de fuentes por clase ----------

export type SourceName = "wikidata" | "commons" | "openverse" | "archive" | "stock" | "ai_image";

export interface ShotSearch {
  clase: ShotClass;
  query: string;
  entidad?: string;
  anio?: number;
}

// Orden de fuentes para cada clase. "stock" = search_stock (Pexels, Pixabay,
// Coverr, Wikimedia video); "ai_image" = imagen IA (SnapGen) como ultimo
// recurso cuando no hay material.
export function sourceChain(search: ShotSearch, archiveFirst: boolean): SourceName[] {
  const historic = search.anio !== undefined && search.anio < 1990;
  switch (search.clase) {
    case "persona":
      return ["wikidata", "commons", "openverse", "stock"];
    case "lugar":
      return historic ? ["commons", "archive", "openverse", "stock"] : ["commons", "openverse", "stock"];
    case "cosa":
      return search.entidad ? ["wikidata", "commons", "openverse", "stock"] : ["commons", "openverse", "stock"];
    case "metraje":
      return archiveFirst || historic ? ["archive", "stock", "commons"] : ["stock", "archive", "commons"];
    case "mapa":
    case "grafico":
    case "ambiente":
    default:
      return historic && archiveFirst ? ["archive", "stock", "openverse"] : ["stock", "openverse"];
  }
}
