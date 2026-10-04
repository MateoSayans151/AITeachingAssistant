// Formulario del wizard de "Nuevo examen": tipos, funciones puras de armado (opciones, total de puntos) y el mapeo
// inverso desde un examen ya creado (para duplicarlo). Sin React ni estado: todo lo que se pueda probar suelto va acá.

import { TIPOS_AUTOCORREGIBLES } from './api';
import type { AntiCheatConfig, Examen, FeedbackModo, ModalidadExamen, Pregunta, TipoPregunta } from './api';

export interface NivelForm {
  orden: number;
  nombre: string;
  colorHex: string;
  porcentaje: string;
}

export function nivelesPorDefecto(): NivelForm[] {
  return [
    { orden: 1, nombre: 'Insuficiente', colorHex: '#c0392b', porcentaje: '0' },
    { orden: 2, nombre: 'Básico', colorHex: '#c8511b', porcentaje: '25' },
    { orden: 3, nombre: 'Intermedio', colorHex: '#c9a227', porcentaje: '50' },
    { orden: 4, nombre: 'Avanzado', colorHex: '#3b4fb0', porcentaje: '75' },
    { orden: 5, nombre: 'Excelente', colorHex: '#1a7f4e', porcentaje: '100' },
  ];
}

// Un criterio es una fila como en los trabajos prácticos: qué se evalúa, qué se espera y cuántos puntos vale.
// Describir cada uno de los 5 niveles es opcional (se abre a pedido).
export interface CriterioForm {
  matrizOrigenId?: string;
  nombre: string;
  descripcion: string;
  puntajeMaximo: string;
  detallar: boolean;
  niveles: { orden: number; nombre: string; descripcion: string }[];
}

export function criterioVacio(niveles: NivelForm[]): CriterioForm {
  return {
    nombre: '',
    descripcion: '',
    puntajeMaximo: '',
    detallar: false,
    niveles: niveles.map((n) => ({ orden: n.orden, nombre: n.nombre, descripcion: '' })),
  };
}

export interface OpcionChoiceForm {
  id: string;
  texto: string;
  correcta: boolean;
}

export interface PreguntaForm {
  tipo: TipoPregunta;
  enunciado: string;
  puntajeMaximo: string;
  criterios: CriterioForm[];
  opcionesChoice: OpcionChoiceForm[];
  vfCorrecta: 'true' | 'false';
  numRespuestaCorrecta: string;
  numTolerancia: string;
  paresIzquierda: string[];
  paresDerecha: string[];
}

export function preguntaVacia(niveles: NivelForm[]): PreguntaForm {
  return {
    tipo: 'desarrollo',
    enunciado: '',
    puntajeMaximo: '',
    criterios: [criterioVacio(niveles)],
    opcionesChoice: [
      { id: 'a', texto: '', correcta: true },
      { id: 'b', texto: '', correcta: false },
    ],
    vfCorrecta: 'true',
    numRespuestaCorrecta: '',
    numTolerancia: '0',
    paresIzquierda: ['', ''],
    paresDerecha: ['', ''],
  };
}

/** Suma de puntos de los criterios completos de una pregunta abierta. */
export function puntajeDeCriterios(p: PreguntaForm): number {
  return p.criterios.filter((c) => c.nombre.trim() && Number(c.puntajeMaximo) > 0).reduce((s, c) => s + Number(c.puntajeMaximo), 0);
}

