// Borrador del wizard de "Nuevo examen": se guarda en el navegador (localStorage) mientras el docente arma el examen, para que
// cerrar la pestaña por error no le haga perder un examen de 15 preguntas. Funciones puras (sin React ni acceso al storage): quien
// las usa se encarga de leer/escribir y de envolverlo en try/catch (el storage puede estar bloqueado o lleno).
//
// Lo que se lee del storage NO es confiable: puede venir de una versión vieja de la app, truncado o editado a mano. Por eso
// `leerBorrador` valida la forma y completa lo que falte con los valores por defecto; si no hay nada rescatable devuelve null.

import { TIPOS_AUTOCORREGIBLES } from './api';
import type { TipoPregunta } from './api';
import { criterioVacio, datosPorDefecto, nivelesPorDefecto, preguntaVacia } from './examen-form';
import type { CriterioForm, DatosForm, NivelForm, PreguntaForm } from './examen-form';

export const VERSION_BORRADOR = 1;

/** Máximo de preguntas que se aceptan al leer un borrador (un tope sano contra un storage corrupto). */
const MAX_PREGUNTAS = 200;

/** Una clave por docente: dos docentes que comparten navegador no ven los borradores del otro. */
export const claveBorrador = (docenteId: string) => `ata_borrador_examen_v${VERSION_BORRADOR}_${docenteId}`;

export interface Borrador {
  version: number;
  /** Cuándo se guardó (ms desde epoch). */
  guardadoEn: number;
  datos: DatosForm;
  preguntas: PreguntaForm[];
}

const TIPOS_VALIDOS: TipoPregunta[] = [
  'desarrollo',
  'resolucion_problema',
  'demostracion',
  'analisis_caso',
  'respuesta_corta',
  'numerica',
  'relacionar_pares',
  'opcion_multiple',
  'casillas',
  'verdadero_falso',
];

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const texto = (v: unknown, por: string) => (typeof v === 'string' ? v : por);
const booleano = (v: unknown, por: boolean) => (typeof v === 'boolean' ? v : por);
const listaDeTextos = (v: unknown, por: string[]) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : por);

/** Texto listo para guardar. */
export function serializarBorrador(datos: DatosForm, preguntas: PreguntaForm[], ahora: number = Date.now()): string {
  const borrador: Borrador = { version: VERSION_BORRADOR, guardadoEn: ahora, datos, preguntas };
  return JSON.stringify(borrador);
}

function nivelesValidos(v: unknown): NivelForm[] | null {
  if (!Array.isArray(v) || v.length < 3 || v.length > 7) return null;
  const niveles: NivelForm[] = [];
  for (const [i, n] of v.entries()) {
    if (!esObjeto(n)) return null;
    niveles.push({
      orden: i + 1,
      nombre: texto(n.nombre, ''),
      colorHex: texto(n.colorHex, '#888888'),
      porcentaje: texto(n.porcentaje, ''),
    });
  }
  return niveles;
}

function criterioValido(v: unknown, niveles: NivelForm[]): CriterioForm | null {
  if (!esObjeto(v)) return null;
  const base = criterioVacio(niveles);
  const detalle = Array.isArray(v.niveles)
    ? v.niveles.map((nv, i) => ({
        orden: i + 1,
        nombre: esObjeto(nv) ? texto(nv.nombre, niveles[i]?.nombre ?? '') : (niveles[i]?.nombre ?? ''),
        descripcion: esObjeto(nv) ? texto(nv.descripcion, '') : '',
      }))
    : base.niveles;
  return {
    ...(typeof v.matrizOrigenId === 'string' ? { matrizOrigenId: v.matrizOrigenId } : {}),
    nombre: texto(v.nombre, ''),
    descripcion: texto(v.descripcion, ''),
    peso: texto(v.peso, ''),
    detallar: booleano(v.detallar, false),
    niveles: detalle,
  };
}

