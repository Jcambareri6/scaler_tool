import type { ToolDefinition } from "./tool.types.js";
import { ProviderNotConfiguredError } from "./tool.errors.js";
import { getActiveProvidersByType } from "../lib/providers.js";
import { isMockMode } from "../lib/mock.js";
import { supabase } from "../lib/supabase.js";
import { withRetry } from "../lib/retry.js";
import { fetchWithTimeout } from "../lib/http.js";
import type { ContentPolicy, Provider } from "../types/shared/typeShared.js";

export interface SearchStockInput {
  keywords: string[];
  content_policy?: ContentPolicy;
  // Si viene, se priorizan candidatos cuyo duration_seconds cubra la
  // escena -- de lo contrario el video de stock corta antes de que
  // termine la narracion (visto en produccion: escena de 52s con un clip
  // de 16s). No descarta los mas cortos (a veces son los unicos
  // disponibles), solo los manda al final.
  min_duration_seconds?: number;
  // Keys "provider:external_id" ya usadas en OTRAS escenas de este mismo
  // video (o en regeneraciones previas de esta escena, ver
  // stockSegments.ts::readStockHistory). Sin esto, la cascada de keywords
  // se corta apenas UNA keyword trae resultados sin saber si esos
  // resultados ya estan todos gastados -- si una keyword especifica de
  // nicho solo tiene 2-3 clips relevantes y otra escena ya se quedo con
  // ambos, esta escena terminaba "conformandose" con esa tanda agotada en
  // vez de probar la siguiente keyword (mas amplia) para traer candidatos
  // frescos, y eso es lo que se veia como el mismo clip/contenido
  // generico repetido en escenas distintas.
  exclude_keys?: string[];
}

export interface StockCandidate {
  // Slug del Provider que lo devolvio (pexels, pixabay, mock, o el que se
  // vaya agregando -- ver PROVIDER_CLIENTS).
  provider: string;
  external_id: string;
  url: string;
  preview_url: string;
  duration_seconds?: number;
  // Que keyword de la cascada (o del fallback de seguridad) trajo este
  // candidato -- se persiste en metadata del Asset (ver
  // replaceStockSegmentsForScene) para poder auditar despues por que se
  // eligio tal clip, y para poder distinguir a simple vista un match
  // literal de un fallback generico.
  matched_keyword?: string;
}

// Video de muestra publico (Google Cloud Storage sample bucket), embebible
// sin CORS -- sirve para poder previsualizar el StockReviewPanel del
// frontend incluso sin ninguna cuenta de Pexels/Pixabay todavia.
const MOCK_VIDEO_URL =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

function mockCandidates(keyword: string): StockCandidate[] {
  return [
    {
      provider: "mock",
      external_id: `mock-${keyword.replace(/\s+/g, "-")}`,
      url: MOCK_VIDEO_URL,
      preview_url: MOCK_VIDEO_URL,
      duration_seconds: 10,
      matched_keyword: keyword,
    },
  ];
}

export interface SearchStockOutput {
  candidates: StockCandidate[];
}

const PEXELS_VIDEO_SEARCH_URL = "https://api.pexels.com/videos/search";
const PIXABAY_VIDEO_SEARCH_URL = "https://pixabay.com/api/videos/";
const COVERR_VIDEO_SEARCH_URL = "https://api.coverr.co/videos";
const RESULTS_PER_KEYWORD = 5;

interface PexelsVideoFile {
  link: string;
  width: number;
}

interface PexelsVideo {
  id: number;
  url: string;
  image: string;
  duration: number;
  video_files: PexelsVideoFile[];
}

