// La LISTA de preguntas del wizard de "Nuevo examen" (paso 2): reordenar, duplicar, plegar y desplegar tarjetas, repartir los
// puntos en partes iguales, copiar una rúbrica a otras preguntas y ubicar qué preguntas nombran los errores de validación.
// Sin React ni estado: todo lo que se pueda probar suelto va acá (lo usan PasoPreguntas y PreguntaCard).
//
// Ninguna función muta lo que recibe: devuelven listas y preguntas nuevas (los componentes se las pasan al estado del padre).

import { TIPOS_AUTOCORREGIBLES } from './api';
import { formatearPuntos, puntajeEfectivoDe, validarPregunta } from './examen-form';
import type { PreguntaForm } from './examen-form';

export const esPreguntaAbierta = (p: PreguntaForm): boolean => !TIPOS_AUTOCORREGIBLES.includes(p.tipo);

/** Copia profunda de datos planos (objetos, arreglos y primitivos): lo que se copia no comparte ninguna referencia con el original. */
function copiaProfunda<T>(valor: T): T {
  if (Array.isArray(valor)) return valor.map(copiaProfunda) as unknown as T;
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor as Record<string, unknown>).map(([k, v]) => [k, copiaProfunda(v)])) as T;
  }
  return valor;
}

// ---------------------------------------------------------------- reordenar y duplicar

/**
 * Lista nueva con el elemento `indice` movido `delta` lugares (-1 sube, +1 baja). Si el destino queda fuera de la lista (la
 * primera no sube, la última no baja) o el índice no existe, devuelve una copia sin cambios.
 */
export function moverPregunta<T>(lista: T[], indice: number, delta: number): T[] {
  const destino = indice + delta;
  const valido = Number.isInteger(indice) && Number.isInteger(delta) && delta !== 0;
  if (!valido || indice < 0 || indice >= lista.length || destino < 0 || destino >= lista.length) return [...lista];
  const copia = [...lista];
  const [movida] = copia.splice(indice, 1);
  copia.splice(destino, 0, movida);
  return copia;
}

/**
 * Lista nueva con una copia profunda de la pregunta `indice` justo debajo de ella (misma definición, ninguna referencia en
 * común) y desplegada, para editarla enseguida. La original queda como estaba. Con un índice que no existe devuelve una copia
 * de la lista sin cambios.
 */
export function duplicarPregunta(lista: PreguntaForm[], indice: number): PreguntaForm[] {
  if (!Number.isInteger(indice) || indice < 0 || indice >= lista.length) return [...lista];
  const copia: PreguntaForm = { ...copiaProfunda(lista[indice]), plegada: false };
  return [...lista.slice(0, indice + 1), copia, ...lista.slice(indice + 1)];
}

// ---------------------------------------------------------------- plegar y desplegar

/** Pliega las preguntas completas (sin errores de `validarPregunta`) y deja como están las incompletas. Lista nueva. */
export function plegarCompletas(lista: PreguntaForm[]): PreguntaForm[] {
  return lista.map((q, i) => (!q.plegada && validarPregunta(q, i).length === 0 ? { ...q, plegada: true } : q));
}

/** Agrega una pregunta nueva al final, desplegada, y pliega las demás que ya estén completas (la lista no crece en pantalla). */
export function agregarPreguntaPlegando(lista: PreguntaForm[], nueva: PreguntaForm): PreguntaForm[] {
  return [...plegarCompletas(lista), { ...nueva, plegada: false }];
}

/** Despliega las preguntas con esos índices (base 0). Devuelve la MISMA lista si no hubo nada que desplegar. */
export function desplegarPreguntas(lista: PreguntaForm[], indices: number[]): PreguntaForm[] {
  const aDesplegar = new Set(indices);
  if (!lista.some((q, i) => q.plegada && aDesplegar.has(i))) return lista;
  return lista.map((q, i) => (q.plegada && aDesplegar.has(i) ? { ...q, plegada: false } : q));
}

