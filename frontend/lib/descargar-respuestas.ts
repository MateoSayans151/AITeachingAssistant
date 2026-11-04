// Descargar las respuestas como CSV desde el navegador: la que usan la pantalla de respuestas y los diálogos de borrado (examen, curso, comisión),
// donde es una opción para quedarse con una copia antes de borrar. Pide los datos al servidor y arma el archivo con lib/exportar-respuestas.ts.

import { getExamen, listExamenesPorCurso, listRespuestasPorExamen } from './api';
import type { Examen, RespuestaExamen } from './api';
import { armarCsv, nombreArchivoCsv } from './exportar-respuestas';
import { armarCsvResumen, totalDeRespuestas } from './exportar-resumen';
import type { GrupoExamen } from './exportar-resumen';

/** Baja un archivo de texto: crea un enlace temporal y lo «clickea». */
export function descargarArchivo(nombre: string, contenido: string, tipo = 'text/csv;charset=utf-8;'): void {
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

/** Descarga el CSV de un examen con las respuestas que ya se tienen a mano (la pantalla de respuestas). */
export function descargarCsvDeExamen(examen: Examen, respuestas: RespuestaExamen[]): void {
  const preguntas = (examen.preguntas ?? []).map((p) => ({ id: p.id, puntajeMaximo: puntajeDePregunta(p) }));
  descargarArchivo(nombreArchivoCsv(examen.titulo), armarCsv(respuestas, preguntas, Number(examen.escalaMax)));
}

/** Pide las respuestas de un examen y las descarga. Devuelve cuántas bajó; tira un Error si no hay ninguna. */
export async function descargarRespuestasDeExamen(examenId: string): Promise<number> {
  const [examen, respuestas] = await Promise.all([getExamen(examenId), listRespuestasPorExamen(examenId)]);
  if (respuestas.length === 0) throw new Error('Este examen todavía no tiene respuestas para descargar.');
  descargarCsvDeExamen(examen, respuestas);
  return respuestas.length;
}

async function gruposDelCurso(cursoId: string, soloComisionId?: string): Promise<GrupoExamen[]> {
  const examenes = await listExamenesPorCurso(cursoId);
  const grupos: GrupoExamen[] = [];
  for (const e of examenes) {
    const respuestas = await listRespuestasPorExamen(e.id);
    // Con una comisión, solo las de sus alumnos (el listado trae al alumno con su comisión).
    const filas = soloComisionId ? respuestas.filter((r) => r.alumno?.comisionId === soloComisionId) : respuestas;
    if (filas.length > 0) grupos.push({ titulo: e.titulo, escalaMax: Number(e.escalaMax), filas });
  }
  return grupos;
}

/** Descarga las respuestas de TODOS los exámenes de un curso en un solo CSV. Devuelve cuántas bajó; tira un Error si no hay ninguna. */
export async function descargarRespuestasDeCurso(cursoId: string, nombreCurso: string): Promise<number> {
  const grupos = await gruposDelCurso(cursoId);
  const total = totalDeRespuestas(grupos);
  if (total === 0) throw new Error('Este curso todavía no tiene respuestas para descargar.');
  descargarArchivo(nombreArchivoCsv(nombreCurso), armarCsvResumen(grupos));
  return total;
}

/** Descarga las respuestas de los alumnos de UNA comisión (de todos los exámenes del curso) en un solo CSV. */
export async function descargarRespuestasDeComision(cursoId: string, comisionId: string, nombreComision: string): Promise<number> {
  const grupos = await gruposDelCurso(cursoId, comisionId);
  const total = totalDeRespuestas(grupos);
  if (total === 0) throw new Error('Esta comisión todavía no tiene respuestas para descargar.');
  descargarArchivo(nombreArchivoCsv(nombreComision), armarCsvResumen(grupos));
  return total;
}
