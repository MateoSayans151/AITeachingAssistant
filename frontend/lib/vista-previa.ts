// Vista previa del examen tal como lo ve el alumno: funciones puras que convierten lo que el docente tiene cargado en el
// wizard de "Nuevo examen" (DatosForm / PreguntaForm) en lo que el servidor le entregaría a un alumno. Sin React ni estado.
//
// La regla de oro: la vista previa NUNCA recibe la clave de respuesta. `preguntasParaAlumno` devuelve exactamente la forma
// de `PreguntaRendir` (id, tipo, enunciado, puntajeMaximo, opciones) con las `opciones` saneadas igual que
// `sanitizarOpcionesParaAlumno` del backend (backend/src/respuestas-examen/correccion-cerradas.util.ts): sin `correcta`,
// `respuestaCorrecta`, `tolerancia` ni `paresCorrectos`. Un test (backend/test/vista-previa.test.ts) compara ambas salidas.
//
// Orden de las opciones: las de opción múltiple / casillas se entregan en el orden en que se cargaron; la columna derecha de
// "relacionar pares" la MEZCLA el servidor (si no, la posición delataba la pareja correcta) con una regla determinística que
// acá se repite (`mezclarDeterministico`: es una copia exacta de la del backend y un test compara las dos). La semilla real usa el
// id de la pregunta, así que el orden exacto que ve el alumno puede diferir del de la vista previa: lo que importa es que no
// coincide con el de las parejas.

import type { AntiCheatConfig, PreguntaRendir } from './api';
import { construirOpciones, puntajeEfectivoDe, redondearPuntos } from './examen-form';
import type { DatosForm, PreguntaForm } from './examen-form';

/**
 * Textos de la pantalla de ingreso del alumno que la vista previa repite. Son COPIA de `app/rendir/[slug]/page.tsx`: si se
 * cambian allá hay que cambiarlos acá (el test de vista-previa lee ese archivo y falla si dejan de coincidir).
 */
export const TEXTOS_INGRESO_ALUMNO = {
  duracionDetalle:
    'El tiempo empieza a correr cuando tocás “Comenzar” y no se detiene aunque cierres la pestaña. Lo que escribas se guarda solo; si se termina el tiempo, se entrega lo último guardado.',
  monitoreoTitulo: 'Qué se monitorea durante este examen',
  monitoreoPantalla: 'El examen se rinde en pantalla completa: se registra cada vez que salís de ella.',
  monitoreoPestana: 'Se registra cada vez que cambiás de pestaña o de ventana.',
  monitoreoPegado: 'Se registra cuando pegás texto en una respuesta.',
  monitoreoNota:
    'No se graba tu pantalla, tu cámara ni lo que escribís fuera del examen. Estos registros se le muestran a tu docente como información adicional: no bajan tu nota automáticamente.',
  consentimiento: 'Leí el aviso y entiendo qué se monitorea.',
} as const;

/** "Tenés N minutos." (el título del aviso de duración). */
export const avisoDuracionTitulo = (minutos: number): string => `Tenés ${minutos} minutos.`;

