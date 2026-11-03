// Reglas de tiempo y avisos del control del docente: funciones puras (sin base de datos) para testearlas solas.

/** Cuándo vence el intento de un alumno: lo que dura la sesión desde que empezó, sin pasarse del cierre del link, más el tiempo extra que le dio el docente. */
export function calcularExpiracion(inicioEn: Date, duracionMinutos: number, minutosExtra: number, fechaFin: Date | null): Date {
  let expira = inicioEn.getTime() + duracionMinutos * 60_000;
  if (fechaFin && fechaFin.getTime() < expira) expira = fechaFin.getTime();
  return new Date(expira + minutosExtra * 60_000);
}

/** ¿El examen está cerrado ahora? Por el docente (estado) o porque llegó la hora del cierre programado (aunque el barrido todavía no haya pasado). */
export function estaCerrado(examen: { estado: string; cierreProgramadoEn?: Date | null }, ahora: Date): boolean {
  return examen.estado === 'cerrado' || (!!examen.cierreProgramadoEn && examen.cierreProgramadoEn.getTime() <= ahora.getTime());
}

/** Lo que ve el alumno en el cartel; null si no hay aviso. `enviadoEn` identifica al aviso: uno nuevo vuelve a mostrarse aunque el alumno haya cerrado el anterior. */
export function avisoDe(examen: { avisoTexto?: string | null; avisoEn?: Date | null } | null | undefined): { texto: string; enviadoEn: string } | null {
  if (!examen?.avisoTexto || !examen.avisoEn) return null;
  return { texto: examen.avisoTexto, enviadoEn: examen.avisoEn.toISOString() };
}

/** El aviso automático cuando el docente cambia la duración de la sesión. */
export function textoAvisoDuracion(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  const cuanto = h > 0 ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
  return `El docente cambió la duración del examen: ahora dura ${cuanto} desde que cada uno empezó. Fijate el reloj.`;
}
