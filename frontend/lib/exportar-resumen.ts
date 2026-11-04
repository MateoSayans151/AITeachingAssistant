// CSV con las respuestas de VARIOS exámenes juntas (para descargar antes de borrar un curso o una comisión). Mismo formato que el de un examen
// (BOM, «;», coma decimal, fechas locales, fórmulas neutralizadas: ver exportar-respuestas.ts) pero con una columna «Examen» y sin una columna por
// pregunta, porque cada examen tiene las suyas. Funciones puras, para testearlas solas (backend/test/exportar-respuestas.test.ts).

import { ESTADO_CORRECCION, ESTADO_REVISION, celda, fechaAr, numeroAr } from './exportar-respuestas';
import type { FilaRespuesta } from './exportar-respuestas';

export interface GrupoExamen {
  titulo: string;
  escalaMax: number;
  filas: FilaRespuesta[];
}

const SEPARADOR = ';';
const SALTO = '\r\n';

export function armarCsvResumen(grupos: GrupoExamen[]): string {
  const encabezado = [
    'Examen',
    'Alumno',
    'Email',
    'Fecha de entrega',
    'Cómo se cerró',
    'Corrección de la IA',
    'Revisión del docente',
    'Nota sugerida por la IA',
    'Nota con vara',
    'Nota final',
    'Sobre (puntaje máximo)',
    'Fecha de revisión',
    'Mail con la nota enviado',
    'Señales de integridad',
  ];
  const cuerpo = grupos.flatMap((g) =>
    g.filas.map((r) => [
      g.titulo,
      r.alumno?.nombre ?? '',
      r.alumno?.email ?? '',
      fechaAr(r.createdAt),
      r.intento ? (r.intento.estado === 'vencido' ? 'Venció el tiempo' : 'Entregado por el alumno') : '',
      ESTADO_CORRECCION[r.estado] ?? r.estado,
      ESTADO_REVISION[r.estadoRevision] ?? r.estadoRevision,
      numeroAr(r.notaTotalSugerida),
      numeroAr(r.notaConVara),
      numeroAr(r.notaTotalFinal),
      numeroAr(g.escalaMax),
      fechaAr(r.revisadoEn),
      r.notificadoEn ? fechaAr(r.notificadoEn) : '',
      r.intento ? r.intento.eventos : '',
    ]),
  );
  return `﻿${[encabezado, ...cuerpo].map((fila) => fila.map(celda).join(SEPARADOR)).join(SALTO)}${SALTO}`;
}

/**
 * Nombres de archivo para los CSV de cada examen dentro del .zip: sin tildes ni caracteres reservados, con un número adelante (el orden de los
 * exámenes) y sin repetirse aunque dos exámenes se llamen igual. «Parcial 1: Álgebra» → «01_Parcial_1_Algebra.csv».
 */
export function nombresDeArchivosPorExamen(titulos: string[]): string[] {
  const usados = new Map<string, number>();
  return titulos.map((titulo, i) => {
    const base =
      titulo
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 50) || 'examen';
    const prefijo = String(i + 1).padStart(2, '0');
    const clave = `${prefijo}_${base}`;
    const veces = (usados.get(clave) ?? 0) + 1;
    usados.set(clave, veces);
    return `${clave}${veces > 1 ? `_${veces}` : ''}.csv`;
  });
}

/** Cuántas respuestas hay en total en los grupos (lo que se descargaría). */
export const totalDeRespuestas = (grupos: GrupoExamen[]): number => grupos.reduce((suma, g) => suma + g.filas.length, 0);
