import { fetchWithTimeout } from "./http.js";
import { envInt } from "./env.js";
import { withRetry } from "./retry.js";
import type { ShotClass } from "./documentalStyles.js";
import { BLOCKED_TITLE } from "./youtubeSource.js";

// Colecciones de archive.org con dominio publico curado (noticieros
// Universal y la coleccion Prelinger). Configurable con ARCHIVE_COLLECTIONS.
const ARCHIVE_COLLECTIONS = (process.env.ARCHIVE_COLLECTIONS ?? "universal_newsreels,prelinger").split(",").map((c) => c.trim()).filter(Boolean);

// Fotos que no son un retrato de la persona (como NO_ES_FOTO de MaV).
export const NOT_A_PORTRAIT = /\b(signature|firma|logo|coat of arms|escudo|map|mapa|grave|tomb|tumba|plaque|placa|memorial|stamp|sello|statue|estatua|monument|monumento|family|familia|group|grupo)\b/i;

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
  // YouTube: duracion del video original (el rescate baja otros momentos).
  video_seconds?: number;
  // YouTube: segundos de cada cuadro de la hoja que vio el juez (16 cuadros
  // reales del video, como el escaneo de MaV). El juez elige el cuadro y el
  // tramo se baja desde ahi.
  sheet_times?: number[];
  // YouTube: segundo del video original donde arranca el tramo (credito con &t=).
  yt_start?: number;
  // YouTube de la biblioteca del video: la hoja de 16 cuadros ya armada.
  sheet_path?: string;
  // YouTube: esquina con un logo chico de canal; el tramo se recorta sin ella.
  logo_corner?: "tl" | "tr" | "bl" | "br";
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
// La foto PRINCIPAL de una entidad en Wikidata (P18), casi siempre el retrato
// de la persona: sin el minimo de 900 px (MaV no pone minimo). Los retratos
// de Esteban Cantu (609 px) y Abelardo L. Rodriguez (196 px) se descartaban y
// el plano de la persona terminaba en niebla o en otra cosa. El render la
// muestra entera sobre su copia desenfocada.
const MIN_ENTITY_IMAGE_WIDTH = 150;
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

const BAD_COMMONS_TITLE = /\b(map|mapa|logo|icon|coat of arms|escudo|flag|bandera|diagram|diagrama|chart|graph|poster|cartel|screenshot|signature|firma|seal|stamp|svg)\b/i;