/** Minutos que verá el alumno en el aviso de duración, o null si el examen no es de sesión con tiempo (o la duración no es válida). */
export function duracionParaAlumno(datos: Pick<DatosForm, 'modalidad' | 'duracionMinutos'>): number | null {
  if (datos.modalidad !== 'sesion_tiempo') return null;
  const n = Number(datos.duracionMinutos);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/**
 * Qué se monitorea, tal como lo normaliza el servidor (`antiCheatActivo`): null si el docente no activó el registro o dejó
 * los tres controles apagados (en ese caso el alumno no ve ningún aviso).
 */
export function antiCheatParaAlumno(datos: Pick<DatosForm, 'antiCheatOn' | 'acPantalla' | 'acPestana' | 'acPegado'>): AntiCheatConfig | null {
  if (!datos.antiCheatOn) return null;
  const cfg = { pantallaCompleta: datos.acPantalla, cambioPestana: datos.acPestana, pegado: datos.acPegado };
  return cfg.pantallaCompleta || cfg.cambioPestana || cfg.pegado ? cfg : null;
}

/** Texto que se muestra en lugar de un enunciado vacío (el servidor nunca entregaría una pregunta sin enunciado). */
export const ENUNCIADO_VACIO = '(Pregunta sin enunciado)';

/** Hash de 32 bits (FNV-1a). COPIA EXACTA de la del backend (`correccion-cerradas.util.ts`): si una cambia, cambia la otra. */
function hash32(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Generador determinístico (mulberry32). COPIA EXACTA de la del backend. */
function generador(semilla: number): () => number {
  let a = semilla | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mezcla (Fisher-Yates) una copia de la lista, de forma determinística por semilla. COPIA EXACTA de la del backend. */
export function mezclarDeterministico<T>(items: readonly T[], semilla: string): T[] {
  const copia = [...items];
  const azar = generador(hash32(semilla));
  for (let i = copia.length - 1; i > 0; i -= 1) {
    const j = Math.floor(azar() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

type OpcionChoice = { id: string; texto: string };

/**
 * Las `opciones` de una pregunta del formulario como las recibiría el alumno. Parte de `construirOpciones` (la misma forma que
 * se manda al backend) y le quita la clave, igual que `sanitizarOpcionesParaAlumno`. Lo que todavía está a medio cargar no se
 * muestra: opciones sin texto (ya las descarta `construirOpciones`) y renglones de pares con un lado en blanco.
 */
function opcionesParaAlumno(p: PreguntaForm): unknown {
  const opciones = construirOpciones(p);
  switch (p.tipo) {
    case 'opcion_multiple':
    case 'casillas':
      // Se arma cada objeto con `id` y `texto` explícitos: nada de `correcta`, aunque llegara a haber más campos.
      return ((opciones as OpcionChoice[] | undefined) ?? []).map((o): OpcionChoice => ({ id: o.id, texto: o.texto }));
    case 'relacionar_pares': {
      const cfg = opciones as { izquierda: string[]; derecha: string[] };
      const izquierda = cfg.izquierda.filter((x) => x.trim() !== '');
      const derecha = cfg.derecha.filter((x) => x.trim() !== '');
      // Misma semilla que el backend cuando no recibe el id de la pregunta: solo el contenido (ver `sanitizarOpcionesParaAlumno`).
      return { izquierda, derecha: mezclarDeterministico(derecha, `|${izquierda.join('\u0001')}|${derecha.join('\u0001')}`) };
    }
    default:
      // verdadero/falso y numérica no llevan opciones para el alumno; las abiertas, tampoco.
      return null;
  }
}

/**
 * Preguntas del formulario -> lo que el servidor le entregaría al alumno (`PreguntaRendir[]`), en el mismo orden. Los ids son
 * estables por posición ("p1", "p2"…): sirven para guardar respuestas en memoria y para nombrar los grupos de radios. El
 * puntaje es el efectivo (`puntajeEfectivoDe`: los puntos válidos de la pregunta, o 0) como texto, igual que el Decimal que
 * devuelve el servidor. Nunca incluye la clave de respuesta ni la rúbrica.
 */
export function preguntasParaAlumno(preguntas: PreguntaForm[]): PreguntaRendir[] {
  return preguntas.map((p, i) => ({
    id: `p${i + 1}`,
    tipo: p.tipo,
    enunciado: p.enunciado.trim() || ENUNCIADO_VACIO,
    puntajeMaximo: String(redondearPuntos(puntajeEfectivoDe(p))),
    opciones: opcionesParaAlumno(p),
  }));
}

/**
 * Cuántas preguntas tienen respuesta ("N de M respondidas"). Misma regla que `tieneRespuesta` de
 * `app/rendir/[slug]/ExamenEnCurso.tsx`: vacío, null y arreglo vacío no cuentan; `false` (verdadero/falso) y 0 sí.
 */
export function cantidadRespondidas(preguntas: Pick<PreguntaRendir, 'id'>[], respuestas: Record<string, unknown>): number {
  return preguntas.filter((p) => {
    const v = respuestas[p.id];
    if (v === null || v === undefined || v === '') return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  }).length;
}