// ---------------------------------------------------------------- resumen de una pregunta plegada

/** Enunciado en una sola línea (espacios y saltos colapsados). Vacío si no hay nada escrito. */
export function resumenEnunciado(enunciado: string): string {
  return enunciado.replace(/\s+/g, ' ').trim();
}

/** Lo que vale la pregunta, para la fila plegada: "1,5 pts" o "sin puntos" si falta o no es válido. */
export function etiquetaPuntos(p: PreguntaForm): string {
  const puntos = puntajeEfectivoDe(p);
  return puntos > 0 ? `${formatearPuntos(puntos)} pts` : 'sin puntos';
}

// ---------------------------------------------------------------- repartir los puntos

/**
 * Reparte `total` puntos en `cantidad` partes iguales a 2 decimales, como los strings que guarda el formulario ("3.33"). El
 * resto del redondeo lo absorbe la ÚLTIMA parte, así la suma es EXACTA: 10 entre 3 da 3.33 / 3.33 / 3.34. Se trabaja en
 * centésimas enteras para no arrastrar ruido de coma flotante. Devuelve [] si no hay nada que repartir (`cantidad` no es un
 * entero >= 1 o `total` no es un número > 0).
 */
export function repartirPuntos(cantidad: number, total: number): string[] {
  if (!Number.isInteger(cantidad) || cantidad < 1 || !Number.isFinite(total) || total <= 0) return [];
  const centesimas = Math.round(total * 100);
  if (centesimas <= 0) return [];
  const base = Math.floor(centesimas / cantidad);
  const ultima = centesimas - base * (cantidad - 1);
  return Array.from({ length: cantidad }, (_, i) => String((i === cantidad - 1 ? ultima : base) / 100));
}

/** ¿Alguna pregunta ya tiene puntos cargados (aunque sea 0)? Repartir los pisaría. */
export function hayPuntosCargados(lista: PreguntaForm[]): boolean {
  return lista.some((q) => q.puntajeMaximo.trim() !== '');
}

// ---------------------------------------------------------------- rúbrica de una pregunta abierta -> otras

/** ¿La pregunta ya tiene algo escrito en sus criterios (nombre, qué se espera o peso)? Una fila en blanco no cuenta. */
export function tieneCriteriosCargados(p: PreguntaForm): boolean {
  return p.criterios.some((c) => c.nombre.trim() !== '' || c.descripcion.trim() !== '' || c.peso.trim() !== '');
}

/**
 * Copia los criterios de `origen` (nombre, descripción, peso, detalle de niveles y la matriz de la que vienen) a `destino`,
 * que conserva todo lo demás: sus puntos, su enunciado y si está plegada. Los criterios copiados son independientes de los de
 * `origen` (copia profunda). Si `destino` es una pregunta cerrada no tiene rúbrica: se devuelve tal cual.
 */
export function copiarRubricaA(origen: PreguntaForm, destino: PreguntaForm): PreguntaForm {
  if (!esPreguntaAbierta(destino)) return destino;
  return { ...destino, criterios: copiaProfunda(origen.criterios) };
}

// ---------------------------------------------------------------- errores de validación -> preguntas

/**
 * Índices (base 0, sin repetir y en orden) de las preguntas que nombran los mensajes de error: "Pregunta 3: falta el
 * enunciado." y "Pregunta 3, criterio 2: falta el peso." señalan la pregunta 3 (índice 2). Los demás mensajes (del total, del
 * servidor…) no apuntan a ninguna.
 */
export function indicesConError(errores: string[]): number[] {
  const indices = new Set<number>();
  for (const mensaje of errores) {
    const m = /^Pregunta (\d+)\b/.exec(mensaje);
    if (m && Number(m[1]) >= 1) indices.add(Number(m[1]) - 1);
  }
  return [...indices].sort((a, b) => a - b);
}
