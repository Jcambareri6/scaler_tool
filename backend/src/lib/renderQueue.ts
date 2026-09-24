// Cola de concurrencia para el render final (ffmpeg) -- un solo render ya
// vimos que puede pasar los 4GB de RAM y llenar /tmp por si solo (ver
// renderVideo.tool.ts). Sin esto, dos usuarios (o el mismo dueño + un
// cliente) aprobando un render casi al mismo tiempo hacen que el proceso
// intente correr dos ffmpeg pesados en simultaneo -- eso es lo que tiraba
// abajo la instancia entera, no un bug puntual de cada render individual.
//
// Semaforo simple en memoria: alcanza porque todo corre en un solo proceso
// Node (no hay multiples instancias del backend balanceando carga). Si el
// dia de mañana el backend escala a mas de una instancia, esto deja de
// alcanzar (cada instancia tendria su propio semaforo, sin coordinacion) y
// hay que mover la cola a algo compartido (ej: una columna "reserved" en la
// tabla jobs, o Cloudflare Queues si se separa el render a otro servicio).
class RenderQueue {
  private running = 0;
  private readonly maxConcurrent: number;
  private readonly waiting: (() => void)[] = [];

  constructor(maxConcurrent: number) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  private release(): void {
    this.running--;
    const next = this.waiting.shift();
    if (next) next();
  }
}

// Default 1: un solo render ffmpeg a la vez. Se puede subir con
// MAX_CONCURRENT_RENDERS si en el futuro el plan de hosting tiene margen
// real de sobra para mas de uno (medido, no adivinado).
const MAX_CONCURRENT_RENDERS = Number(process.env.MAX_CONCURRENT_RENDERS ?? 1);

export const renderQueue = new RenderQueue(MAX_CONCURRENT_RENDERS);
