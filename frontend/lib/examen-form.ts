// Formulario del wizard de "Nuevo examen": tipos, funciones puras de armado (opciones, puntos, payload, validación) y el
// mapeo inverso desde un examen ya creado (para duplicarlo). Sin React ni estado: todo lo que se pueda probar suelto va acá.
//
// Modelo de puntos: TODA pregunta (cerrada o abierta) tiene sus propios puntos en `PreguntaForm.puntajeMaximo`. En una
// pregunta abierta esos puntos se reparten entre los criterios de la rúbrica según su `peso` relativo (`puntosPorCriterio`).

import { ApiError, TIPOS_AUTOCORREGIBLES } from './api';
import type { AntiCheatConfig, CriterioSugerido, Examen, FeedbackModo, MatrizRubrica, ModalidadExamen, NivelDescripcion, Pregunta, TipoPregunta } from './api';

export const esNumero = (v: string) => v.trim() !== '' && Number.isFinite(Number(v));

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

// ---------------------------------------------------------------- datos del examen (paso 1)

/** Todo lo que se carga en el paso "Datos": se guarda junto (un solo objeto) para poder serializar el formulario entero. */
export interface DatosForm {
  /** '' (sin elegir) | id de un curso | 'nuevo' (se crea con `cursoNuevoNombre`). */
  cursoElegido: string;
  cursoNuevoNombre: string;
  titulo: string;
  consigna: string;
  modalidad: ModalidadExamen;
  duracionMinutos: string;
  escalaMin: string;
  escalaMax: string;
  feedbackModo: FeedbackModo;
  antiCheatOn: boolean;
  acPantalla: boolean;
  acPestana: boolean;
  acPegado: boolean;
  /** Distribución esperada de aprobados (opcional, en "Opciones avanzadas"). */
  distOn: boolean;
  umbralAprobacion: string;
  aprobadosPct: string;
  niveles: NivelForm[];
}

export function datosPorDefecto(): DatosForm {
  return {
    cursoElegido: '',
    cursoNuevoNombre: '',
    titulo: '',
    consigna: '',
    modalidad: 'ventana_dias',
    duracionMinutos: '60',
    escalaMin: '0',
    escalaMax: '10',
    feedbackModo: 'manual',
    antiCheatOn: false,
    acPantalla: true,
    acPestana: true,
    acPegado: true,
    distOn: false,
    umbralAprobacion: '6',
    aprobadosPct: '60',
    niveles: nivelesPorDefecto(),
  };
}

// Un criterio es una fila como en los trabajos prácticos: qué se evalúa, qué se espera y cuánto pesa dentro de la pregunta.
// Describir cada uno de los niveles de la escala es opcional (el editor lo muestra plegado).
export interface CriterioForm {
  matrizOrigenId?: string;
  nombre: string;
  descripcion: string;
  /** Peso relativo (> 0): los puntos de la pregunta se reparten entre sus criterios en proporción a este número. */
  peso: string;
  /** true si TODOS los niveles del criterio tienen descripción (vengan de una matriz, de la IA o escritos a mano). */
  detallar: boolean;
  niveles: { orden: number; nombre: string; descripcion: string }[];
}

