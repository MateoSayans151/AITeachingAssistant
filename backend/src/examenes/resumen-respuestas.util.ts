// Cuántas respuestas tiene un examen y en qué punto de la corrección está cada una. Lo usan la home ("Para revisar") y la lista de
// exámenes de un curso, para que el docente vea de un vistazo qué le falta sin entrar examen por examen. Misma clasificación que
// la pantalla de respuestas (`categoriaDe` en frontend/app/examenes/[id]/respuestas/page.tsx): son funciones puras para poder
// testearlas sin base de datos (la única que toca la base, `resumenesDeExamenes`, recibe el cliente por parámetro).

import type { PrismaService } from '../prisma/prisma.service';

export interface ResumenRespuestas {
  /** Todas las respuestas entregadas. */
  entregadas: number;
  /** La IA todavía no las corrigió (o falló). */
  sinCorregir: number;
  /** La IA ya sugirió una nota y el docente todavía no la revisó. */
  porRevisar: number;
  /** El docente ya las aceptó o las editó. */
  revisadas: number;
}

export interface FilaConteoRespuestas {
  examenId: string;
  estado: 'pendiente_correccion' | 'corregido' | 'revisado';
  estadoRevision: 'pendiente' | 'aceptada' | 'editada';
  cantidad: number;
}

export const RESUMEN_VACIO: ResumenRespuestas = { entregadas: 0, sinCorregir: 0, porRevisar: 0, revisadas: 0 };

/** Agrupa los conteos (examen × estado × revisión) en un resumen por examen. Un examen sin respuestas no aparece en el mapa. */
export function resumirConteos(filas: FilaConteoRespuestas[]): Map<string, ResumenRespuestas> {
  const resumenes = new Map<string, ResumenRespuestas>();
  for (const fila of filas) {
    const actual = resumenes.get(fila.examenId) ?? { ...RESUMEN_VACIO };
    actual.entregadas += fila.cantidad;
    if (fila.estado === 'pendiente_correccion') actual.sinCorregir += fila.cantidad;
    else if (fila.estadoRevision === 'pendiente') actual.porRevisar += fila.cantidad;
    else actual.revisadas += fila.cantidad;
    resumenes.set(fila.examenId, actual);
  }
  return resumenes;
}

/** Una sola consulta agrupada para todos los exámenes pedidos (no una por examen). */
export async function resumenesDeExamenes(prisma: PrismaService, examenIds: string[]): Promise<Map<string, ResumenRespuestas>> {
  if (examenIds.length === 0) return resumirConteos([]);
  const filas = await prisma.respuestaExamen.groupBy({
    by: ['examenId', 'estado', 'estadoRevision'],
    where: { examenId: { in: examenIds } },
    _count: { _all: true },
  });
  return resumirConteos(filas.map((f) => ({ examenId: f.examenId, estado: f.estado, estadoRevision: f.estadoRevision, cantidad: f._count._all })));
}

export interface ExamenPorRevisar extends ResumenRespuestas {
  id: string;
  titulo: string;
  cursoId: string;
  cursoNombre: string;
}

/**
 * Los exámenes que todavía necesitan algo del docente (respuestas por revisar o sin corregir), primero los que más tienen para
 * revisar. Los que están al día no aparecen.
 */
export function examenesPorRevisar(
  examenes: { id: string; titulo: string; cursoId: string; curso: { nombre: string } }[],
  resumenes: Map<string, ResumenRespuestas>,
): ExamenPorRevisar[] {
  return examenes
    .map((e) => ({ id: e.id, titulo: e.titulo, cursoId: e.cursoId, cursoNombre: e.curso.nombre, ...(resumenes.get(e.id) ?? RESUMEN_VACIO) }))
    .filter((e) => e.porRevisar + e.sinCorregir > 0)
    .sort((a, b) => b.porRevisar - a.porRevisar || b.sinCorregir - a.sinCorregir || a.titulo.localeCompare(b.titulo, 'es'));
}