// Pexels no expone tags/descripcion en su API de video (LEEME seccion 8: "a
// veces la metadata no dice que hay ninos, escuelas o personas") -> aca no
// hay texto contra el cual filtrar content_policy, solo aplica el cruce con
// stock_library_entries y la revision visual manual que exige el LEEME.
async function searchPexels(apiKey: string, keyword: string): Promise<StockCandidate[]> {
  const url = `${PEXELS_VIDEO_SEARCH_URL}?query=${encodeURIComponent(keyword)}&per_page=${RESULTS_PER_KEYWORD}`;
  const data = await withRetry(async () => {
    const response = await fetchWithTimeout(url, { headers: { Authorization: apiKey } });
    if (!response.ok) {
      throw new Error(`Pexels API error (${response.status}): ${await response.text()}`);
    }
    return (await response.json()) as { videos: PexelsVideo[] };
  });

  return (data.videos ?? []).map((video) => ({
    provider: "pexels" as const,
    external_id: String(video.id),
    url: video.url,
    preview_url: [...video.video_files].sort((a, b) => a.width - b.width)[0]?.link ?? video.image,
    duration_seconds: video.duration,
  }));
}

interface PixabayHit {
  id: number;
  pageURL: string;
  tags: string;
  duration: number;
  videos: {
    medium?: { url: string };
    small?: { url: string };
    tiny?: { url: string };
  };
}

function matchesAny(text: string, words: string[]): boolean {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word.toLowerCase()));
}

// Pixabay si expone "tags" (string separado por comas) en cada hit, asi que
// aca el bloqueo de content_policy.block se puede aplicar antes de devolver
// el candidato, a diferencia de Pexels.
async function searchPixabay(
  apiKey: string,
  keyword: string,
  block: string[]
): Promise<StockCandidate[]> {
  const url = `${PIXABAY_VIDEO_SEARCH_URL}?key=${apiKey}&q=${encodeURIComponent(keyword)}&per_page=${RESULTS_PER_KEYWORD}`;
  const data = await withRetry(async () => {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`Pixabay API error (${response.status}): ${await response.text()}`);
    }
    return (await response.json()) as { hits: PixabayHit[] };
  });

  return (data.hits ?? [])
    .filter((hit) => !matchesAny(hit.tags ?? "", block))
    .map((hit) => ({
      provider: "pixabay" as const,
      external_id: String(hit.id),
      url: hit.pageURL,
      preview_url:
        hit.videos.medium?.url ?? hit.videos.small?.url ?? hit.videos.tiny?.url ?? hit.pageURL,
      duration_seconds: hit.duration,
    }));
}

interface CoverrVideo {
  id: string;
  title: string;
  tags: string[];
  // La API la devuelve como STRING (ej: "23.833333"), no numero -- se
  // convierte explicitamente al mapear en vez de dejar que la resta/
  // comparacion de duracion en el sort de mas abajo la coerciona sola.
  duration: string;
  urls?: { mp4?: string; mp4_preview?: string; mp4_download?: string };
}

// Coverr si expone "tags" (array) en cada video, asi que el bloqueo de
// content_policy.block se puede aplicar antes de devolver el candidato,
// igual que con Pixabay. Requiere `urls=true` en el query o la API no
// manda las URLs del archivo (quedarian undefined).
async function searchCoverr(apiKey: string, keyword: string, block: string[]): Promise<StockCandidate[]> {
  const url = `${COVERR_VIDEO_SEARCH_URL}?query=${encodeURIComponent(keyword)}&page_size=${RESULTS_PER_KEYWORD}&urls=true`;
  const data = await withRetry(async () => {
    const response = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!response.ok) {
      throw new Error(`Coverr API error (${response.status}): ${await response.text()}`);
    }
    return (await response.json()) as { hits: CoverrVideo[] };
  });

  return (data.hits ?? [])
    .filter((video) => !matchesAny((video.tags ?? []).join(" "), block))
    .filter((video): video is CoverrVideo & { urls: { mp4: string } } => !!video.urls?.mp4)
    .map((video) => ({
      provider: "coverr" as const,
      external_id: video.id,
      url: video.urls.mp4,
      preview_url: video.urls.mp4,
      duration_seconds: Number(video.duration),
    }));
}

