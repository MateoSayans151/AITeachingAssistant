import { FragmentoMaterial, MaterialCursoInput } from '../ai/ai.types';
import { claveTexto } from '../ai/sugerencia-preguntas.util';
import { fragmentarTexto } from '../rag/rag.service';

/**
 * Lógica pura (sin red ni base) de "qué parte del material del curso le llega a la IA al sugerir preguntas". Separada del service
 * para poder testearla sin base ni embeddings. Tres fuentes, en este orden de prioridad:
 *  1. el material que el docente tildó (por unidad o por título): es lo que pidió, así que entra tal cual (o, si no entra entero,
 *     lo más cercano al tema según la búsqueda semántica y, en su defecto, una muestra pareja de todo lo tildado);
 *  2. con un tema escrito a mano: lo que devuelve la búsqueda semántica;
 *  3. sin tema (o si la búsqueda no trajo nada): una muestra pareja de todo el material del curso.
 */

/** Cuánto texto de material entra en un pedido (~12 fragmentos de 2.200 caracteres): acota el costo por token. */
export const PRESUPUESTO_MATERIAL = 26_000;

export interface MaterialDelCurso {
  titulo: string;
  unidad: string | null;
  contenido: string;
}

/** Materiales cuya unidad o título coincide (sin mayúsculas ni tildes) con alguno de los temas. */
export function materialesDeLosTemas(materiales: MaterialDelCurso[], temas: string[]): MaterialDelCurso[] {
  const claves = new Set(temas.map(claveTexto).filter(Boolean));
  if (claves.size === 0) return [];
  return materiales.filter((m) => claves.has(claveTexto(m.titulo)) || (m.unidad !== null && claves.has(claveTexto(m.unidad))));
}

/** Parte cada material en fragmentos (los mismos cortes que usa la indexación). */
export function fragmentosDe(materiales: MaterialDelCurso[]): MaterialCursoInput[] {
  return materiales.flatMap((m) => fragmentarTexto(m.contenido).map((contenido) => ({ titulo: m.titulo, unidad: m.unidad, contenido })));
}

/** Los fragmentos que entran en `presupuesto` caracteres, tomados de a saltos parejos para cubrir todo el material y no solo el principio. */
export function muestrear(fragmentos: MaterialCursoInput[], presupuesto: number = PRESUPUESTO_MATERIAL): MaterialCursoInput[] {
  const total = fragmentos.reduce((s, f) => s + f.contenido.length, 0);
  if (total <= presupuesto) return fragmentos;
  const promedio = total / fragmentos.length;
  const cuantos = Math.max(1, Math.floor(presupuesto / promedio));
  const elegidos: MaterialCursoInput[] = [];
  let usado = 0;
  for (let k = 0; k < cuantos; k++) {
    const f = fragmentos[Math.floor((k * fragmentos.length) / cuantos)];
    if (usado + f.contenido.length > presupuesto && elegidos.length > 0) break;
    elegidos.push(f);
    usado += f.contenido.length;
  }
  return elegidos;
}

/** Primeros fragmentos de la lista que entran en el presupuesto, respetando el orden (el de la búsqueda: del más al menos cercano). */
function recortarAPresupuesto(fragmentos: MaterialCursoInput[], presupuesto: number): MaterialCursoInput[] {
  const elegidos: MaterialCursoInput[] = [];
  let usado = 0;
  for (const f of fragmentos) {
    if (usado + f.contenido.length > presupuesto && elegidos.length > 0) break;
    elegidos.push(f);
    usado += f.contenido.length;
  }
  return elegidos;
}

/** Les pone la etiqueta F1, F2… con la que el modelo los cita. */
export function etiquetar(fragmentos: MaterialCursoInput[]): FragmentoMaterial[] {
  return fragmentos.map((f, i) => ({ etiqueta: `F${i + 1}`, titulo: f.titulo, unidad: f.unidad, contenido: f.contenido }));
}

export interface ParamsSeleccion {
  /** Todo el material del curso. */
  materiales: MaterialDelCurso[];
  temas: string[];
  /** Resultado de la búsqueda semántica con los temas y el foco, del más al menos cercano (vacío si no hubo consulta o no trajo nada). */
  rankeados: MaterialCursoInput[];
  presupuesto?: number;
}

export function seleccionarFragmentos({ materiales, temas, rankeados, presupuesto = PRESUPUESTO_MATERIAL }: ParamsSeleccion): FragmentoMaterial[] {
  const tildados = materialesDeLosTemas(materiales, temas);
  if (tildados.length > 0) {
    const pool = fragmentosDe(tildados);
    if (pool.reduce((s, f) => s + f.contenido.length, 0) <= presupuesto) return etiquetar(pool);
    // No entra todo lo tildado: primero lo más cercano al tema entre lo tildado; si la búsqueda no trajo nada de eso, una muestra pareja.
    const titulos = new Set(tildados.map((m) => m.titulo));
    const cercanos = rankeados.filter((f) => titulos.has(f.titulo));
    return etiquetar(cercanos.length > 0 ? recortarAPresupuesto(cercanos, presupuesto) : muestrear(pool, presupuesto));
  }
  if (rankeados.length > 0) return etiquetar(recortarAPresupuesto(rankeados, presupuesto));
  return etiquetar(muestrear(fragmentosDe(materiales), presupuesto));
}
