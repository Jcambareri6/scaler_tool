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
}

export interface StockCandidate {
  // Slug del Provider que lo devolvio (pexels, pixabay, mock, o el que se
  // vaya agregando -- ver PROVIDER_CLIENTS).
  provider: string;
  external_id: string;
  url: string;
  preview_url: string;
  duration_seconds?: number;
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
    "Busca clips de stock en todos los Providers activos de type=stock_video, por keywords, filtrados contra content_policy y stock_library_entries.",
  parameters: {
    type: "object",
    properties: {
      keywords: {
        type: "array",
        items: { type: "string" },
        description: "Keywords de busqueda de stock",
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
    },
    required: ["keywords"],
  },
  async execute({ keywords, content_policy, min_duration_seconds }, ctx) {
    const providers: Provider[] = await getActiveProvidersByType("stock_video");
    const usableProviders = providers.filter((p) => p.api_key && PROVIDER_CLIENTS[p.slug]);

    if (usableProviders.length === 0 && !isMockMode()) {
      throw new ProviderNotConfiguredError("search_stock");
    }

    const block = content_policy?.block ?? [];

    let candidates: StockCandidate[];
    if (usableProviders.length === 0) {
      candidates = keywords.flatMap((keyword) => mockCandidates(keyword));
    } else {
      // allSettled, no all: si un proveedor puntual falla (rate limit,
      // timeout, key vencida) no tiene que tirar abajo la busqueda entera
      // -- se sigue con lo que hayan devuelto los demas. Solo si TODOS
      // fallan, candidates queda vacio (mismo camino que "sin resultados"
      // que ya manejan los callers).
      const results = await Promise.allSettled(
        keywords.flatMap((keyword) =>
          usableProviders.map((provider) =>
            PROVIDER_CLIENTS[provider.slug]!(provider.api_key!, keyword, block)
          )
        )
      );
      candidates = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
    }

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

    candidates = candidates
      .filter((c) => !blocked.has(key(c)))
      .sort((a, b) => {
        if (min_duration_seconds) {
          const aFits = (a.duration_seconds ?? 0) >= min_duration_seconds ? 1 : 0;
          const bFits = (b.duration_seconds ?? 0) >= min_duration_seconds ? 1 : 0;
          if (aFits !== bFits) return bFits - aFits;
        }
        // Antes solo se ordenaba por "encaja si/no" -- entre los que no
        // encajaban quedaban en el orden crudo de la API, asi que el
        // relleno greedy de replaceStockSegmentsForScene terminaba armando
        // una escena con 3-4 clips cortitos en vez de 1-2 largos. Ordenando
        // por duracion descendente, ese relleno agarra primero el candidato
        // que mas terreno cubre (idealmente casi toda la escena) y recien
        // despues suma uno mas corto para el resto, en vez de varios.
        const durationDiff = (b.duration_seconds ?? 0) - (a.duration_seconds ?? 0);
        if (durationDiff !== 0) return durationDiff;
        return Number(preferred.has(key(b))) - Number(preferred.has(key(a)));
      });

    return { candidates };
  },
};