function commonsCandidate(
  page: CommonsPage,
  query: string,
  minWidth = MIN_IMAGE_WIDTH,
  opts: { badTitle?: RegExp; svgMinWidth?: number } = {}
): VisualCandidate | null {
  const info = page.imageinfo?.[0];
  if (!info) return null;
  // SVG (diagramas de Wikipedia): solo los grandes; Commons sirve la miniatura en PNG.
  const svg = info.mime === "image/svg+xml";
  if (svg ? opts.svgMinWidth === undefined || info.width < opts.svgMinWidth || !info.thumburl : !/^image\/(jpeg|png|webp)/.test(info.mime)) return null;
  if (info.width < minWidth || info.width / info.height > MAX_ASPECT) return null;
  // Mapas, diagramas, logos, escudos, banderas, carteles y capturas no son
  // fotos del tema (MaV: MALO_TITULO).
  if ((opts.badTitle ?? BAD_COMMONS_TITLE).test(page.title ?? "")) return null;
  const meta = info.extmetadata ?? {};
  const license = commercialLicense(meta.License?.value ?? meta.LicenseShortName?.value);
  if (!license) return null;
  return {
    provider: "commons",
    external_id: String(page.pageid),
    type: "IMAGE",
    // Miniatura de 1920 de ancho: alcanza para 1080p y pesa mucho menos que el original.
    url: info.thumburl ?? info.url,
    // Wikimedia solo sirve anchos estandar (500 si, 480 da 400).
    thumb_url: info.thumburl ? info.thumburl.replace(/\/\d+px-/, "/500px-") : info.url,
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

async function commonsFile(fileName: string, query: string, minWidth = MIN_IMAGE_WIDTH): Promise<VisualCandidate | null> {
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
  return page ? commonsCandidate(page, query, minWidth) : null;
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
    const candidate = await commonsFile(file, entity, MIN_ENTITY_IMAGE_WIDTH);
    if (candidate) results.push({ ...candidate, provider: "wikidata", external_id: hit.id });
    if (results.length >= 2) break;
  }
  return results;
}

// ---------- Wikipedia (las imagenes del articulo) ----------

// Lo que NO es una ilustracion del tema en un articulo: iconos de plantillas,
// banderas, logos, escudos, mapas de ubicacion genericos, simbolos y audio.
// A diferencia de Commons, los diagramas y las ilustraciones SI sirven aca.
export const BAD_ARTICLE_IMAGE =
  /(\bicon|icono|\bflag\b|flag[ _]of|bandera|\blogo|escudo|coat[ _]of[ _]arms|location[ _]?map|locator|mapa[ _]de[ _]localizaci|mapa[ _]de[ _]ubicaci|relief[ _]map|\bblank[ _]map|orthographic[ _]projection|symbol|s[ií]mbolo|pictogram|disambig|question[ _]book|wiki(pedia|data|source|quote|media|species|books|news|versity|voyage)|commons-logo|edit-clear|pencil|l[aá]piz|oojs|\bpog\b|increase|decrease|steady|arrow|flecha|loudspeaker|speaker|altavoz|padlock|crystal[ _]clear|nuvola|gnome-|ambox|\bstub\b|portal|signature|firma|\.(ogg|oga|ogv|webm|mid|wav|mp3|flac|tif|tiff|pdf|djvu)$)/i;
// Minimo para una ilustracion de articulo (retratos viejos y fosiles suelen
// ser chicos; el render la muestra entera sobre su copia desenfocada).
const MIN_ARTICLE_IMAGE_WIDTH = 500;
// Un SVG mas chico que esto es un icono o un simbolo, no un diagrama.
const MIN_ARTICLE_SVG_WIDTH = 800;
const ARTICLE_MAX_IMAGES = 12;

export function articleImageAllowed(fileTitle: string): boolean {
  const name = fileTitle.replace(/^(File|Archivo|Imagen|Image):/i, "");
  return !!name && !BAD_ARTICLE_IMAGE.test(name);
}

// Imagenes de un articulo de Wikipedia (es, si no existe en, o el idioma que
// se pida primero): MediaWiki prop=images y la info de cada archivo en Commons
// (licencia y autor). Los archivos locales de Wikipedia (no libres) no estan
// en Commons y quedan afuera solos. Hoy Wikidata da una sola foto (P18); esto
// trae ilustraciones, diagramas, fosiles, retratos y fotos de epoca.
export async function searchWikipediaImages(title: string, languages: string[] = ["es", "en"]): Promise<VisualCandidate[]> {
  const article = title.trim();
  if (!article) return [];
  for (const lang of languages) {
    const params = new URLSearchParams({ action: "query", format: "json", formatversion: "2", titles: article, redirects: "1", prop: "images", imlimit: "100" });
    const data = await wikimediaJson<{ query?: { pages?: { title: string; missing?: boolean; images?: { title: string }[] }[] } }>(
      `https://${lang}.wikipedia.org/w/api.php?${params}`
    ).catch(() => null);
    const page = data?.query?.pages?.[0];
    if (!page || page.missing) continue;
    const files = (page.images ?? [])
      .map((i) => i.title.replace(/^[^:]+:/, ""))
      .filter((name) => articleImageAllowed(name))
      .slice(0, 50);
    if (files.length === 0) continue;
    const info = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      titles: files.map((f) => `File:${f}`).join("|"),
      prop: "imageinfo",
      iiprop: IMAGEINFO,
      iiurlwidth: "1920",
      iiextmetadatafilter: EXTMETA,
    });
    const meta = await wikimediaJson<{ query?: { pages?: CommonsPage[] } }>(`${COMMONS_API}?${info}`).catch(() => null);
    const byName = new Map((meta?.query?.pages ?? []).map((p) => [p.title.replace(/^File:/, ""), p]));
    const pageUrl = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`;
    const out: VisualCandidate[] = [];
    // En el orden en que aparecen en el articulo (la primera suele ser la principal).
    for (const f of files) {
      const p = byName.get(f) ?? byName.get(f.replace(/_/g, " "));
      if (!p) continue;
      const c = commonsCandidate(p, article, MIN_ARTICLE_IMAGE_WIDTH, { badTitle: BAD_ARTICLE_IMAGE, svgMinWidth: MIN_ARTICLE_SVG_WIDTH });
      if (c) out.push({ ...c, provider: "wikipedia", query: `${article} (${pageUrl})` });
      if (out.length >= ARTICLE_MAX_IMAGES) break;
    }
    if (out.length) return out;
  }
  return [];
}

// ---------- Openverse (fotos CC de Flickr y otros) ----------

// Bancos de stock dentro de Openverse (fotos genericas de escritorios,
// laptops, gente posando): en un documental no van.
const OPENVERSE_STOCK_SOURCES = new Set(["stocksnap", "rawpixel", "nappy", "wordpress", "woc_tech", "justtakeitfree", "svgsilh"]);
const STOCK_HOSTS = /(^|\.)(unsplash|pexels|pixabay|stocksnap|rawpixel|nappy|burst\.shopify|freepik|shutterstock|istockphoto|gettyimages|depositphotos|dreamstime|123rf|canva|picjumbo|kaboompics|freerangestock|negativespace|gratisography|lifeofpix|startupstockphotos)\./i;

export function isStockResult(r: { source?: string; provider?: string; url?: string; foreign_landing_url?: string }): boolean {
  if (OPENVERSE_STOCK_SOURCES.has((r.source ?? "").toLowerCase()) || OPENVERSE_STOCK_SOURCES.has((r.provider ?? "").toLowerCase())) return true;
  return [r.url, r.foreign_landing_url].some((u) => {
    try {
      return !!u && STOCK_HOSTS.test(`${new URL(u).hostname}.`);
    } catch {
      return false;
    }
  });
}

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
  source?: string;
  provider?: string;
}

export async function searchOpenverseImages(query: string): Promise<VisualCandidate[]> {
  const params = new URLSearchParams({ q: query, page_size: "20", license_type: "commercial,modification", mature: "false" });
  const data = await getJson<{ results?: OpenverseResult[] }>(`https://api.openverse.org/v1/images/?${params}`);
  return (data.results ?? [])
    .flatMap((r): VisualCandidate[] => {
      const license = commercialLicense(r.license);
      if (!license) return [];
      if (isStockResult(r)) return [];
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

// Palabras que el Montajista agrega a la query pero que casi nunca estan en
// el titulo de un item de archive.org.
const ARCHIVE_FILLER = /^(footage|film|video|clip|archive|archival|newsreel|historic|historical|old|vintage|black|white|close|up|the|a|an|of|in|on|at|and|with)$/i;

// archive.org exige TODAS las palabras en el titulo o los temas: "Titanic
// dock passengers 1912 footage" da 0 y "Titanic" (1912) trae el metraje real.
// Se prueba la query completa y, si no hay nada, versiones mas cortas.
export async function searchArchiveVideos(query: string, year?: number, entidad?: string): Promise<VisualCandidate[]> {
  const clean = (s: string) => s.replace(/[()"]/g, " ").replace(/\s+/g, " ").trim();
  const significant = clean(query)
    .split(" ")
    .filter((w) => w && !/^\d+s?$/.test(w) && !ARCHIVE_FILLER.test(w));
  // Ultimo intento: la primera palabra (suele ser el sujeto); el juez descarta lo que no sirva.
  const first = significant[0] && significant[0].length > 3 ? significant[0] : "";
  const attempts = [clean(query), significant.join(" "), entidad ? clean(entidad) : "", significant.slice(0, 2).join(" "), first];
  const tried = new Set<string>();
  for (const terms of attempts) {
    if (!terms || tried.has(terms.toLowerCase())) continue;
    tried.add(terms.toLowerCase());
    // Primero las colecciones curadas (como MaV); si no hay nada, el resto
    // con licencia de dominio publico (filtro de titulos + juez sobre los
    // cuadros reales). Solo con curadas se perdia el metraje real de 1912.
    const curated = await searchArchiveOnce(terms, query, year, true);
    if (curated.length > 0) return curated;
    const found = await searchArchiveOnce(terms, query, year, false);
    if (found.length > 0) return found;
  }
  return [];
}

function normTitle(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function titleMatchesHalf(title: string, terms: string): boolean {
  const words = [...new Set(normTitle(terms).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !ARCHIVE_FILLER.test(w)))];
  if (words.length === 0) return true;
  const t = normTitle(title);
  const hits = words.filter((w) => t.includes(w)).length;
  return hits >= Math.ceil(words.length / 2);
}

async function searchArchiveOnce(terms: string, query: string, year: number | undefined, curated: boolean): Promise<VisualCandidate[]> {
  const yearFilter = year ? ` AND year:[${year - 8} TO ${year + 8}]` : "";
  // Relevancia: la busqueda tiene que estar en el titulo o en los temas, no
  // en cualquier parte de la descripcion (traia peliculas que solo la nombraban).
  const scope = curated ? `collection:(${ARCHIVE_COLLECTIONS.join(" OR ")})` : "licenseurl:*publicdomain*";
  const q = `(title:(${terms}) OR subject:(${terms})) AND mediatype:movies AND ${scope}${yearFilter}`;
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
    // Remixes, peliculas y videos de fans subidos como "dominio publico" (en
    // la prueba entro el logo de un DJ).
    if (BLOCKED_TITLE.test(`${doc.title ?? ""} ${doc.identifier}`)) continue;
    // MaV (clipArchivo): el titulo tiene que tener al menos la mitad de las
    // palabras buscadas; asi no entra un show brasileno buscando el Titanic.
    if (!titleMatchesHalf(`${doc.title ?? ""} ${doc.identifier.replace(/[-_]/g, " ")}`, terms)) continue;
    const meta = await getJson<{ files?: ArchiveFile[]; metadata?: { creator?: string } }>(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`);
    const mp4 = (meta.files ?? [])
      .filter((f) => /\.mp4$/i.test(f.name) && Number(f.size ?? 0) > 0 && Number(f.size) < ARCHIVE_MAX_BYTES)
      .sort((a, b) => Number(b.width ?? 0) - Number(a.width ?? 0))[0];
    if (!mp4) continue;
    // Sin thumb_url a proposito: el juez saca cuadros de los primeros
    // segundos del mp4, que es lo que muestra el render (la miniatura de
    // archive.org puede ser de otra parte del video).
    results.push({
      provider: "archive_org",
      external_id: doc.identifier,
      type: "VIDEO",
      url: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(mp4.name)}`,
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

export type SourceName = "wikidata" | "commons" | "wikipedia" | "openverse" | "archive" | "youtube" | "ai_image";

export interface ShotSearch {
  clase: ShotClass;
  query: string;
  entidad?: string;
  anio?: number;
  // Articulo de Wikipedia del tramo (montajista): sus imagenes son una fuente.
  articulo?: string;
}

// Orden de fuentes para cada clase. SIN stock (Pexels, Unsplash y bancos
// parecidos): en el documental no se usa en ningun paso (pedido del cliente,
// 25/11/2026). youtube (solo con DOCUMENTAL_YOUTUBE=on, ver youtubeSource.ts):
// como en MaV, es la fuente del metraje real y del lugar filmado. wikipedia:
// las imagenes del articulo del tramo, si el montajista dio uno.
export function sourceChain(search: ShotSearch, archiveFirst: boolean, youtube = false): SourceName[] {
  const historic = search.anio !== undefined && search.anio < 1990;
  const yt: SourceName[] = youtube ? ["youtube"] : [];
  const wp: SourceName[] = search.articulo ? ["wikipedia"] : [];
  switch (search.clase) {
    case "persona":
      return ["wikidata", "commons", ...wp, "openverse"];
    case "lugar":
      return historic ? ["commons", "archive", ...yt, ...wp, "openverse"] : [...yt, "commons", ...wp, "openverse"];
    case "cosa":
      return search.entidad ? ["wikidata", "commons", ...yt, ...wp, "openverse"] : ["commons", ...yt, ...wp, "openverse"];
    case "metraje":
      return archiveFirst || historic ? ["archive", ...yt, "commons", ...wp] : [...yt, "archive", "commons", ...wp];
    // Mapa: no se busca nada (como MaV). Lleva el mapa animado (map_marker).
    case "mapa":
      return [];
    case "grafico":
    case "ambiente":
    default:
      return historic ? ["archive", "openverse", "commons", ...wp] : ["openverse", "commons", ...yt, ...wp];
  }
}