export function criterioVacio(niveles: NivelForm[]): CriterioForm {
  return {
    nombre: '',
    descripcion: '',
    peso: '',
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
  /** Puntos de la pregunta, para TODOS los tipos (en las abiertas se reparten entre los criterios según su peso). */
  puntajeMaximo: string;
  criterios: CriterioForm[];
  opcionesChoice: OpcionChoiceForm[];
  vfCorrecta: 'true' | 'false';
  numRespuestaCorrecta: string;
  numTolerancia: string;
  paresIzquierda: string[];
  paresDerecha: string[];
  /** Solo de interfaz (tarjeta plegada): no se manda al backend. */
  plegada: boolean;
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
    plegada: false,
  };
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

/** Lo que vale la pregunta en el total: sus puntos (`puntajeMaximo`) si son válidos (> 0), para todos los tipos. */
export function puntajeEfectivoDe(p: PreguntaForm): number {
  const n = Number(p.puntajeMaximo);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Peso válido de un criterio (> 0); vacío o inválido cuenta como 0: ni suma ni recibe puntos. */
export function pesoValidoDe(c: CriterioForm): number {
  const n = Number(c.peso);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Reparte los puntos de una pregunta abierta entre sus criterios según su peso (`P * peso_i / Σpesos`), a 2 decimales. El
 * redondeo se corrige en el último criterio con peso válido para que la suma sea EXACTAMENTE P redondeado a 2 decimales
 * (P = 10 con tres pesos iguales → 3,33 + 3,33 + 3,34): el servidor exige que P coincida con la suma de sus criterios.
 * Devuelve un número por criterio, en el mismo orden; sin P válido o sin ningún peso válido, todo en 0. Ningún criterio es
 * negativo: si P es tan chico que los demás ya se llevaron más de lo que hay (0,04 entre 7 criterios), el último queda en 0 y
 * la suma deja de dar P; `validarPregunta` lo avisa ("los puntos son muy pocos") y la pregunta no se manda así.
 */
export function puntosPorCriterio(p: PreguntaForm): number[] {
  const pesos = p.criterios.map(pesoValidoDe);
  const puntos = pesos.map(() => 0);
  const total = puntajeEfectivoDe(p);
  const sumaPesos = pesos.reduce((s, w) => s + w, 0);
  if (total <= 0 || sumaPesos <= 0) return puntos;

  let ultimo = -1;
  pesos.forEach((w, i) => {
    if (w <= 0) return;
    puntos[i] = redondearPuntos((total * w) / sumaPesos);
    ultimo = i;
  });
  const resto = puntos.reduce((s, x, i) => (i === ultimo ? s : s + x), 0);
  puntos[ultimo] = Math.max(0, redondearPuntos(redondearPuntos(total) - resto));
  return puntos;
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

// ---------------------------------------------------------------- payload y validación de una pregunta

/** Una pregunta tal como la recibe `createExamen`. */
export interface PreguntaPayload {
  tipo: TipoPregunta;
  enunciado: string;
  puntajeMaximo: number;
  opciones?: unknown;
  criterios?: {
    matrizOrigenId?: string;
    nombre: string;
    descripcion: string;
    puntajeMaximo: number;
    nivelesDescripcion?: { orden: number; nombre: string; descripcion: string }[];
  }[];
}

/**
 * Pregunta del formulario -> lo que se manda al backend. En las abiertas, `puntajeMaximo` es P y cada criterio lleva los
 * puntos que le tocan según su peso (`puntosPorCriterio`); los criterios incompletos (sin nombre o sin peso) no se mandan y
 * el reparto se calcula solo sobre los que se mandan, así la suma siempre da P.
 */
export function construirPregunta(p: PreguntaForm): PreguntaPayload {
  const cerrada = TIPOS_AUTOCORREGIBLES.includes(p.tipo);
  const base = { tipo: p.tipo, enunciado: p.enunciado.trim(), puntajeMaximo: Number(p.puntajeMaximo) };
  if (cerrada) return { ...base, opciones: construirOpciones(p) };

  const enviados = p.criterios.filter((c) => c.nombre.trim() && pesoValidoDe(c) > 0);
  const puntos = puntosPorCriterio({ ...p, criterios: enviados });
  return {
    ...base,
    criterios: enviados.map((c, i) => ({
      matrizOrigenId: c.matrizOrigenId,
      nombre: c.nombre.trim(),
      descripcion: c.descripcion.trim(),
      puntajeMaximo: puntos[i],
      // Solo si el docente describió los 5 niveles.
      nivelesDescripcion: c.niveles.every((nv) => nv.descripcion.trim()) ? c.niveles : undefined,
    })),
  };
}

/** Errores de una pregunta, con mensajes concretos ("Pregunta 2: ..."). `indice` es la posición base 0. */
export function validarPregunta(q: PreguntaForm, indice: number): string[] {
  const e: string[] = [];
  const n = `Pregunta ${indice + 1}`;
  if (!q.enunciado.trim()) e.push(`${n}: falta el enunciado.`);
  if (TIPOS_AUTOCORREGIBLES.includes(q.tipo)) {
    if (!(Number(q.puntajeMaximo) > 0)) e.push(`${n}: falta el puntaje máximo.`);
    if (q.tipo === 'opcion_multiple' || q.tipo === 'casillas') {
      const llenas = q.opcionesChoice.filter((o) => o.texto.trim());
      if (llenas.length < 2) e.push(`${n}: cargá al menos 2 opciones con texto.`);
      else if (!llenas.some((o) => o.correcta)) e.push(`${n}: marcá cuál es la opción correcta${q.tipo === 'casillas' ? ' (o cuáles)' : ''}.`);
    }
    if (q.tipo === 'numerica') {
      if (!esNumero(q.numRespuestaCorrecta)) e.push(`${n}: falta la respuesta correcta (un número).`);
      if (q.numTolerancia.trim() !== '' && !(Number(q.numTolerancia) >= 0)) e.push(`${n}: la tolerancia tiene que ser 0 o más.`);
    }
    if (q.tipo === 'relacionar_pares') {
      const incompletos = q.paresIzquierda.some((izq, k) => !izq.trim() || !(q.paresDerecha[k] ?? '').trim());
      if (q.paresIzquierda.length < 2 || incompletos) e.push(`${n}: completá los dos lados de cada par (mínimo 2 pares).`);
    }
    return e;
  }

  if (!(Number(q.puntajeMaximo) > 0)) e.push(`${n}: falta el puntaje de la pregunta.`);
  const completos = q.criterios.filter((c) => c.nombre.trim() && Number(c.peso) > 0);
  if (completos.length === 0) e.push(`${n}: agregá al menos un criterio con su nombre y su peso.`);
  q.criterios.forEach((c, k) => {
    const algo = c.nombre.trim() || c.descripcion.trim() || c.peso.trim();
    if (!algo) return;
    const cn = `${n}, criterio ${k + 1}`;
    if (!c.nombre.trim()) e.push(`${cn}: falta el nombre.`);
    if (!(Number(c.peso) > 0)) e.push(`${cn}: falta el peso.`);
    if (!c.descripcion.trim()) e.push(`${cn}: falta qué se espera para cumplirlo.`);
    // El detalle por nivel es todo o nada (aunque el editor lo tenga plegado): a medias no se manda.
    if (estadoDetalle(c).incompleto) e.push(`${cn}: describí los ${c.niveles.length} niveles o dejá el detalle vacío.`);
  });
  // Con puntos muy chicos para tantos criterios, alguno se redondea a 0 y no valdría nada (el reparto es a 2 decimales).
  const enviados = q.criterios.filter((c) => c.nombre.trim() && pesoValidoDe(c) > 0);
  if (puntajeEfectivoDe(q) > 0 && enviados.length > 0 && puntosPorCriterio({ ...q, criterios: enviados }).some((x) => x <= 0)) {
    e.push(`${n}: los puntos son muy pocos para repartirlos entre ${enviados.length} criterios.`);
  }
  return e;
}

/**
 * Usa una matriz de rúbrica como criterios de la pregunta. Los puntos de cada criterio de la matriz pasan a leerse como
 * PESO relativo. Si la pregunta todavía no tiene puntos propios toma la suma de la matriz (como antes); si ya los tiene, los
 * respeta y los criterios se reescalan solos.
 *
 * El detalle por nivel de la matriz es opcional (puede traer `nivelesDescripcion: []`): `detallar` es true solo si trae la
 * descripción de TODOS los niveles; si no, los niveles del criterio quedan vacíos y `detallar` en false. Con `nivelesExamen`
 * (la escala del examen), además, la cantidad de descripciones tiene que ser igual a la de niveles del examen: si coincide se
 * usan con los NOMBRES de nivel del examen; si no, se aplican los criterios sin detalle. Sin `nivelesExamen` se toman los
 * niveles de la matriz tal cual.
 */
export function aplicarMatriz(p: PreguntaForm, matriz: MatrizRubrica, nivelesExamen?: NivelForm[]): PreguntaForm {
  const criterios = matriz.criterios.map((c): CriterioForm => {
    const detalle = [...(Array.isArray(c.nivelesDescripcion) ? c.nivelesDescripcion : [])].sort((a, b) => a.orden - b.orden);
    const completo =
      detalle.length > 0 &&
      detalle.every((nv) => typeof nv.descripcion === 'string' && nv.descripcion.trim() !== '') &&
      (nivelesExamen === undefined || detalle.length === nivelesExamen.length);
    const niveles = completo
      ? detalle.map((nv, i) => ({
          orden: nivelesExamen ? nivelesExamen[i].orden : nv.orden,
          nombre: nivelesExamen ? nivelesExamen[i].nombre : nv.nombre,
          descripcion: nv.descripcion,
        }))
      : criterioVacio(nivelesExamen ?? nivelesPorDefecto()).niveles;
    return {
      matrizOrigenId: matriz.id,
      nombre: c.nombre,
      descripcion: c.descripcion,
      peso: numAString(c.puntajeMaximo),
      detallar: completo,
      niveles,
    };
  });
  const suma = criterios.reduce((s, c) => s + Number(c.peso), 0);
  const sinPuntos = !(Number(p.puntajeMaximo) > 0);
  return { ...p, criterios, puntajeMaximo: sinPuntos ? String(redondearPuntos(suma)) : p.puntajeMaximo };
}

// ---------------------------------------------------------------- rúbrica de una pregunta: detalle por nivel, matrices e IA

/** Estado del detalle por nivel de un criterio: cuántos niveles tienen descripción y si está vacío, completo o a medias. */
export function estadoDetalle(c: CriterioForm): { descritos: number; total: number; vacio: boolean; completo: boolean; incompleto: boolean } {
  const total = c.niveles.length;
  const descritos = c.niveles.filter((nv) => nv.descripcion.trim()).length;
  return { descritos, total, vacio: descritos === 0, completo: total > 0 && descritos === total, incompleto: descritos > 0 && descritos < total };
}

/** Resumen del detalle para el acordeón: "sin detallar", "5 niveles descritos ✓" o "3 de 5 niveles descritos" (este, en rojo). */
export function resumenDetalle(c: CriterioForm): { texto: string; incompleto: boolean } {
  const d = estadoDetalle(c);
  if (d.vacio) return { texto: 'sin detallar', incompleto: false };
  if (d.completo) return { texto: `${d.total} ${d.total === 1 ? 'nivel descrito' : 'niveles descritos'} ✓`, incompleto: false };
  return { texto: `${d.descritos} de ${d.total} niveles descritos`, incompleto: true };
}

/** true si la pregunta ya tiene algo cargado en sus criterios (para avisar antes de reemplazarlos con una sugerencia). */
export function tieneCriteriosCargados(p: PreguntaForm): boolean {
  return p.criterios.some((c) => c.nombre.trim() || c.descripcion.trim() || c.peso.trim() || c.niveles.some((nv) => nv.descripcion.trim()));
}

/** Cantidad de niveles que el servidor exige en una matriz cuando se manda el detalle por nivel. */
export const NIVELES_POR_MATRIZ = 5;

/** Menor peso que acepta el servidor en un criterio de matriz. */
const PESO_MINIMO_MATRIZ = 0.01;

/** Un criterio tal como lo recibe `createMatrizRubrica`; el peso del formulario viaja como `puntajeMaximo`. */
export interface CriterioMatrizPayload {
  nombre: string;
  descripcion: string;
  puntajeMaximo: number;
  nivelesDescripcion?: NivelDescripcion[];
}

/**
 * Criterios de la pregunta listos para guardarlos como matriz de rúbrica, o [] si todavía no se puede: no hay ninguno o alguno
 * está a medias (nombre, qué se espera y un peso de al menos 0,01 son obligatorios; las filas totalmente en blanco se saltean).
 * `nivelesDescripcion` solo va si TODOS los criterios tienen todos sus niveles descritos, son tantos como la escala del examen
 * (`nivelesExamen`) y son los 5 que acepta el servidor; si no, se omite en todos (la matriz se guarda sin detalle).
 */
export function criteriosParaMatriz(p: PreguntaForm, nivelesExamen?: NivelForm[]): CriterioMatrizPayload[] {
  const cargados = p.criterios.filter((c) => c.nombre.trim() || c.descripcion.trim() || c.peso.trim());
  const listo = (c: CriterioForm) => c.nombre.trim() && c.descripcion.trim() && Number.isFinite(Number(c.peso)) && Number(c.peso) >= PESO_MINIMO_MATRIZ;
  if (cargados.length === 0 || !cargados.every(listo)) return [];

  const escala = nivelesExamen ? nivelesExamen.length : NIVELES_POR_MATRIZ;
  const conDetalle = cargados.every((c) => c.niveles.length === escala && c.niveles.length === NIVELES_POR_MATRIZ && estadoDetalle(c).completo);
  return cargados.map((c) => ({
    nombre: c.nombre.trim(),
    descripcion: c.descripcion.trim(),
    puntajeMaximo: Number(c.peso),
    ...(conDetalle ? { nivelesDescripcion: c.niveles.map((nv) => ({ orden: nv.orden, nombre: nv.nombre, descripcion: nv.descripcion.trim() })) } : {}),
  }));
}

/**
 * Sugerencia de la IA -> criterios del formulario. El peso (entero, suman 100) pasa a string; los puntos no se tocan: salen de
 * los puntos de la pregunta y del peso, como siempre. El detalle por nivel se usa solo si la cantidad de descripciones coincide
 * con la escala del examen (`niveles`): ahí `detallar` queda en true y los niveles llevan los nombres del examen; si no, los
 * criterios quedan sin detalle.
 */
export function criteriosDeSugerencia(sugeridos: CriterioSugerido[], niveles: NivelForm[]): CriterioForm[] {
  return sugeridos.map((c): CriterioForm => {
    const detalle = Array.isArray(c.niveles) ? c.niveles : [];
    const completo = detalle.length === niveles.length && detalle.length > 0 && detalle.every((d) => typeof d === 'string' && d.trim() !== '');
    return {
      nombre: c.nombre,
      descripcion: c.descripcion,
      peso: numAString(c.peso),
      detallar: completo,
      niveles: niveles.map((n, i) => ({ orden: n.orden, nombre: n.nombre, descripcion: completo ? detalle[i].trim() : '' })),
    };
  });
}

/** Pesos -> porcentaje de cada uno sobre el total (números o strings; los inválidos o <= 0 valen 0 %). Sin total válido, todo en 0. */
export function pesosEnPorcentaje(pesos: (string | number)[]): number[] {
  const validos = pesos.map((w) => (Number.isFinite(Number(w)) && Number(w) > 0 ? Number(w) : 0));
  const total = validos.reduce((s, w) => s + w, 0);
  return validos.map((w) => (total > 0 ? (w * 100) / total : 0));
}

/** Mensaje en castellano para un fallo de "Sugerir criterios con IA" (nunca el JSON crudo del servidor). */
export function mensajeErrorSugerencia(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'Pediste demasiadas sugerencias en poco tiempo (el límite es de 20 por minuto). Esperá un momento y probá de nuevo.';
    if (err.status === 401) return 'Tu sesión venció. Volvé a iniciar sesión y probá de nuevo.';
    if (err.status === 400) return 'No se pudo pedir la sugerencia: revisá que el enunciado no sea demasiado largo (máximo 5000 caracteres).';
    return 'La IA no pudo armar una sugerencia en este momento. Probá de nuevo en unos minutos o cargá los criterios a mano.';
  }
  return 'No pudimos conectarnos con el servidor. Revisá tu conexión y probá de nuevo.';
}

/** Mensaje en castellano para un fallo al guardar una matriz; suma el detalle que informa el servidor (si lo hay). */
export function mensajeErrorMatriz(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Tu sesión venció. Volvé a iniciar sesión y probá de nuevo.';
    if (err.status >= 500) return 'No se pudo guardar la matriz por un problema del servidor. Probá de nuevo en un momento.';
    const detalle = mensajesDelServidor(err).slice(0, 3).join('; ');
    return `No se pudo guardar la matriz. Revisá los datos y probá de nuevo.${detalle ? ` Detalle: ${detalle}` : ''}`;
  }
  return 'No pudimos conectarnos con el servidor. Revisá tu conexión y probá de nuevo.';
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

/** Errores de la distribución esperada (solo si se activó); dependen de la escala del examen. */
export function validarDistribucion(d: DatosForm): string[] {
  const e: string[] = [];
  if (!d.distOn) return e;
  if (!esNumero(d.umbralAprobacion) || Number(d.umbralAprobacion) < Number(d.escalaMin) || Number(d.umbralAprobacion) > Number(d.escalaMax)) {
    e.push(`La nota de aprobación tiene que estar entre ${d.escalaMin} y ${d.escalaMax} (la escala del examen).`);
  }
  if (!esNumero(d.aprobadosPct) || Number(d.aprobadosPct) < 0 || Number(d.aprobadosPct) > 100) e.push('El porcentaje de aprobados esperado tiene que estar entre 0 y 100.');
  return e;
}

/** Errores del paso "Datos" (incluye la escala de niveles y la distribución esperada, que viven en "Opciones avanzadas"). */
export function validarDatos(d: DatosForm): string[] {
  const e: string[] = [];
  if (!d.titulo.trim()) e.push('Falta el título del examen.');
  if (!d.consigna.trim()) e.push('Falta la consigna o las instrucciones generales.');
  if (d.cursoElegido === 'nuevo' ? !d.cursoNuevoNombre.trim() : !d.cursoElegido) {
    e.push(d.cursoElegido === 'nuevo' ? 'Falta el nombre del curso nuevo.' : 'Elegí un curso.');
  }
  if (!esNumero(d.escalaMin) || !esNumero(d.escalaMax)) e.push('La escala necesita un mínimo y un máximo numéricos.');
  else if (Number(d.escalaMin) >= Number(d.escalaMax)) e.push('La escala mínima tiene que ser menor que la máxima.');
  if (d.modalidad === 'sesion_tiempo' && !(Number(d.duracionMinutos) >= 1)) e.push('La duración tiene que ser de al menos 1 minuto.');
  e.push(...validarNiveles(d.niveles), ...validarDistribucion(d));
  return e;
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
        peso: numAString(c.puntajeMaximo), // en el modelo viejo cada criterio valía puntos: pasan a ser el peso (mismo reparto)
        detallar: detallado,
        niveles: detallado
          ? nd.map((n) => ({ orden: n.orden, nombre: n.nombre, descripcion: n.descripcion }))
          : niveles.map((n) => ({ orden: n.orden, nombre: n.nombre, descripcion: '' })),
      };
    });
  // Puntos de la pregunta: los suyos o, si no los hubiera, la suma de sus criterios.
  const suma = redondearPuntos(criterios.reduce((s, c) => s + (Number(c.peso) || 0), 0));
  const puntajeMaximo = Number(q.puntajeMaximo) > 0 ? numAString(q.puntajeMaximo) : suma > 0 ? String(suma) : '';
  return criterios.length > 0 ? { ...base, puntajeMaximo, criterios } : { ...base, puntajeMaximo };
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

// ---------------------------------------------------------------- paso "Publicar": lista de alumnos y errores del servidor

/** "Nombre, email" por línea (o solo el email); acepta lo pegado desde una planilla (tabs, comas o punto y coma). */
export function parsearAlumnos(texto: string): { alumnos: { nombre: string; email: string }[]; errores: string[] } {
  const alumnos: { nombre: string; email: string }[] = [];
  const errores: string[] = [];
  const vistos = new Set<string>();
  texto.split(/\r?\n/).forEach((linea, i) => {
    if (!linea.trim()) return;
    const partes = linea.split(/[\t,;]+/).map((x) => x.trim()).filter(Boolean);
    const email = (partes.find((x) => x.includes('@')) ?? '').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errores.push(`Línea ${i + 1}: no encontré un email válido ("${linea.trim().slice(0, 40)}").`);
      return;
    }
    if (vistos.has(email)) {
      errores.push(`Línea ${i + 1}: el email ${email} está repetido.`);
      return;
    }
    vistos.add(email);
    const nombre = partes.filter((x) => !x.includes('@')).join(' ') || email.split('@')[0];
    alumnos.push({ nombre, email });
  });
  return { alumnos, errores };
}

/** Mensajes de validación del servidor (class-validator devuelve una lista), si los hay. */
export function mensajesDelServidor(err: unknown): string[] {
  if (err instanceof ApiError) {
    try {
      const m = JSON.parse(err.body).message;
      if (Array.isArray(m)) return m.map(String);
      if (typeof m === 'string') return [m];
    } catch {
      /* cuerpo no JSON */
    }
  }
  return [];
}
