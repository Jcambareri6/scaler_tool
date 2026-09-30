import type { TranscribedWord } from "../tools/transcribeAudio.tool.js";

export interface TokenTiming {
  start: number;
  end: number;
}

// Tokens del guion tal como los cuentan build_scenes/build_timeline (split
// por espacios) -- el alineador devuelve un timing por cada uno, en el mismo
// orden.
export function tokenizeScript(text: string): string[] {
  return text.trim() ? text.trim().split(/\s+/) : [];
}

// Minusculas, sin acentos ni puntuacion: "¿Cómo?" y " como" de Whisper
// tienen que comparar igual. Un token que queda vacio ("—", "...") es solo
// puntuacion -- Whisper nunca lo devuelve como palabra.
function normalize(token: string): string {
  return token
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ]/g, "");
}

// Ancho minimo de la banda de la DP a cada lado de la diagonal -- cubre de
// sobra las diferencias locales vistas en produccion (numeros escritos en
// letras vs digitos, palabras que Whisper se come o parte distinto).
const MIN_BAND = 400;

// Antes se asumia que la palabra i del guion era la palabra i de Whisper.
// Nunca matchean exacto (en produccion: 3791 palabras de guion vs 3743 de
// Whisper en un mismo video -- numeros "diez" vs "10", "—" sueltos, palabras
// que Whisper omite), y cada diferencia corria TODAS las escenas siguientes:
// a los 20 minutos las imagenes iban ~15-20s atrasadas respecto de la voz.
// Aca se hace una alineacion de secuencias (edit distance con banda
// alrededor de la diagonal) entre los tokens normalizados del guion y las
// palabras de Whisper: cada token del guion queda mapeado a la palabra real
// que le corresponde, o a ninguna (gap) si Whisper no la tiene. Los tokens
// sin pareja heredan el hueco entre su vecino anterior y el siguiente, asi
// un error local nunca se propaga al resto del video.
export function alignScriptTokens(scriptTokens: string[], words: TranscribedWord[]): TokenTiming[] {
  const timings: TokenTiming[] = new Array(scriptTokens.length);
  if (scriptTokens.length === 0) return timings;
  if (words.length === 0) {
    for (let i = 0; i < scriptTokens.length; i++) timings[i] = { start: 0, end: 0 };
    return timings;
  }

  // Indices (en scriptTokens / words) de los tokens que participan de la
  // alineacion -- los de solo puntuacion quedan afuera y se interpolan.
  const aIdx: number[] = [];
  const aNorm: string[] = [];
  scriptTokens.forEach((t, i) => {
    const n = normalize(t);
    if (n) {
      aIdx.push(i);
      aNorm.push(n);
    }
  });
  const bIdx: number[] = [];
  const bNorm: string[] = [];
  words.forEach((w, j) => {
    const n = normalize(w.word);
    if (n) {
      bIdx.push(j);
      bNorm.push(n);
    }
  });

  const matchOf = new Int32Array(aNorm.length).fill(-1);
  const n = aNorm.length;
  const m = bNorm.length;

  if (n > 0 && m > 0) {
    const band = Math.max(MIN_BAND, Math.abs(n - m) + 100);
    const width = 2 * band + 1;
    const center = (i: number) => Math.round((i * m) / n);
    const INF = 1 << 29;
    // cost[i][k] con k = j - center(i) + band; dir: 0 diag, 1 up (gap en
    // Whisper), 2 left (palabra extra de Whisper).
    const dir = new Uint8Array((n + 1) * width);
    let prev = new Int32Array(width).fill(INF);
    let curr = new Int32Array(width).fill(INF);
    for (let k = 0; k < width; k++) {
      const j = k - band; // center(0) = 0
      if (j >= 0 && j <= m) {
        prev[k] = j;
        dir[k] = 2;
      }
    }
    for (let i = 1; i <= n; i++) {
      curr.fill(INF);
      const c = center(i);
      const cPrev = center(i - 1);
      for (let k = 0; k < width; k++) {
        const j = c + k - band;
        if (j < 0 || j > m) continue;
        let best = INF;
        let bestDir = 1;
        // up: (i-1, j)
        const kUp = j - cPrev + band;
        if (kUp >= 0 && kUp < width && prev[kUp]! < INF) {
          best = prev[kUp]! + 1;
          bestDir = 1;
        }
        if (j > 0) {
          // diag: (i-1, j-1)
          const kDiag = j - 1 - cPrev + band;
          if (kDiag >= 0 && kDiag < width && prev[kDiag]! < INF) {
            const cost = prev[kDiag]! + (aNorm[i - 1] === bNorm[j - 1] ? 0 : 1);
            if (cost <= best) {
              best = cost;
              bestDir = 0;
            }
          }
          // left: (i, j-1)
          if (k > 0 && curr[k - 1]! < INF && curr[k - 1]! + 1 < best) {
            best = curr[k - 1]! + 1;
            bestDir = 2;
          }
        }
        curr[k] = best;
        dir[i * width + k] = bestDir;
      }
      [prev, curr] = [curr, prev];
    }

    // Backtrack desde (n, m). Solo las diagonales generan pareja (tambien
    // las sustituciones: "diez" vs "10" ocupan el mismo lugar en el audio).
    let i = n;
    let j = m;
    while (i > 0 && j >= 0) {
      const k = j - center(i) + band;
      if (k < 0 || k >= width) break;
      const d = dir[i * width + k];
      if (d === 0) {
        matchOf[i - 1] = j - 1;
        i--;
        j--;
      } else if (d === 1) {
        i--;
      } else {
        j--;
      }
    }
  }

  // Timing directo de los tokens con pareja.
  const matched: (TokenTiming | null)[] = new Array(scriptTokens.length).fill(null);
  for (let a = 0; a < n; a++) {
    const b = matchOf[a]!;
    if (b >= 0) {
      const w = words[bIdx[b]!]!;
      matched[aIdx[a]!] = { start: w.start, end: w.end };
    }
  }

  // Sin pareja: el hueco entre el fin del anterior con pareja y el inicio
  // del siguiente.
  const nextStart: number[] = new Array(scriptTokens.length);
  let upcoming = words[words.length - 1]!.end;
  for (let i = scriptTokens.length - 1; i >= 0; i--) {
    const t = matched[i];
    if (t) upcoming = t.start;
    nextStart[i] = upcoming;
  }
  let prevEnd = words[0]!.start;
  for (let i = 0; i < scriptTokens.length; i++) {
    const t = matched[i];
    if (t) {
      timings[i] = t;
      prevEnd = t.end;
    } else {
      timings[i] = { start: prevEnd, end: Math.max(prevEnd, nextStart[i]!) };
    }
  }
  return timings;
}
