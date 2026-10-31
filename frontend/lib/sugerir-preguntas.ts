// "Sugerir preguntas con IA" del paso 2 del wizard de "Nuevo examen": funciones puras (sin React ni red) para pasar una sugerencia de
// la IA a una pregunta del formulario, agregarla a la lista, listar los temas del material del curso y explicar los errores.
// Las usa <PanelSugerirPreguntas/>; viven acá para poder probarlas sueltas (backend/test/sugerir-preguntas.test.ts).

import { ApiError, TIPOS_AUTOCORREGIBLES } from './api';
import type { CriterioSugerido, MaterialCurso, PreguntaSugerida } from './api';
import { criteriosDeSugerencia, idDeOpcion, preguntaVacia } from './examen-form';
import type { NivelForm, PreguntaForm } from './examen-form';
import { agregarPreguntaPlegando } from './examen-preguntas';

export const esSugerenciaCerrada = (s: PreguntaSugerida): boolean => TIPOS_AUTOCORREGIBLES.includes(s.tipo);

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Sugerencia de la IA -> pregunta del formulario, con todo lo que trae la sugerencia (enunciado, clave de respuesta y, si se le pasan,
 * los criterios de la rúbrica). Los puntos quedan vacíos, como en una pregunta nueva: se reparten con «Repartir en partes iguales».
 * Se lee la clave con cuidado (viene de la red): lo que no tiene la forma esperada queda como en una pregunta vacía y el docente
 * lo ve incompleto en la validación, nunca con una respuesta inventada.
 */
export function preguntaDeSugerencia(s: PreguntaSugerida, niveles: NivelForm[], criterios?: CriterioSugerido[]): PreguntaForm {
  const base: PreguntaForm = { ...preguntaVacia(niveles), tipo: s.tipo, enunciado: s.enunciado };
  const o = s.opciones;
  switch (s.tipo) {
    case 'opcion_multiple':
    case 'casillas':
      if (Array.isArray(o)) {
        base.opcionesChoice = o.filter(esObjeto).map((x, i) => ({ id: typeof x.id === 'string' ? x.id : idDeOpcion(i), texto: String(x.texto ?? ''), correcta: x.correcta === true }));
      }
      break;
    case 'verdadero_falso':
      if (esObjeto(o) && typeof o.correcta === 'boolean') base.vfCorrecta = o.correcta ? 'true' : 'false';
      break;
    case 'numerica':
      if (esObjeto(o) && typeof o.respuestaCorrecta === 'number') {
        base.numRespuestaCorrecta = String(o.respuestaCorrecta);
        base.numTolerancia = typeof o.tolerancia === 'number' ? String(o.tolerancia) : '0';
      }
      break;
    case 'relacionar_pares':
      if (esObjeto(o) && Array.isArray(o.izquierda) && Array.isArray(o.derecha)) {
        base.paresIzquierda = o.izquierda.map(String);
        base.paresDerecha = o.derecha.map(String);
      }
      break;
    default:
      if (criterios && criterios.length > 0) base.criterios = criteriosDeSugerencia(criterios, niveles);
  }
  return base;
}

/** ¿La pregunta está tal como la deja `preguntaVacia` (nada escrito)? Sirve para no dejar una pregunta en blanco de relleno al agregar sugerencias. */
export function esPreguntaEnBlanco(p: PreguntaForm): boolean {
  return (
    p.enunciado.trim() === '' &&
    (p.puntajeMaximo.trim() === '' || p.puntosFijos === false) &&
    p.opcionesChoice.every((o) => o.texto.trim() === '' && !o.correcta) &&
    p.vfCorrecta === '' &&
    p.numRespuestaCorrecta.trim() === '' &&
    p.paresIzquierda.every((x) => x.trim() === '') &&
    p.paresDerecha.every((x) => x.trim() === '') &&
    p.criterios.every((c) => c.nombre.trim() === '' && c.descripcion.trim() === '' && c.peso.trim() === '')
  );
}