function preguntaValida(v: unknown, niveles: NivelForm[]): PreguntaForm | null {
  if (!esObjeto(v) || !TIPOS_VALIDOS.includes(v.tipo as TipoPregunta)) return null;
  const base = preguntaVacia(niveles);
  const opciones = Array.isArray(v.opcionesChoice)
    ? v.opcionesChoice
        .filter(esObjeto)
        .map((o, i) => ({ id: texto(o.id, String.fromCharCode(97 + i)), texto: texto(o.texto, ''), correcta: booleano(o.correcta, false) }))
    : base.opcionesChoice;
  const criterios = Array.isArray(v.criterios) ? v.criterios.map((c) => criterioValido(c, niveles)).filter((c): c is CriterioForm => c !== null) : base.criterios;
  const izq = listaDeTextos(v.paresIzquierda, base.paresIzquierda);
  const der = listaDeTextos(v.paresDerecha, base.paresDerecha);
  const largo = Math.max(izq.length, der.length, 2);
  return {
    tipo: v.tipo as TipoPregunta,
    enunciado: texto(v.enunciado, ''),
    puntajeMaximo: texto(v.puntajeMaximo, ''),
    criterios: criterios.length > 0 || TIPOS_AUTOCORREGIBLES.includes(v.tipo as TipoPregunta) ? criterios : base.criterios,
    opcionesChoice: opciones.length > 0 ? opciones : base.opcionesChoice,
    vfCorrecta: v.vfCorrecta === 'false' ? 'false' : 'true',
    numRespuestaCorrecta: texto(v.numRespuestaCorrecta, ''),
    numTolerancia: texto(v.numTolerancia, '0'),
    paresIzquierda: Array.from({ length: largo }, (_, i) => izq[i] ?? ''),
    paresDerecha: Array.from({ length: largo }, (_, i) => der[i] ?? ''),
    plegada: booleano(v.plegada, false),
  };
}

/** Lee y valida un borrador guardado. null si no hay, no se puede interpretar, es de otra versión o no tiene nada rescatable. */
export function leerBorrador(crudo: string | null | undefined): Borrador | null {
  if (!crudo) return null;
  let v: unknown;
  try {
    v = JSON.parse(crudo);
  } catch {
    return null;
  }
  if (!esObjeto(v) || v.version !== VERSION_BORRADOR || !esObjeto(v.datos) || !Array.isArray(v.preguntas)) return null;

  const d = v.datos;
  const defecto = datosPorDefecto();
  const niveles = nivelesValidos(d.niveles) ?? nivelesPorDefecto();
  const datos: DatosForm = {
    cursoElegido: texto(d.cursoElegido, defecto.cursoElegido),
    cursoNuevoNombre: texto(d.cursoNuevoNombre, ''),
    titulo: texto(d.titulo, ''),
    consigna: texto(d.consigna, ''),
    modalidad: d.modalidad === 'sesion_tiempo' ? 'sesion_tiempo' : 'ventana_dias',
    duracionMinutos: texto(d.duracionMinutos, defecto.duracionMinutos),
    escalaMin: texto(d.escalaMin, defecto.escalaMin),
    escalaMax: texto(d.escalaMax, defecto.escalaMax),
    feedbackModo: d.feedbackModo === 'inmediato' ? 'inmediato' : 'manual',
    antiCheatOn: booleano(d.antiCheatOn, false),
    acPantalla: booleano(d.acPantalla, defecto.acPantalla),
    acPestana: booleano(d.acPestana, defecto.acPestana),
    acPegado: booleano(d.acPegado, defecto.acPegado),
    distOn: booleano(d.distOn, false),
    umbralAprobacion: texto(d.umbralAprobacion, defecto.umbralAprobacion),
    aprobadosPct: texto(d.aprobadosPct, defecto.aprobadosPct),
    niveles,
  };
  const preguntas = v.preguntas
    .slice(0, MAX_PREGUNTAS)
    .map((p) => preguntaValida(p, niveles))
    .filter((p): p is PreguntaForm => p !== null);
  return {
    version: VERSION_BORRADOR,
    guardadoEn: typeof v.guardadoEn === 'number' && Number.isFinite(v.guardadoEn) ? v.guardadoEn : 0,
    datos,
    preguntas: preguntas.length > 0 ? preguntas : [preguntaVacia(niveles)],
  };
}

/** ¿Hay algo escrito que valga la pena guardar? (un formulario recién abierto no se guarda ni pisa un borrador anterior). */
export function borradorTieneContenido(datos: DatosForm, preguntas: PreguntaForm[]): boolean {
  if (datos.titulo.trim() || datos.consigna.trim() || datos.cursoNuevoNombre.trim()) return true;
  return preguntas.some(
    (q) =>
      q.enunciado.trim() !== '' ||
      q.opcionesChoice.some((o) => o.texto.trim()) ||
      q.criterios.some((c) => c.nombre.trim() || c.descripcion.trim()) ||
      q.paresIzquierda.some((x) => x.trim()) ||
      q.paresDerecha.some((x) => x.trim()),
  );
}

/** "hace un momento", "hace 5 min", "hace 2 h", "hace 3 días". */
export function haceCuanto(guardadoEn: number, ahora: number = Date.now()): string {
  const ms = Math.max(0, ahora - guardadoEn);
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}
