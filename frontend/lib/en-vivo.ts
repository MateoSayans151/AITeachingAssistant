// Textos del panel «En vivo». Funciones puras (sin React) para testearlas solas (backend/test/en-vivo-texto.test.ts).

/** «hace 5 s», «hace 3 min», «hace 2 h»: cuánto pasó desde `iso`, medido contra `ahora` (el reloj del servidor, no el de la computadora). */
export function haceCuanto(iso: string, ahora: string | Date): string {
  const seg = Math.max(0, Math.round((new Date(ahora).getTime() - new Date(iso).getTime()) / 1000));
  if (seg < 10) return 'ahora';
  if (seg < 60) return `hace ${seg} s`;
  const min = Math.floor(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return `hace ${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

/** «32 min», «1 h 5 min», «menos de 1 min», «venció»: lo que le queda al alumno. Sin vencimiento: «sin límite». */
export function tiempoRestante(expiraEn: string | null, ahora: string | Date): string {
  if (!expiraEn) return 'sin límite';
  const seg = Math.round((new Date(expiraEn).getTime() - new Date(ahora).getTime()) / 1000);
  if (seg <= 0) return 'venció';
  if (seg < 60) return 'menos de 1 min';
  const min = Math.floor(seg / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

/** Cuánto lleva rindiendo: «12 min». */
export function tiempoTranscurrido(inicioEn: string, ahora: string | Date): string {
  const min = Math.max(0, Math.floor((new Date(ahora).getTime() - new Date(inicioEn).getTime()) / 60_000));
  if (min < 1) return 'recién empezó';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

/** Porcentaje de preguntas con algo respondido (0 a 100); 0 si el examen no tiene preguntas. */
export function porcentajeAvance(respondidas: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round((respondidas / total) * 100)) : 0;
}

/** Cómo se nombra cada señal de integridad en el panel (versión corta; la revisión de una respuesta usa la larga). */
export const ETIQUETA_SENAL: Record<string, string> = {
  salida_pantalla_completa: 'Salió de pantalla completa',
  cambio_pestana: 'Cambió de pestaña',
  pegado: 'Pegó texto',
  pantalla_compartida_detenida: 'Dejó de compartir pantalla',
  superficie_no_permitida: 'Compartió una ventana, no la pantalla',
  monitor_extendido: 'Más de un monitor',
  salto_de_texto: 'Texto de golpe',
  cambio_de_origen: 'Lo abrió desde otro lugar',
  captura_omitida: 'No envió una captura',
  latido_perdido: 'Perdió la señal',
};

/** «Cambió de pestaña ×3, Pegó texto» — las señales de un alumno en una línea, las más frecuentes primero. */
export function resumenSenales(senales: Record<string, number>): string {
  return Object.entries(senales)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([tipo, n]) => `${ETIQUETA_SENAL[tipo] ?? tipo}${n > 1 ? ` ×${n}` : ''}`)
    .join(', ');
}