/**
 * Agrega una pregunta sugerida al final, PLEGADA (la lista no crece en pantalla ni se mueve el docente de donde está). Si lo único que
 * hay son preguntas en blanco (la que trae el wizard al abrirse) las reemplaza. Devuelve la lista nueva y el índice (base 0) en que
 * quedó la pregunta.
 */
export function agregarSugerida(lista: PreguntaForm[], nueva: PreguntaForm): { lista: PreguntaForm[]; indice: number } {
  const plegada = { ...nueva, plegada: true };
  if (lista.every(esPreguntaEnBlanco)) return { lista: [plegada], indice: 0 };
  const siguiente = agregarPreguntaPlegando(lista, plegada);
  siguiente[siguiente.length - 1] = plegada; // agregarPreguntaPlegando deja la nueva desplegada; acá va plegada
  return { lista: siguiente, indice: siguiente.length - 1 };
}

/** Un tema que el docente puede tildar: una unidad del material (o, si el material no tiene unidad, su título). */
export interface TemaMaterial {
  /** Lo que se manda como tema (coincide con la unidad o el título del material). */
  valor: string;
  /** Cuántos materiales entran en el tema. */
  materiales: number;
}

/** Los temas del material del curso: una unidad por cada valor distinto, y el título de los materiales que no tienen unidad. En orden de carga. */
export function temasDelMaterial(materiales: Pick<MaterialCurso, 'titulo' | 'unidad'>[]): TemaMaterial[] {
  const porValor = new Map<string, number>();
  for (const m of materiales) {
    const valor = (m.unidad ?? '').trim() || m.titulo.trim();
    if (valor) porValor.set(valor, (porValor.get(valor) ?? 0) + 1);
  }
  return [...porValor].map(([valor, cantidad]) => ({ valor, materiales: cantidad }));
}

/** "Clase 4 · Unidad 2" / "Clase 4": de dónde salió la pregunta, o null si no se pudo ubicar. */
export function textoFuente(fuente: PreguntaSugerida['fuente']): string | null {
  if (!fuente) return null;
  return fuente.unidad && fuente.unidad !== fuente.titulo ? `${fuente.titulo} · ${fuente.unidad}` : fuente.titulo;
}

/** Mensaje en castellano para un fallo de "Sugerir preguntas con IA" (nunca el JSON crudo del servidor). */
export function mensajeErrorSugerirPreguntas(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'Pediste demasiadas sugerencias en poco tiempo (el límite es de 10 por minuto). Esperá un momento y probá de nuevo.';
    if (err.status === 401) return 'Tu sesión venció. Volvé a iniciar sesión y probá de nuevo.';
    if (err.status === 404) return 'No encontramos ese curso entre los tuyos. Elegilo de nuevo en el encabezado del examen.';
    if (err.status === 400) {
      try {
        const mensaje = JSON.parse(err.body)?.message;
        if (typeof mensaje === 'string' && /material/i.test(mensaje)) return mensaje;
      } catch {
        // el cuerpo no era JSON: va el mensaje genérico
      }
      return 'No se pudo pedir la sugerencia: revisá los temas y la indicación que escribiste.';
    }
    // En un 502 el servidor manda un mensaje propio y ya en castellano (modelo saturado, sin preguntas utilizables…): se muestra tal cual.
    if (err.status === 502) {
      try {
        const mensaje = JSON.parse(err.body)?.message;
        if (typeof mensaje === 'string' && mensaje.trim()) return mensaje;
      } catch {
        // el cuerpo no era JSON: va el mensaje genérico
      }
    }
    return 'La IA no pudo armar las preguntas en este momento. Probá de nuevo en unos minutos o cargalas a mano.';
  }
  return 'No pudimos conectarnos con el servidor. Revisá tu conexión y probá de nuevo.';
}
