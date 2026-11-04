// Descargar las respuestas como CSV desde el navegador: la que usan la pantalla de respuestas y los diálogos de borrado (examen, curso, comisión),
// donde es una opción para quedarse con una copia antes de borrar. Pide los datos al servidor y arma el archivo con lib/exportar-respuestas.ts.
//
// Un examen baja un CSV. Un curso o una comisión, que juntan varios exámenes, bajan un .zip con el CSV de cada examen (con sus notas por pregunta,
// sin los comentarios del feedback) y un resumen general: cada examen tiene sus propias preguntas, así que no entran en una sola tabla.

import { getExamen, listExamenesPorCurso, listRespuestasPorExamen } from './api';
import type { Examen, RespuestaExamen } from './api';
import { armarCsv, nombreArchivoCsv } from './exportar-respuestas';
import { armarCsvResumen, nombresDeArchivosPorExamen, totalDeRespuestas } from './exportar-resumen';
import { armarZip } from './zip';

/** Baja un archivo: crea un enlace temporal y lo «clickea». */
export function descargarArchivo(nombre: string, contenido: BlobPart, tipo = 'text/csv;charset=utf-8;'): void {
  const blob = new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Cuánto vale la pregunta: cerradas → su puntaje; abiertas → la suma de los puntos de sus criterios. */
export function puntajeDePregunta(p: NonNullable<Examen['preguntas']>[number]): number {
  const cerrada = ['numerica', 'relacionar_pares', 'opcion_multiple', 'casillas', 'verdadero_falso'].includes(p.tipo);
  if (cerrada) return Number(p.puntajeMaximo);
  return (p.criterios ?? []).reduce((acc, c) => acc + Number(c.puntajeMaximo), 0);
}

/** El CSV de un examen: una fila por alumno y una columna por pregunta (con su nota). */
export function csvDeExamen(examen: Examen, respuestas: RespuestaExamen[]): string {
  const preguntas = (examen.preguntas ?? []).map((p) => ({ id: p.id, puntajeMaximo: puntajeDePregunta(p) }));
  return armarCsv(respuestas, preguntas, Number(examen.escalaMax));
}

/** Descarga el CSV de un examen con las respuestas que ya se tienen a mano (la pantalla de respuestas). */
export function descargarCsvDeExamen(examen: Examen, respuestas: RespuestaExamen[]): void {
  descargarArchivo(nombreArchivoCsv(examen.titulo), csvDeExamen(examen, respuestas));
}

/** Pide las respuestas de un examen y las descarga. Devuelve cuántas bajó; tira un Error si no hay ninguna. */
export async function descargarRespuestasDeExamen(examenId: string): Promise<number> {
  const [examen, respuestas] = await Promise.all([getExamen(examenId), listRespuestasPorExamen(examenId)]);
  if (respuestas.length === 0) throw new Error('Este examen todavía no tiene respuestas para descargar.');
  descargarCsvDeExamen(examen, respuestas);
  return respuestas.length;
}

interface GrupoConExamen {
  examen: Examen;
  filas: RespuestaExamen[];
}

/** Los exámenes del curso que tienen respuestas (con sus preguntas, para las columnas); con `soloComisionId`, solo las de los alumnos de esa comisión. */
async function gruposDelCurso(cursoId: string, soloComisionId?: string): Promise<GrupoConExamen[]> {
  const examenes = await listExamenesPorCurso(cursoId);
  const grupos: GrupoConExamen[] = [];
  for (const resumen of examenes) {
    const respuestas = await listRespuestasPorExamen(resumen.id);
    const filas = soloComisionId ? respuestas.filter((r) => r.alumno?.comisionId === soloComisionId) : respuestas;
    if (filas.length === 0) continue;
    // El listado del curso no trae las preguntas: se piden del examen para armar las columnas.
    grupos.push({ examen: await getExamen(resumen.id), filas });
  }
  return grupos;
}

/**
 * Baja lo de varios exámenes: si es uno solo, su CSV; si son varios, un .zip con el CSV de cada uno (con sus notas por pregunta) y un resumen general.
 * Un solo archivo, porque el navegador bloquea varias descargas seguidas.
 */
async function descargarGrupos(nombreBase: string, grupos: GrupoConExamen[], vacio: string): Promise<number> {
  const total = totalDeRespuestas(grupos.map((g) => ({ titulo: g.examen.titulo, escalaMax: Number(g.examen.escalaMax), filas: g.filas })));
  if (total === 0) throw new Error(vacio);

  if (grupos.length === 1) {
    descargarCsvDeExamen(grupos[0].examen, grupos[0].filas);
    return total;
  }
  const nombres = nombresDeArchivosPorExamen(grupos.map((g) => g.examen.titulo));
  const zip = await armarZip([
    { nombre: '00_resumen_de_todos_los_examenes.csv', contenido: armarCsvResumen(grupos.map((g) => ({ titulo: g.examen.titulo, escalaMax: Number(g.examen.escalaMax), filas: g.filas }))) },
    ...grupos.map((g, i) => ({ nombre: nombres[i], contenido: csvDeExamen(g.examen, g.filas) })),
  ]);
  descargarArchivo(nombreArchivoCsv(nombreBase).replace(/\.csv$/, '.zip'), zip as unknown as BlobPart, 'application/zip');
  return total;
}

/** Descarga las respuestas de TODOS los exámenes de un curso. Devuelve cuántas bajó; tira un Error si no hay ninguna. */
export async function descargarRespuestasDeCurso(cursoId: string, nombreCurso: string): Promise<number> {
  return descargarGrupos(nombreCurso, await gruposDelCurso(cursoId), 'Este curso todavía no tiene respuestas para descargar.');
}

/** Descarga las respuestas de los alumnos de UNA comisión (de todos los exámenes del curso). */
export async function descargarRespuestasDeComision(cursoId: string, comisionId: string, nombreComision: string): Promise<number> {
  return descargarGrupos(nombreComision, await gruposDelCurso(cursoId, comisionId), 'Esta comisión todavía no tiene respuestas para descargar.');
}
