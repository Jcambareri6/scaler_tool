// Estabilidad de YouTube (como youtubeCircuitBreaker.js, esBloqueoYoutube y
// limpiar() de MaV): sin esto, con YouTube bloqueando cada plano esperaba
// todos sus timeouts (peor caso ~19 min por ronda) y el video no terminaba.
//
// - limpiar: saca usuario:clave del proxy de cualquier mensaje antes de
//   loguearlo o guardarlo en la base.
// - clasificar: bloqueo (bot check, 403/429), red (timeout, conexion) o roto
//   (video privado, borrado, sin formato).
// - freno: tras FRENO_FALLOS bloqueos/errores de red SEGUIDOS se abre
//   FRENO_PAUSA_MS: todo lo de YouTube falla al instante y el plano pasa a la
//   siguiente fuente. Despues deja pasar un intento de prueba.
// - semaforo: como mucho YT_PARALELO procesos de yt-dlp a la vez en el
//   proceso (antes podian ser 12 a la vez por job, mas 192 ffmpeg de hojas).

import { AsyncLocalStorage } from "node:async_hooks";
import { envInt } from "./env.js";

export function limpiar(text: string): string {
  return text
    .replace(/(\/\/)[^\s/@:]+:[^\s/@]+@/g, "$1***@")
    .replace(/customer-[A-Za-z0-9_-]+/g, "customer-***")
    .replace(/(proxy[\s=:]+)\S+/gi, "$1***");
}

export type YoutubeError = "bloqueo" | "red" | "roto";

export function clasificar(err: unknown): YoutubeError {
  const m = err instanceof Error ? err.message : String(err);
  if (/sign in to confirm|not a bot|http error 4(03|29)|\b(403|429)\b|too many requests|blocked|captcha/i.test(m)) return "bloqueo";
  if (/tardo mas|timed? ?out|econnreset|econnrefused|enotfound|eai_again|socket|proxy|unable to download (webpage|api)|network|end of file|sin datos/i.test(m)) return "red";
  return "roto";
}

const FRENO_FALLOS = envInt("YT_FRENO_FALLOS", 4);
const FRENO_PAUSA_MS = envInt("YT_FRENO_PAUSA_MS", 90_000);

class Freno {
  private seguidos = 0;
  private abiertoHasta = 0;
  private probando = false;

  abierto(): boolean {
    if (Date.now() < this.abiertoHasta) return true;
    // Medio abierto: un solo intento de prueba a la vez.
    if (this.abiertoHasta > 0 && this.probando) return true;
    return false;
  }

  async correr<T>(fn: () => Promise<T>): Promise<T> {
    if (this.abierto()) throw new Error("freno de YouTube abierto: se pasa a otra fuente");
    const prueba = this.abiertoHasta > 0;
    if (prueba) this.probando = true;
    try {
      const out = await fn();
      this.seguidos = 0;
      this.abiertoHasta = 0;
      return out;
    } catch (err) {
      const tipo = clasificar(err);
      if (tipo !== "roto") {
        this.seguidos += 1;
        if (prueba || this.seguidos >= FRENO_FALLOS) {
          this.abiertoHasta = Date.now() + FRENO_PAUSA_MS;
          console.warn(`[youtube] freno ABIERTO ${Math.round(FRENO_PAUSA_MS / 1000)} s tras ${this.seguidos} fallos de ${tipo}: ${limpiar((err as Error).message).slice(0, 160)}`);
        }
      }
      throw err;
    } finally {
      if (prueba) this.probando = false;
    }
  }
}

export const frenoYoutube = new Freno();

// Medicion de la espera por un lugar (solo mide, no cambia nada): quien
// quiera saber cuanto espero una bajada la corre adentro de
// esperaSlots.run(medida, ...) y cada semaforo suma ahi lo que espero.
export interface EsperaSlots {
  ms: number;
  por: Record<string, number>;
  // Como salio cada tramo (pedazos, entero, archivo, yt-dlp) y cuanto tardo.
  tramos?: { via: string; ms: number }[];
}
export const esperaSlots = new AsyncLocalStorage<EsperaSlots>();

export function anotarTramo(via: string, ms: number): void {
  const medida = esperaSlots.getStore();
  if (medida) (medida.tramos ??= []).push({ via, ms });
}

// Semaforo simple (FIFO).
export class Semaforo {
  private libres: number;
  private cola: (() => void)[] = [];
  constructor(
    n: number,
    private readonly nombre = "slots"
  ) {
    this.libres = n;
  }
  async con<T>(fn: () => Promise<T>): Promise<T> {
    const pidio = Date.now();
    if (this.libres > 0) this.libres -= 1;
    else await new Promise<void>((resolve) => this.cola.push(resolve));
    const medida = esperaSlots.getStore();
    if (medida) {
      const ms = Date.now() - pidio;
      medida.ms += ms;
      medida.por[this.nombre] = (medida.por[this.nombre] ?? 0) + ms;
    }
    try {
      return await fn();
    } finally {
      const next = this.cola.shift();
      if (next) next();
      else this.libres += 1;
    }
  }
}

export const ytdlpSlots = new Semaforo(envInt("YT_PARALELO", 4), "yt-dlp");
// ffmpeg leyendo cuadros de la red (hojas de cuadros): de a pocos.
export const sheetSlots = new Semaforo(envInt("YT_HOJA_FFMPEG", 6), "hoja");
