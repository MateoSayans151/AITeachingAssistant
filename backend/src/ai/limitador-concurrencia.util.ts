// Semáforo chico para no mandarle al LLM / a embeddings decenas de llamadas a la vez.
// Cuando un examen con tiempo límite se cierra, entregan 60-120 alumnos en el mismo minuto:
// sin tope, el proveedor responde 429 y las correcciones quedan trabadas.

/** Tope por defecto de llamadas a la IA en simultáneo (se pisa con la env IA_MAX_CONCURRENTES). */
export const IA_MAX_CONCURRENTES_DEFAULT = 4;

/** Lee el tope desde la env: solo vale un entero >= 1, cualquier otra cosa cae al default. */
export function maxConcurrentesDesdeEnv(valor: string | undefined, porDefecto = IA_MAX_CONCURRENTES_DEFAULT): number {
  const n = Number(valor);
  return valor?.trim() && Number.isInteger(n) && n >= 1 ? n : porDefecto;
}

/**
 * Corre a lo sumo `maximo` tareas a la vez; el resto espera en una cola FIFO. Si una tarea
 * falla (o tira), libera su lugar igual y el error le llega a quien la pidió.
 */
export class LimitadorConcurrencia {
  private activas = 0;
  private readonly esperando: Array<() => void> = [];

  constructor(readonly maximo: number) {
    if (!Number.isInteger(maximo) || maximo < 1) {
      throw new RangeError(`El tope de concurrencia tiene que ser un entero >= 1 (llegó ${maximo})`);
    }
  }

  /** Tareas corriendo ahora. */
  get enCurso() {
    return this.activas;
  }

  /** Tareas esperando su turno. */
  get enEspera() {
    return this.esperando.length;
  }

  async ejecutar<T>(tarea: () => Promise<T> | T): Promise<T> {
    // Si hay lugar lo toma directo; si no, espera a que alguien le pase el suyo.
    if (this.activas < this.maximo) this.activas += 1;
    else await new Promise<void>((resolve) => this.esperando.push(resolve));
    try {
      return await tarea();
    } finally {
      this.liberar();
    }
  }

  private liberar() {
    // El lugar pasa directo al primero de la cola (sin bajar `activas`): así nadie
    // que llegue justo en el medio se le cuela, y se respeta el orden de llegada.
    const siguiente = this.esperando.shift();
    if (siguiente) siguiente();
    else this.activas -= 1;
  }
}