// Dispatch por slug -- agregar un proveedor nuevo de stock de video es:
// 1) fila en `providers` con type='stock_video', 2) un cliente ac  y
// registrarlo aca. search_stock en si no vuelve a tocarse (lee
// getActiveProvidersByType("stock_video") y listo).
type StockClient = (apiKey: string, keyword: string, block: string[]) => Promise<StockCandidate[]>;
const PROVIDER_CLIENTS: Record<string, StockClient> = {
  pexels: (apiKey, keyword) => searchPexels(apiKey, keyword),
  pixabay: (apiKey, keyword, block) => searchPixabay(apiKey, keyword, block),
  coverr: (apiKey, keyword, block) => searchCoverr(apiKey, keyword, block),
};

// Gap #2/#3 del LEEME: el filtrado final cruza los candidatos con
// stock_library_entries (BLOCKED/PREFERRED, por usuario) y content_policy
// (por proyecto) antes de devolverlos.
export const searchStockTool: ToolDefinition<SearchStockInput, SearchStockOutput> = {
  name: "search_stock",
  description:
    "Busca clips de stock en todos los Providers activos de type=stock_video probando `keywords` en cascada (la primera que traiga resultados gana), filtrados contra content_policy y stock_library_entries.",
  parameters: {
    type: "object",
    properties: {
      keywords: {
        type: "array",
        items: { type: "string" },
        description: "Keywords de busqueda de stock, ordenadas de mas especifica a mas amplia -- se prueban en orden, cortando en la primera que traiga resultados",
      },
      content_policy: {
        type: "object",
        description: "Reglas de block/prefer del proyecto (opcional)",
        properties: {
          block: { type: "array", items: { type: "string" } },
          prefer: { type: "array", items: { type: "string" } },
          notes: { type: "string" },
        },
      },
      min_duration_seconds: {
        type: "number",
        description: "Duracion minima deseada del clip (ej: duracion de la escena que va a cubrir)",
      },
      exclude_keys: {
        type: "array",
        items: { type: "string" },
        description: "Keys 'provider:external_id' ya usadas en este video (otras escenas o regeneraciones previas de esta) -- si una keyword de la cascada trae resultados pero todos ya estan en esta lista, se prueba la siguiente keyword en vez de conformarse",
      },
    },
    required: ["keywords"],
  },
  async execute({ keywords, content_policy, min_duration_seconds, exclude_keys }, ctx) {
    const providers: Provider[] = await getActiveProvidersByType("stock_video");
    const usableProviders = providers.filter((p) => p.api_key && PROVIDER_CLIENTS[p.slug]);

    if (usableProviders.length === 0 && !isMockMode()) {
      throw new ProviderNotConfiguredError("search_stock");
    }

    const block = content_policy?.block ?? [];

    const { data: entries, error } = await supabase
      .from("stock_library_entries")
      .select("provider, external_id, decision")
      .eq("user_id", ctx.userId);

    if (error) {
      throw new Error(error.message);
    }

    const key = (c: { provider: string; external_id: string }) => `${c.provider}:${c.external_id}`;
    const blocked = new Set(
      (entries ?? []).filter((e) => e.decision === "BLOCKED").map(key)
    );
    const preferred = new Set(
      (entries ?? []).filter((e) => e.decision === "PREFERRED").map(key)
    );

    // Si ninguna de las 4 keywords especificas trae nada utilizable
    // (proveedor caido, termino muy de nicho), en vez de dejar la escena sin
    // ningun visual se prueba esta ultima red de contencion: terminos
    // genericos de b-roll que Pexels/Pixabay practicamente siempre tienen
    // indexados. No es tan preciso como una keyword especifica, pero es
    // mejor una metafora/ambiente generico acorde que una escena vacia.
    const FALLBACK_SAFETY_KEYWORDS = [
      "cinematic background b-roll",
      "abstract motion background",
      "nature landscape aerial",
    ];

    const excludeKeys = new Set(exclude_keys ?? []);

    // Antes esta funcion se conformaba con la PRIMERA keyword que trajera
    // algo no bloqueado, sin saber si esos candidatos ya estaban todos
    // gastados en otras escenas/regeneraciones de este mismo video. Con
    // keywords de nicho (4-6 palabras, la mas especifica de la cascada) el
    // stock disponible puede ser 2-3 clips nada mas -- si otra escena ya se
    // quedo con esos, esta escena terminaba recibiendo la misma tanda
    // agotada (y replaceStockSegmentsForScene los descartaba a todos, o en
    // el peor caso quedaba sin clip). Ahora sigue bajando en la cascada
    // mientras la tanda actual no tenga NINGUN candidato fresco, y solo si
    // ninguna keyword trae algo fresco vuelve al primer resultado no vacio
    // (mejor repetir contenido que dejar la escena sin ningun visual).
    async function tryKeywordCascade(list: string[]): Promise<StockCandidate[]> {
      let fallback: StockCandidate[] = [];
      for (const keyword of list) {
        // allSettled, no all: si un proveedor puntual falla (rate limit,
        // timeout, key vencida) no tiene que tirar abajo el intento entero
        // -- se sigue con lo que hayan devuelto los demas.
        const results = await Promise.allSettled(
          usableProviders.map((provider) =>
            PROVIDER_CLIENTS[provider.slug]!(provider.api_key!, keyword, block)
          )
        );
        const found = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
        // Se marca aca la keyword que efectivamente trajo el candidato
        // (matched_keyword) -- replaceStockSegmentsForScene la persiste en
        // metadata para poder auditar despues que keyword eligio cada clip.
        const usable = found
          .filter((c) => !blocked.has(key(c)))
          .map((c) => ({ ...c, matched_keyword: keyword }));
        if (usable.length === 0) continue;
        if (fallback.length === 0) fallback = usable;
        const hasFreshCandidate = usable.some((c) => !excludeKeys.has(key(c)));
        if (hasFreshCandidate) return usable;
      }
      return fallback;
    }

    let candidates: StockCandidate[];
    if (usableProviders.length === 0) {
      candidates = keywords.length > 0 ? mockCandidates(keywords[0]!) : [];
    } else {
      // Cascada (prompt del cliente, Fase 2): `keywords` llega ordenada de
      // mas especifica a mas amplia (generate_stock_keywords) -- se prueba
      // cada una contra todos los Providers en paralelo y se corta apenas
      // una trae al menos un candidato utilizable (no bloqueado), en vez de
      // buscar las 4 siempre y mezclar todo. Si ninguna trae nada, se cae al
      // fallback generico de arriba antes de rendirse.
      candidates = await tryKeywordCascade(keywords);
      if (candidates.length === 0) {
        candidates = await tryKeywordCascade(FALLBACK_SAFETY_KEYWORDS);
      }
    }

    candidates = candidates.filter((c) => !blocked.has(key(c)));

    // Los candidatos que YA cubren la escena entera (min_duration_seconds)
    // no necesitan ordenarse por duracion -- cualquiera de ellos alcanza,
    // asi que ahi conviene preservar el orden de relevancia que devuelve el
    // Provider (el mas relevante al keyword primero) en vez de pisarlo con
    // la duracion. Antes se reordenaba TODO por duracion descendente sin
    // condicion, asi que un clip largo pero poco relacionado le podia ganar
    // a uno mas corto y mucho mas relevante -- eso es justamente lo que se
    // ve como "clips sin contexto" en produccion.
    const fitsScene = (c: StockCandidate) =>
      !min_duration_seconds || (c.duration_seconds ?? 0) >= min_duration_seconds;
    const fitting = candidates.filter(fitsScene);
    const short = candidates.filter((c) => !fitsScene(c));

    fitting.sort((a, b) => Number(preferred.has(key(b))) - Number(preferred.has(key(a))));
    // Los que NO alcanzan a cubrir la escena solos si se ordenan por
    // duracion descendente: el relleno greedy de replaceStockSegmentsForScene
    // agarra primero el que mas terreno cubre y arma la escena con 1-2 clips
    // en vez de 3-4 cortitos.
    short.sort((a, b) => {
      const durationDiff = (b.duration_seconds ?? 0) - (a.duration_seconds ?? 0);
      if (durationDiff !== 0) return durationDiff;
      return Number(preferred.has(key(b))) - Number(preferred.has(key(a)));
    });

    return { candidates: [...fitting, ...short] };
  },
};
