// Exportar las respuestas de un examen a un CSV que Excel abre bien a la primera. Funciones puras (sin DOM) para testearlas solas
// (backend/test/exportar-respuestas.test.ts). Lo que hace distinto de un CSV "común":
//   - UTF-8 con BOM: sin él Excel lee «Pérez» como «PÃ©rez».
//   - Separador «;»: con la configuración regional de Argentina, Excel separa las columnas con punto y coma (la coma es el decimal).
//   - Notas con coma decimal («8,5») y fechas «dd/mm/aaaa hh:mm», para que Excel las tome como números y fechas.
//   - Una columna por pregunta, con encabezados que se entienden sin mirar el examen.
//   - Texto que empieza con = + - @ (el nombre que escribió un alumno, por ejemplo) se neutraliza: si no, Excel lo ejecuta como fórmula.

import type { EstadoEntrega, EstadoRevision } from './api';

export interface FilaRespuesta {
  alumno?: { nombre?: string | null; email?: string | null } | null;
  estado: EstadoEntrega;
  estadoRevision: EstadoRevision;
  notaTotalSugerida: string | number | null;
  notaConVara: string | number | null;
  notaTotalFinal: string | number | null;
  createdAt: string;
  revisadoEn: string | null;
  notificadoEn?: string | null;
  intento?: { estado: string; eventos: number } | null;
  respuestasPorPregunta?: Array<{ preguntaId: string; notaSugerida: number | string | null; notaFinal: number | string | null }> | null;
}

export interface PreguntaExportada {
  id: string;
  puntajeMaximo: number;
}

const SEPARADOR = ';';
const SALTO = '\r\n';

/** Número con coma decimal y sin ceros de más: 8.5 → «8,5», 7 → «7», «6.25» → «6,25». Vacío si no hay número. */
export function numeroAr(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '';
  const n = Number(valor);
  if (!Number.isFinite(n)) return '';
  return (Math.round((n + Number.EPSILON) * 100) / 100).toString().replace('.', ',');
}

/** «03/11/2026 14:05» en hora de Buenos Aires, o vacío. */
export function fechaAr(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const partes = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const p = (tipo: string) => partes.find((x) => x.type === tipo)?.value ?? '';
  return `${p('day')}/${p('month')}/${p('year')} ${p('hour')}:${p('minute')}`;
}

/**
 * Una celda lista para el CSV. Texto que empieza con = + - @ o un tabulador se antecede con un apóstrofe para que Excel no lo
 * evalúe como fórmula (inyección de fórmulas: un alumno puede escribir cualquier cosa como nombre). Comillas si lleva ; " o saltos.
 */
export function celda(valor: unknown): string {
  let texto = valor === null || valor === undefined ? '' : String(valor);
  if (/^[=+\-@\t\r]/.test(texto) && !/^-?\d+(,\d+)?$/.test(texto)) texto = `'${texto}`;
  return /[;"\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

const ESTADO_CORRECCION: Record<EstadoEntrega, string> = {
  pendiente_correccion: 'Sin corregir por la IA',
  corregido: 'Corregida por la IA',
  revisado: 'Revisada',
};
const ESTADO_REVISION: Record<EstadoRevision, string> = {
  pendiente: 'Para revisar',
  aceptada: 'Aceptada',
  editada: 'Editada',
};

/** La nota de cada pregunta: la que dejó el docente o, si todavía no revisó, la que sugirió la IA. */
function notaDePregunta(r: FilaRespuesta, preguntaId: string): string {
  const item = r.respuestasPorPregunta?.find((x) => x.preguntaId === preguntaId);
  if (!item) return '';
  return numeroAr(item.notaFinal ?? item.notaSugerida);
}

export function armarCsv(filas: FilaRespuesta[], preguntas: PreguntaExportada[], escalaMax: number): string {
  const encabezado = [
    'Alumno',
    'Email',
    'Fecha de entrega',
    'Cómo se cerró',
    'Corrección de la IA',
    'Revisión del docente',
    `Nota sugerida por la IA (sobre ${numeroAr(escalaMax)})`,
    'Nota con vara',
    `Nota final (sobre ${numeroAr(escalaMax)})`,
    'Fecha de revisión',
    'Mail con la nota enviado',
    'Señales de integridad',
    ...preguntas.map((p, i) => `Pregunta ${i + 1} (máx. ${numeroAr(p.puntajeMaximo)})`),
  ];

  const cuerpo = filas.map((r) => [
    r.alumno?.nombre ?? '',
    r.alumno?.email ?? '',
    fechaAr(r.createdAt),
    r.intento ? (r.intento.estado === 'vencido' ? 'Venció el tiempo' : 'Entregado por el alumno') : '',
    ESTADO_CORRECCION[r.estado] ?? r.estado,
    ESTADO_REVISION[r.estadoRevision] ?? r.estadoRevision,
    numeroAr(r.notaTotalSugerida),
    numeroAr(r.notaConVara),
    numeroAr(r.notaTotalFinal),
    fechaAr(r.revisadoEn),
    r.notificadoEn ? fechaAr(r.notificadoEn) : '',
    r.intento ? r.intento.eventos : '',
    ...preguntas.map((p) => notaDePregunta(r, p.id)),
  ]);

  const lineas = [encabezado, ...cuerpo].map((fila) => fila.map(celda).join(SEPARADOR));
  return `﻿${lineas.join(SALTO)}${SALTO}`;
}

/** Un nombre de archivo que cualquier sistema acepta: sin caracteres reservados ni espacios, con la fecha del día. */
export function nombreArchivoCsv(titulo: string, hoy: Date = new Date()): string {
  const base =
    titulo
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'examen';
  const y = hoy.getFullYear();
  const m = String(hoy.getMonth() + 1).padStart(2, '0');
  const d = String(hoy.getDate()).padStart(2, '0');
  return `${base}_respuestas_${y}-${m}-${d}.csv`;
}