/** Lo que se manda como `opciones` de una pregunta cerrada (las abiertas no llevan). */
export function construirOpciones(p: PreguntaForm): unknown {
  switch (p.tipo) {
    case 'opcion_multiple':
    case 'casillas':
      return p.opcionesChoice.filter((o) => o.texto.trim()).map((o) => ({ id: o.id, texto: o.texto, correcta: o.correcta }));
    case 'verdadero_falso':
      return { correcta: p.vfCorrecta === 'true' };
    case 'numerica':
      return { respuestaCorrecta: Number(p.numRespuestaCorrecta), tolerancia: Number(p.numTolerancia || 0) };
    case 'relacionar_pares':
      return {
        izquierda: p.paresIzquierda,
        derecha: p.paresDerecha,
        paresCorrectos: p.paresIzquierda.map((izq, i) => [izq, p.paresDerecha[i]]),
      };
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------- total de puntos

/** Redondea a 2 decimales para no mostrar ni comparar ruido de coma flotante (0,1 + 0,2 = 0,30000000000000004). */
export function redondearPuntos(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Puntos para mostrar: máximo 2 decimales, con coma ("7,5"), sin ceros de más. */
export function formatearPuntos(n: number): string {
  return String(redondearPuntos(n)).replace('.', ',');
}

/** Lo que vale la pregunta en el total: cerradas, su puntaje máximo; abiertas, la suma de sus criterios completos. */
export function puntajeEfectivoDe(p: PreguntaForm): number {
  if (TIPOS_AUTOCORREGIBLES.includes(p.tipo)) {
    const n = Number(p.puntajeMaximo);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  return puntajeDeCriterios(p);
}

/** Suma de los puntos de todas las preguntas (es la nota máxima alcanzable: la escala no se normaliza). */
export function totalDelExamen(preguntas: PreguntaForm[]): number {
  return redondearPuntos(preguntas.reduce((s, p) => s + puntajeEfectivoDe(p), 0));
}

/** Tolerancia con la que el total tiene que coincidir con la escala máxima (la misma que aplica el servidor). */
export const TOLERANCIA_TOTAL = 0.01;

export function totalCoincideConEscala(total: number, escalaMax: number): boolean {
  return Math.abs(redondearPuntos(total) - redondearPuntos(escalaMax)) <= TOLERANCIA_TOTAL + 1e-9;
}

// ---------------------------------------------------------------- niveles de desempeño: presets, validación y ejemplo

/** Reparto del puntaje de un criterio entre los 5 niveles: la "exigencia" de la corrección. */
export interface PresetNiveles {
  id: string;
  nombre: string;
  porcentajes: number[];
}

export const PRESETS_NIVELES: PresetNiveles[] = [
  { id: 'estandar', nombre: 'Estándar', porcentajes: [0, 25, 50, 75, 100] },
  { id: 'exigente', nombre: 'Exigente', porcentajes: [0, 10, 30, 60, 100] },
  { id: 'flexible', nombre: 'Flexible', porcentajes: [0, 35, 60, 85, 100] },
];

/** Id del preset que coincide exactamente con los porcentajes de los niveles, o 'personalizado'. */
export function presetDe(niveles: NivelForm[]): string {
  const valores = niveles.map((n) => Number(n.porcentaje));
  const preset = PRESETS_NIVELES.find((p) => p.porcentajes.length === valores.length && p.porcentajes.every((x, i) => x === valores[i]));
  return preset ? preset.id : 'personalizado';
}

/** Aplica los porcentajes de un preset conservando los nombres (y colores) que ya tengan los niveles. */
export function aplicarPreset(niveles: NivelForm[], id: string): NivelForm[] {
  const preset = PRESETS_NIVELES.find((p) => p.id === id);
  if (!preset) return niveles;
  return niveles.map((n, i) => ({ ...n, porcentaje: String(preset.porcentajes[i] ?? n.porcentaje) }));
}

/**
 * Reglas de la escala de niveles. Además de nombre y rango 0-100: el primer nivel vale 0 % (lo que recibe una respuesta que no
 * cumple), el último 100 % (si no, nadie podría sacar el puntaje completo y el total del examen no se alcanzaría nunca) y los
 * porcentajes crecen de un nivel al siguiente (si no, la escala no tiene sentido para quien corrige).
 */
export function validarNiveles(niveles: NivelForm[]): string[] {
  const e: string[] = [];
  niveles.forEach((n) => {
    if (!n.nombre.trim()) e.push(`El nivel ${n.orden} necesita un nombre.`);
    const p = Number(n.porcentaje);
    if (n.porcentaje.trim() === '' || !Number.isFinite(p) || p < 0 || p > 100) {
      e.push(`El nivel ${n.orden} (${n.nombre || 'sin nombre'}) necesita un porcentaje entre 0 y 100.`);
    }
  });
  if (e.length > 0 || niveles.length === 0) return e;

  const valores = niveles.map((n) => Number(n.porcentaje));
  const primero = niveles[0];
  const ultimo = niveles[niveles.length - 1];
  if (valores[0] !== 0) e.push(`El primer nivel (${primero.nombre}) tiene que valer 0 %: es lo que recibe una respuesta que no cumple el criterio.`);
  if (valores[valores.length - 1] !== 100) {
    e.push(`El último nivel (${ultimo.nombre}) tiene que valer 100 %: si no, nadie podría sacar el puntaje completo.`);
  }
  for (let i = 1; i < valores.length; i += 1) {
    if (valores[i] <= valores[i - 1]) {
      e.push(
        `Los porcentajes tienen que ir creciendo de un nivel al siguiente: «${niveles[i - 1].nombre}» vale ${valores[i - 1]} % y «${niveles[i].nombre}» vale ${valores[i]} %.`,
      );
      break;
    }
  }
  return e;
}

/** Ejemplo para entender la escala: cuántos puntos da un nivel en un criterio de `puntosCriterio` (por defecto 2). */
export function puntosDeEjemplo(porcentaje: string, puntosCriterio = 2): number | null {
  const p = Number(porcentaje);
  if (porcentaje.trim() === '' || !Number.isFinite(p)) return null;
  return redondearPuntos((puntosCriterio * p) / 100);
}

/** Resumen corto de la escala para mostrar con el bloque plegado: "Estándar · 0 / 25 / 50 / 75 / 100 %". */
export function resumenNiveles(niveles: NivelForm[]): string {
  const id = presetDe(niveles);
  const nombre = id === 'personalizado' ? 'Personalizada' : (PRESETS_NIVELES.find((p) => p.id === id)?.nombre ?? '');
  return `${nombre} · ${niveles.map((n) => n.porcentaje.trim() || '?').join(' / ')} %`;
}

// ---------------------------------------------------------------- mapeo inverso: examen existente -> formulario

const CANT_NIVELES = 5;

export interface ExamenFormDatos {
  cursoId: string;
  titulo: string;
  consigna: string;
  modalidad: ModalidadExamen;
  /** null: el examen no tiene duración (el formulario conserva su valor por defecto). */
  duracionMinutos: string | null;
  escalaMin: string;
  escalaMax: string;
  feedbackModo: FeedbackModo;
  /** null: sin señales de integridad. */
  antiCheat: AntiCheatConfig | null;
  /** null: sin expectativa de aprobados. */
  distribucion: { umbralAprobacion: string; aprobadosPct: string } | null;
  niveles: NivelForm[];
  preguntas: PreguntaForm[];
}

/** Los Decimal de Prisma llegan como string ("10.00"): se normalizan a la forma en que el formulario guarda los números. */
function numAString(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : '';
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Mapeo inverso exacto de `construirOpciones`: vuelca las `opciones` guardadas en los campos de la pregunta del formulario. */
function aplicarOpciones(base: PreguntaForm, tipo: TipoPregunta, opciones: unknown): PreguntaForm {
  const p: PreguntaForm = { ...base };
  switch (tipo) {
    case 'opcion_multiple':
    case 'casillas':
      if (Array.isArray(opciones) && opciones.length > 0) {
        p.opcionesChoice = opciones.map((o, i) => {
          const op = esObjeto(o) ? o : {};
          return {
            id: typeof op.id === 'string' && op.id ? op.id : String.fromCharCode(97 + i),
            texto: typeof op.texto === 'string' ? op.texto : '',
            correcta: op.correcta === true,
          };
        });
      }
      break;
    case 'verdadero_falso':
      if (esObjeto(opciones)) p.vfCorrecta = opciones.correcta === false ? 'false' : 'true';
      break;
    case 'numerica':
      if (esObjeto(opciones)) {
        p.numRespuestaCorrecta = numAString(opciones.respuestaCorrecta);
        p.numTolerancia = numAString(opciones.tolerancia ?? 0) || '0';
      }
      break;
    case 'relacionar_pares':
      if (esObjeto(opciones) && Array.isArray(opciones.izquierda) && opciones.izquierda.length > 0) {
        const derecha = Array.isArray(opciones.derecha) ? opciones.derecha : [];
        const pares = Array.isArray(opciones.paresCorrectos) ? opciones.paresCorrectos : [];
        p.paresIzquierda = opciones.izquierda.map((x) => String(x ?? ''));
        // derecha[i] es el par de izquierda[i]; si faltara, se recurre a paresCorrectos[i] = [izquierda, derecha].
        p.paresDerecha = p.paresIzquierda.map((_, i) => {
          if (typeof derecha[i] === 'string') return derecha[i] as string;
          const par = pares[i];
          return Array.isArray(par) && typeof par[1] === 'string' ? par[1] : '';
        });
      }
      break;
    default:
      break;
  }
  return p;
}

function preguntaAFormulario(q: Pregunta, niveles: NivelForm[]): PreguntaForm {
  const base: PreguntaForm = { ...preguntaVacia(niveles), tipo: q.tipo, enunciado: q.enunciado };
  if (TIPOS_AUTOCORREGIBLES.includes(q.tipo)) {
    return aplicarOpciones({ ...base, puntajeMaximo: numAString(q.puntajeMaximo) }, q.tipo, q.opciones);
  }
  const criterios = [...(q.criterios ?? [])]
    .sort((a, b) => a.orden - b.orden)
    .map((c): CriterioForm => {
      const nd = [...(Array.isArray(c.nivelesDescripcion) ? c.nivelesDescripcion : [])].sort((a, b) => a.orden - b.orden);
      const detallado = nd.length === CANT_NIVELES && nd.every((n) => typeof n.descripcion === 'string' && n.descripcion.trim() !== '');
      return {
        matrizOrigenId: c.matrizOrigenId ?? undefined,
        nombre: c.nombre,
        descripcion: c.descripcion,
        puntajeMaximo: numAString(c.puntajeMaximo),
        detallar: detallado,
        niveles: detallado
          ? nd.map((n) => ({ orden: n.orden, nombre: n.nombre, descripcion: n.descripcion }))
          : niveles.map((n) => ({ orden: n.orden, nombre: n.nombre, descripcion: '' })),
      };
    });
  return criterios.length > 0 ? { ...base, criterios } : base;
}

/**
 * Datos del formulario a partir de un examen existente, para duplicarlo. Copia solo la definición del examen
 * (datos, escala, niveles, distribución esperada, anti-trampas y preguntas); no las comisiones, fechas, estado de
 * publicación, liberación de feedback ni respuestas. El título lleva el sufijo " (copia)".
 */
export function examenAFormulario(examen: Examen): ExamenFormDatos {
  const nivelesOrigen = [...(examen.niveles ?? [])].sort((a, b) => a.orden - b.orden);
  const niveles: NivelForm[] =
    nivelesOrigen.length > 0
      ? nivelesOrigen.map((n) => ({ orden: n.orden, nombre: n.nombre, colorHex: n.colorHex, porcentaje: numAString(n.porcentaje) }))
      : nivelesPorDefecto();
  const preguntasOrigen = [...(examen.preguntas ?? [])].sort((a, b) => a.orden - b.orden);
  return {
    cursoId: examen.cursoId,
    titulo: `${examen.titulo} (copia)`,
    consigna: examen.consigna,
    modalidad: examen.modalidad,
    duracionMinutos: examen.duracionMinutos != null ? numAString(examen.duracionMinutos) : null,
    escalaMin: numAString(examen.escalaMin),
    escalaMax: numAString(examen.escalaMax),
    feedbackModo: examen.feedbackModo,
    antiCheat: examen.antiCheat
      ? { pantallaCompleta: examen.antiCheat.pantallaCompleta, cambioPestana: examen.antiCheat.cambioPestana, pegado: examen.antiCheat.pegado }
      : null,
    distribucion: examen.distribucionEsperada
      ? {
          umbralAprobacion: numAString(examen.distribucionEsperada.umbralAprobacion),
          aprobadosPct: numAString(examen.distribucionEsperada.aprobadosEsperadosPct),
        }
      : null,
    niveles,
    preguntas: preguntasOrigen.length > 0 ? preguntasOrigen.map((q) => preguntaAFormulario(q, niveles)) : [preguntaVacia(niveles)],
  };
}
