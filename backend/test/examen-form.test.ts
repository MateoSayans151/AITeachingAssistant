// Tests del formulario del wizard de "Nuevo examen" (frontend/lib/examen-form.ts): reparto de los puntos de una pregunta abierta entre
// sus criterios según el peso, puntaje efectivo y total del examen, ida y vuelta examen -> formulario -> payload, uso de una
// matriz de rúbrica y escala de niveles. Funciones puras: corren sin base de datos ni navegador.
//   npm test
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ApiError, TIPOS_AUTOCORREGIBLES } from '../../frontend/lib/api';
import type { Examen, MatrizRubrica, Pregunta, TipoPregunta } from '../../frontend/lib/api';
import {
  PRESETS_NIVELES,
  aplicarMatriz,
  aplicarPreset,
  construirOpciones,
  construirPregunta,
  criterioVacio,
  datosPorDefecto,
  examenAFormulario,
  formatearPuntos,
  mensajesDelServidor,
  nivelesPorDefecto,
  parsearAlumnos,
  preguntaVacia,
  presetDe,
  puntajeEfectivoDe,
  puntosDeEjemplo,
  puntosPorCriterio,
  redondearPuntos,
  resumenNiveles,
  totalCoincideConEscala,
  totalDelExamen,
  validarDatos,
  validarNiveles,
  validarPregunta,
} from '../../frontend/lib/examen-form';
import type { CriterioForm, NivelForm, PreguntaForm } from '../../frontend/lib/examen-form';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const NIVELES = nivelesPorDefecto();
const TIPOS_ABIERTOS: TipoPregunta[] = ['desarrollo', 'resolucion_problema', 'demostracion', 'analisis_caso', 'respuesta_corta'];
const TIPOS_CERRADOS: TipoPregunta[] = ['numerica', 'relacionar_pares', 'opcion_multiple', 'casillas', 'verdadero_falso'];

const criterio = (peso: string, nombre = 'Criterio'): CriterioForm => ({ ...criterioVacio(NIVELES), nombre, descripcion: 'Qué se espera', peso });
/** Pregunta abierta con los puntos `puntaje` y un criterio por cada peso. */
const abierta = (puntaje: string, pesos: string[]): PreguntaForm => ({
  ...preguntaVacia(NIVELES),
  tipo: 'desarrollo',
  enunciado: 'Explicá',
  puntajeMaximo: puntaje,
  criterios: pesos.map((w, i) => criterio(w, `Criterio ${i + 1}`)),
});
const cerrada = (puntaje: string): PreguntaForm => ({ ...preguntaVacia(NIVELES), tipo: 'verdadero_falso', enunciado: 'V o F', puntajeMaximo: puntaje });
const suma = (xs: number[]) => redondearPuntos(xs.reduce((s, x) => s + x, 0));

// ---------------------------------------------------------------------------
// 1. puntosPorCriterio: reparto de los puntos de la pregunta según el peso
// ---------------------------------------------------------------------------
test('puntosPorCriterio: 3 pesos iguales reparten 10 puntos como 3,33 + 3,33 + 3,34', () => {
  assert.deepEqual(puntosPorCriterio(abierta('10', ['1', '1', '1'])), [3.33, 3.33, 3.34]);
});

test('puntosPorCriterio: pesos desiguales (proporcionales al peso)', () => {
  assert.deepEqual(puntosPorCriterio(abierta('10', ['1', '2', '2'])), [2, 4, 4]);
  assert.deepEqual(puntosPorCriterio(abierta('7', ['1', '2'])), [2.33, 4.67]);
  assert.deepEqual(puntosPorCriterio(abierta('5', ['6', '4'])), [3, 2]);
  assert.deepEqual(puntosPorCriterio(abierta('10', ['0.5', '1.5'])), [2.5, 7.5]);
});

test('puntosPorCriterio: la suma da EXACTAMENTE P redondeado a 2 decimales, con cualquier combinación de P y pesos', () => {
  // Generador determinístico para no depender del azar.
  let semilla = 12345;
  const azar = () => {
    semilla = (semilla * 1664525 + 1013904223) % 4294967296;
    return semilla / 4294967296;
  };
  for (let vuelta = 0; vuelta < 500; vuelta += 1) {
    const puntaje = redondearPuntos(1 + azar() * 40);
    const cantidad = 1 + Math.floor(azar() * 8);
    const pesos = Array.from({ length: cantidad }, () => String(redondearPuntos(0.1 + azar() * 9)));
    const pregunta = abierta(String(puntaje), pesos);
    const puntos = puntosPorCriterio(pregunta);
    assert.equal(puntos.length, cantidad);
    assert.equal(suma(puntos), redondearPuntos(puntaje), `P=${puntaje} pesos=${pesos.join(',')} -> ${puntos.join(',')}`);
    assert.ok(puntos.every((x) => x >= 0), `ningún criterio negativo: ${puntos.join(',')}`);
  }
  // P con más de 2 decimales: la suma es P redondeado.
  assert.equal(suma(puntosPorCriterio(abierta('10.005', ['1', '1', '1']))), 10.01);
});

test('puntosPorCriterio: un peso vacío o inválido cuenta como 0 (no suma ni recibe puntos) y el redondeo cae en el último criterio válido', () => {
  assert.deepEqual(puntosPorCriterio(abierta('10', ['', '1', 'abc', '3', '0', '-2'])), [0, 2.5, 0, 7.5, 0, 0]);
  // El último criterio de la lista no tiene peso: el ajuste del redondeo va al último que SÍ tiene.
  assert.deepEqual(puntosPorCriterio(abierta('10', ['1', '1', '1', ''])), [3.33, 3.33, 3.34, 0]);
  assert.deepEqual(puntosPorCriterio(abierta('10', ['', '1', '1', '1'])), [0, 3.33, 3.33, 3.34]);
});

test('puntosPorCriterio: sin P válido o sin ningún peso válido, todo en 0', () => {
  for (const puntaje of ['', '  ', 'abc', '0', '-5']) {
    assert.deepEqual(puntosPorCriterio(abierta(puntaje, ['1', '2'])), [0, 0], `P="${puntaje}"`);
  }
  assert.deepEqual(puntosPorCriterio(abierta('10', ['', '0', 'x'])), [0, 0, 0]);
  assert.deepEqual(puntosPorCriterio({ ...abierta('10', []), criterios: [] }), []);
});

test('puntosPorCriterio: un solo criterio se lleva todos los puntos, cualquiera sea su peso', () => {
  assert.deepEqual(puntosPorCriterio(abierta('7.5', ['3'])), [7.5]);
  assert.deepEqual(puntosPorCriterio(abierta('7.5', ['0.01'])), [7.5]);
  assert.deepEqual(puntosPorCriterio(abierta('10', ['1'])), [10]);
});

// ---------------------------------------------------------------------------
// 2. puntajeEfectivoDe y totalDelExamen
// ---------------------------------------------------------------------------
test('puntajeEfectivoDe: es el puntaje válido (> 0) de la pregunta, para los 10 tipos', () => {
  assert.equal(TIPOS_ABIERTOS.length + TIPOS_CERRADOS.length, 10);
  for (const tipo of [...TIPOS_ABIERTOS, ...TIPOS_CERRADOS]) {
    const base: PreguntaForm = { ...abierta('', ['3', '4']), tipo };
    assert.equal(puntajeEfectivoDe({ ...base, puntajeMaximo: '4' }), 4, tipo);
    assert.equal(puntajeEfectivoDe({ ...base, puntajeMaximo: '2.5' }), 2.5, tipo);
    assert.equal(puntajeEfectivoDe({ ...base, puntajeMaximo: '' }), 0, `${tipo} sin puntaje`);
    assert.equal(puntajeEfectivoDe({ ...base, puntajeMaximo: '0' }), 0, `${tipo} con 0`);
    assert.equal(puntajeEfectivoDe({ ...base, puntajeMaximo: '-3' }), 0, `${tipo} negativo`);
    assert.equal(puntajeEfectivoDe({ ...base, puntajeMaximo: 'abc' }), 0, `${tipo} no numérico`);
  }
});

test('puntajeEfectivoDe: las abiertas ya no suman sus criterios', () => {
  // 5 + 5 puntos de peso, pero la pregunta vale 4: vale 4.
  assert.equal(puntajeEfectivoDe(abierta('4', ['5', '5'])), 4);
  assert.equal(puntajeEfectivoDe(abierta('', ['5', '5'])), 0);
});

test('totalDelExamen: suma los puntos de todas las preguntas (mezcla de cerradas y abiertas) sin ruido de coma flotante', () => {
  assert.equal(totalDelExamen([]), 0);
  assert.equal(totalDelExamen([cerrada('2'), abierta('5', ['1', '1']), cerrada(''), cerrada('1.5')]), 8.5);
  assert.equal(totalDelExamen([cerrada('0.1'), abierta('0.2', ['1'])]), 0.3);
  assert.equal(totalDelExamen([abierta('10', ['5', '5'])]), 10);
});

test('totalCoincideConEscala y formatearPuntos', () => {
  assert.equal(totalCoincideConEscala(10, 10), true);
  assert.equal(totalCoincideConEscala(9.99, 10), true);
  assert.equal(totalCoincideConEscala(9.98, 10), false);
  assert.equal(formatearPuntos(7.5), '7,5');
  assert.equal(formatearPuntos(10), '10');
  assert.equal(formatearPuntos(3.3333), '3,33');
});

// ---------------------------------------------------------------------------
// 3. construirPregunta (payload) y validarPregunta
// ---------------------------------------------------------------------------
test('construirPregunta: abierta -> puntajeMaximo = P y cada criterio con sus puntos; la suma coincide con P', () => {
  const payload = construirPregunta(abierta('10', ['1', '1', '1']));
  assert.equal(payload.puntajeMaximo, 10);
  assert.equal(payload.opciones, undefined);
  assert.deepEqual(payload.criterios?.map((c) => c.puntajeMaximo), [3.33, 3.33, 3.34]);
  assert.equal(suma(payload.criterios!.map((c) => c.puntajeMaximo)), payload.puntajeMaximo);
});

test('construirPregunta: los criterios incompletos no se mandan y el reparto se calcula sobre los que se mandan', () => {
  const p = abierta('10', ['1', '1', '', '1']);
  p.criterios[1].nombre = ''; // sin nombre: se descarta
  const payload = construirPregunta(p);
  assert.deepEqual(payload.criterios?.map((c) => c.nombre), ['Criterio 1', 'Criterio 4']);
  assert.deepEqual(payload.criterios?.map((c) => c.puntajeMaximo), [5, 5]);
});

test('construirPregunta: niveles detallados solo si están los 5; matrizOrigenId y textos recortados', () => {
  const p = abierta('4', ['1', '3']);
  p.enunciado = '  Explicá  ';
  p.criterios[0].nombre = '  Claridad ';
  p.criterios[0].matrizOrigenId = 'm1';
  p.criterios[0].niveles = p.criterios[0].niveles.map((n) => ({ ...n, descripcion: `Detalle ${n.nombre}` }));
  p.criterios[1].niveles[2].descripcion = 'incompleto';
  const payload = construirPregunta(p);
  assert.equal(payload.enunciado, 'Explicá');
  assert.equal(payload.criterios![0].nombre, 'Claridad');
  assert.equal(payload.criterios![0].matrizOrigenId, 'm1');
  assert.equal(payload.criterios![0].nivelesDescripcion?.length, 5);
  assert.equal(payload.criterios![1].nivelesDescripcion, undefined);
  assert.deepEqual(payload.criterios!.map((c) => c.puntajeMaximo), [1, 3]);
});

test('construirPregunta: no manda `plegada` ni ningún campo de interfaz', () => {
  const abiertaPlegada = { ...abierta('2', ['1']), plegada: true };
  const cerradaPlegada = { ...cerrada('2'), plegada: true };
  for (const payload of [construirPregunta(abiertaPlegada), construirPregunta(cerradaPlegada)]) {
    assert.ok(!('plegada' in payload));
    assert.deepEqual(Object.keys(payload).sort().filter((k) => !['criterios', 'opciones'].includes(k)), ['enunciado', 'puntajeMaximo', 'tipo']);
  }
});

test('validarPregunta: abiertas necesitan puntaje de la pregunta, y por criterio nombre, peso y descripción', () => {
  assert.deepEqual(validarPregunta(abierta('10', ['1', '2']), 0), []);

  const sinPuntaje = validarPregunta(abierta('', ['1']), 1);
  assert.deepEqual(sinPuntaje, ['Pregunta 2: falta el puntaje de la pregunta.']);

  // Un solo criterio todavía en blanco: no hay ninguno completo.
  const sinCriterios = { ...abierta('5', []), criterios: [criterioVacio(NIVELES)] };
  assert.deepEqual(validarPregunta(sinCriterios, 0), ['Pregunta 1: agregá al menos un criterio con su nombre y su peso.']);
  // Un criterio con nombre pero sin peso: además de no haber ninguno completo, se marca qué le falta.
  assert.deepEqual(validarPregunta(abierta('5', ['']), 0), [
    'Pregunta 1: agregá al menos un criterio con su nombre y su peso.',
    'Pregunta 1, criterio 1: falta el peso.',
  ]);

  const incompleto = abierta('5', ['1', '2']);
  incompleto.criterios[1] = { ...incompleto.criterios[1], nombre: '', peso: '', descripcion: 'algo' };
  assert.deepEqual(validarPregunta(incompleto, 0), ['Pregunta 1, criterio 2: falta el nombre.', 'Pregunta 1, criterio 2: falta el peso.']);

  const sinDescripcion = abierta('5', ['1']);
  sinDescripcion.criterios[0].descripcion = '';
  assert.deepEqual(validarPregunta(sinDescripcion, 0), ['Pregunta 1, criterio 1: falta qué se espera para cumplirlo.']);

  const sinEnunciado = { ...abierta('5', ['1']), enunciado: ' ' };
  assert.deepEqual(validarPregunta(sinEnunciado, 2), ['Pregunta 3: falta el enunciado.']);
});

test('validarPregunta: las cerradas siguen pidiendo puntaje máximo y lo propio de cada tipo', () => {
  assert.deepEqual(validarPregunta(cerrada('1'), 0), []);
  assert.deepEqual(validarPregunta(cerrada(''), 0), ['Pregunta 1: falta el puntaje máximo.']);
  const mc: PreguntaForm = { ...preguntaVacia(NIVELES), tipo: 'opcion_multiple', enunciado: 'x', puntajeMaximo: '1' };
  assert.deepEqual(validarPregunta(mc, 0), ['Pregunta 1: cargá al menos 2 opciones con texto.']);
  const num: PreguntaForm = { ...preguntaVacia(NIVELES), tipo: 'numerica', enunciado: 'x', puntajeMaximo: '1' };
  assert.deepEqual(validarPregunta(num, 0), ['Pregunta 1: falta la respuesta correcta (un número).']);
  const pares: PreguntaForm = { ...preguntaVacia(NIVELES), tipo: 'relacionar_pares', enunciado: 'x', puntajeMaximo: '1' };
  assert.deepEqual(validarPregunta(pares, 0), ['Pregunta 1: completá los dos lados de cada par (mínimo 2 pares).']);
});

// ---------------------------------------------------------------------------
// 4. Ida y vuelta: examen -> formulario -> payload (las 10 clases de pregunta)
// ---------------------------------------------------------------------------
const NIVEL_DESC = ['Insuficiente', 'Básico', 'Intermedio', 'Avanzado', 'Excelente'].map((nombre, i) => ({ orden: i + 1, nombre, descripcion: `Detalle ${nombre}` }));
const critGuardado = (id: string, orden: number, puntajeMaximo: string, detallado = false): any => ({
  id,
  nombre: `Criterio ${orden + 1}`,
  descripcion: `Qué se espera ${orden + 1}`,
  puntajeMaximo,
  orden,
  matrizOrigenId: null,
  nivelesDescripcion: detallado ? NIVEL_DESC : [],
});

/** Opciones tal como las guarda el backend: lo que produce `construirOpciones`. */
const OPCIONES: Record<string, unknown> = {
  numerica: { respuestaCorrecta: 3.14, tolerancia: 0.01 },
  relacionar_pares: { izquierda: ['Perro', 'Gato'], derecha: ['Ladra', 'Maúlla'], paresCorrectos: [['Perro', 'Ladra'], ['Gato', 'Maúlla']] },
  opcion_multiple: [{ id: 'a', texto: 'Uno', correcta: false }, { id: 'b', texto: 'Dos', correcta: true }, { id: 'c', texto: 'Tres', correcta: false }],
  casillas: [{ id: 'a', texto: 'Uno', correcta: true }, { id: 'b', texto: 'Dos', correcta: false }, { id: 'c', texto: 'Tres', correcta: true }],
  verdadero_falso: { correcta: false },
};

function preguntaGuardada(tipo: TipoPregunta, orden: number): Pregunta {
  const base = { id: `p${orden}`, tipo, enunciado: `Enunciado ${tipo}`, orden };
  if (TIPOS_AUTOCORREGIBLES.includes(tipo)) return { ...base, puntajeMaximo: '2.50', opciones: OPCIONES[tipo] } as Pregunta;
  // Abiertas: los puntos de la pregunta son 10 y los criterios (6 y 4) también suman 10.
  return { ...base, puntajeMaximo: '10.00', opciones: null, criterios: [critGuardado('k2', 1, '4.00'), critGuardado('k1', 0, '6.00', true)] } as unknown as Pregunta;
}

const TODOS_LOS_TIPOS: TipoPregunta[] = [...TIPOS_ABIERTOS, ...TIPOS_CERRADOS];

function examenGuardado(preguntas: Pregunta[]): Examen {
  return {
    id: 'e1',
    cursoId: 'c1',
    titulo: 'Parcial',
    consigna: 'Consigna',
    modalidad: 'sesion_tiempo',
    duracionMinutos: 90,
    escalaMin: '0.00',
    escalaMax: '10.00',
    feedbackModo: 'inmediato',
    antiCheat: null,
    distribucionEsperada: null,
    niveles: [],
    preguntas,
  } as unknown as Examen;
}

test('examenAFormulario -> construirPregunta: las 10 clases de pregunta vuelven a armar el mismo payload', () => {
  const guardadas = TODOS_LOS_TIPOS.map((t, i) => preguntaGuardada(t, i));
  const form = examenAFormulario(examenGuardado(guardadas));
  assert.equal(form.preguntas.length, 10);

  form.preguntas.forEach((pf, i) => {
    const tipo = TODOS_LOS_TIPOS[i];
    const payload = construirPregunta(pf);
    assert.equal(payload.tipo, tipo);
    assert.equal(payload.enunciado, `Enunciado ${tipo}`);
    assert.equal(pf.plegada, false);
    if (TIPOS_AUTOCORREGIBLES.includes(tipo)) {
      assert.equal(payload.puntajeMaximo, 2.5, tipo);
      assert.equal(payload.criterios, undefined, tipo);
      // Las opciones se reproducen tal cual se guardaron.
      assert.deepEqual(payload.opciones, OPCIONES[tipo], `opciones de ${tipo}`);
      assert.deepEqual(construirOpciones(pf), OPCIONES[tipo], `construirOpciones de ${tipo}`);
    } else {
      assert.equal(payload.puntajeMaximo, 10, tipo);
      assert.equal(payload.opciones, undefined, tipo);
      assert.deepEqual(payload.criterios?.map((c) => [c.nombre, c.puntajeMaximo]), [['Criterio 1', 6], ['Criterio 2', 4]], tipo);
      // El primer criterio tenía los 5 niveles detallados y el segundo no.
      assert.deepEqual(payload.criterios![0].nivelesDescripcion, NIVEL_DESC, tipo);
      assert.equal(payload.criterios![1].nivelesDescripcion, undefined, tipo);
      assert.equal(suma(payload.criterios!.map((c) => c.puntajeMaximo)), payload.puntajeMaximo);
    }
    assert.deepEqual(validarPregunta(pf, i), [], `la pregunta duplicada es válida (${tipo})`);
  });
  // 5 cerradas de 2,5 + 5 abiertas de 10.
  assert.equal(totalDelExamen(form.preguntas), 62.5);
});

test('examenAFormulario: el título lleva "(copia)" y el resto de los datos se normaliza a string', () => {
  const form = examenAFormulario(examenGuardado([preguntaGuardada('desarrollo', 0)]));
  assert.equal(form.titulo, 'Parcial (copia)');
  assert.equal(form.escalaMin, '0');
  assert.equal(form.escalaMax, '10');
  assert.equal(form.duracionMinutos, '90');
  assert.equal(form.feedbackModo, 'inmediato');
  assert.deepEqual(form.niveles, nivelesPorDefecto());
});

test('examenAFormulario: una abierta guardada con el modelo viejo (sin puntaje propio) toma como puntaje la suma de sus criterios', () => {
  const vieja = { ...preguntaGuardada('desarrollo', 0), puntajeMaximo: '0' } as Pregunta;
  const form = examenAFormulario(examenGuardado([vieja]));
  const pf = form.preguntas[0];
  assert.equal(pf.puntajeMaximo, '10');
  assert.deepEqual(pf.criterios.map((c) => c.peso), ['6', '4']);
  assert.deepEqual(puntosPorCriterio(pf), [6, 4]);

  const sinPuntaje = { ...preguntaGuardada('desarrollo', 0), puntajeMaximo: undefined } as unknown as Pregunta;
  assert.equal(examenAFormulario(examenGuardado([sinPuntaje])).preguntas[0].puntajeMaximo, '10');
});

test('examenAFormulario: una abierta sin criterios conserva sus puntos y deja el criterio vacío', () => {
  const sinCriterios = { ...preguntaGuardada('desarrollo', 0), criterios: [] } as unknown as Pregunta;
  const pf = examenAFormulario(examenGuardado([sinCriterios])).preguntas[0];
  assert.equal(pf.puntajeMaximo, '10');
  assert.equal(pf.criterios.length, 1);
  assert.equal(pf.criterios[0].nombre, '');
});

test('examenAFormulario: sin preguntas deja una pregunta vacía', () => {
  const form = examenAFormulario(examenGuardado([]));
  assert.equal(form.preguntas.length, 1);
  assert.deepEqual(form.preguntas[0], preguntaVacia(form.niveles));
});

// ---------------------------------------------------------------------------
// 5. aplicarMatriz: los puntos de la matriz pasan a ser pesos
// ---------------------------------------------------------------------------
const matriz = (puntos: string[]): MatrizRubrica =>
  ({
    id: 'm1',
    docenteId: 'd1',
    nombre: 'Rúbrica de ensayo',
    descripcion: null,
    createdAt: '2026-01-01',
    criterios: puntos.map((puntajeMaximo, i) => ({ id: `k${i}`, nombre: `Matriz ${i + 1}`, descripcion: `Qué se espera ${i + 1}`, puntajeMaximo, orden: i, nivelesDescripcion: NIVEL_DESC })),
  }) as MatrizRubrica;

test('aplicarMatriz: con la pregunta sin puntos, toma la suma de la matriz (como antes) y los criterios quedan igual de puntuados', () => {
  const resultado = aplicarMatriz(abierta('', ['']), matriz(['5', '5']));
  assert.equal(resultado.puntajeMaximo, '10');
  assert.deepEqual(resultado.criterios.map((c) => c.peso), ['5', '5']);
  assert.deepEqual(puntosPorCriterio(resultado), [5, 5]);
  assert.ok(resultado.criterios.every((c) => c.matrizOrigenId === 'm1' && c.detallar && c.niveles.length === 5));
  assert.deepEqual(resultado.criterios.map((c) => c.nombre), ['Matriz 1', 'Matriz 2']);
});

test('aplicarMatriz: con puntos ya cargados los respeta y los criterios se reescalan solos', () => {
  const resultado = aplicarMatriz(abierta('20', ['']), matriz(['5', '5']));
  assert.equal(resultado.puntajeMaximo, '20');
  assert.deepEqual(puntosPorCriterio(resultado), [10, 10]);

  const desiguales = aplicarMatriz(abierta('5', ['']), matriz(['6', '4']));
  assert.equal(desiguales.puntajeMaximo, '5');
  assert.deepEqual(puntosPorCriterio(desiguales), [3, 2]);

  const redondeo = aplicarMatriz(abierta('10', ['']), matriz(['1', '1', '1']));
  assert.deepEqual(puntosPorCriterio(redondeo), [3.33, 3.33, 3.34]);
  assert.equal(suma(construirPregunta(redondeo).criterios!.map((c) => c.puntajeMaximo)), 10);
});

test('aplicarMatriz: normaliza los decimales de la matriz y no toca el resto de la pregunta', () => {
  const base = { ...abierta('', ['']), enunciado: 'Mi enunciado', plegada: true };
  const resultado = aplicarMatriz(base, matriz(['5.00', '2.50']));
  assert.deepEqual(resultado.criterios.map((c) => c.peso), ['5', '2.5']);
  assert.equal(resultado.puntajeMaximo, '7.5');
  assert.equal(resultado.enunciado, 'Mi enunciado');
  assert.equal(resultado.plegada, true);
  assert.equal(resultado.tipo, 'desarrollo');
});

// ---------------------------------------------------------------------------
// 6. Escala de niveles: validación, presets y resumen
// ---------------------------------------------------------------------------
const conPorcentajes = (porcentajes: string[]): NivelForm[] => nivelesPorDefecto().map((n, i) => ({ ...n, porcentaje: porcentajes[i] }));

test('validarNiveles: la escala por defecto y los 3 presets son válidos', () => {
  assert.deepEqual(validarNiveles(nivelesPorDefecto()), []);
  for (const preset of PRESETS_NIVELES) {
    assert.deepEqual(validarNiveles(aplicarPreset(nivelesPorDefecto(), preset.id)), [], preset.id);
  }
});

test('validarNiveles: nombre, rango, primer nivel 0 %, último 100 % y porcentajes crecientes', () => {
  const sinNombre = nivelesPorDefecto();
  sinNombre[1].nombre = ' ';
  assert.deepEqual(validarNiveles(sinNombre), ['El nivel 2 necesita un nombre.']);

  assert.match(validarNiveles(conPorcentajes(['0', '25', '', '75', '100']))[0], /El nivel 3 .* necesita un porcentaje entre 0 y 100/);
  assert.match(validarNiveles(conPorcentajes(['0', '25', '50', '75', '101']))[0], /El nivel 5 .* necesita un porcentaje entre 0 y 100/);
  assert.match(validarNiveles(conPorcentajes(['-1', '25', '50', '75', '100']))[0], /El nivel 1 .* necesita un porcentaje entre 0 y 100/);

  assert.match(validarNiveles(conPorcentajes(['5', '25', '50', '75', '100']))[0], /El primer nivel \(Insuficiente\) tiene que valer 0 %/);
  assert.match(validarNiveles(conPorcentajes(['0', '25', '50', '75', '90']))[0], /El último nivel \(Excelente\) tiene que valer 100 %/);
  const noCrece = validarNiveles(conPorcentajes(['0', '50', '50', '75', '100']));
  assert.equal(noCrece.length, 1);
  assert.match(noCrece[0], /tienen que ir creciendo.*«Básico» vale 50 % y «Intermedio» vale 50 %/);
  assert.deepEqual(validarNiveles([]), []);
});

test('presetDe / aplicarPreset: reconoce el preset exacto, conserva nombres y colores, y detecta lo personalizado', () => {
  assert.equal(presetDe(nivelesPorDefecto()), 'estandar');
  const exigente = aplicarPreset(nivelesPorDefecto(), 'exigente');
  assert.deepEqual(exigente.map((n) => n.porcentaje), ['0', '10', '30', '60', '100']);
  assert.deepEqual(exigente.map((n) => n.nombre), nivelesPorDefecto().map((n) => n.nombre));
  assert.deepEqual(exigente.map((n) => n.colorHex), nivelesPorDefecto().map((n) => n.colorHex));
  assert.equal(presetDe(exigente), 'exigente');
  assert.equal(presetDe(aplicarPreset(nivelesPorDefecto(), 'flexible')), 'flexible');
  assert.equal(presetDe(conPorcentajes(['0', '20', '50', '75', '100'])), 'personalizado');
  // Un id desconocido no cambia nada.
  assert.deepEqual(aplicarPreset(nivelesPorDefecto(), 'inexistente'), nivelesPorDefecto());
});

test('puntosDeEjemplo y resumenNiveles', () => {
  assert.equal(puntosDeEjemplo('50'), 1);
  assert.equal(puntosDeEjemplo('25'), 0.5);
  assert.equal(puntosDeEjemplo('75', 4), 3);
  assert.equal(puntosDeEjemplo(''), null);
  assert.equal(puntosDeEjemplo('abc'), null);
  assert.equal(resumenNiveles(nivelesPorDefecto()), 'Estándar · 0 / 25 / 50 / 75 / 100 %');
  assert.equal(resumenNiveles(aplicarPreset(nivelesPorDefecto(), 'flexible')), 'Flexible · 0 / 35 / 60 / 85 / 100 %');
  assert.equal(resumenNiveles(conPorcentajes(['0', '20', '', '75', '100'])), 'Personalizada · 0 / 20 / ? / 75 / 100 %');
});

// ---------------------------------------------------------------------------
// 7. Estado del formulario serializable, validarDatos y helpers del paso de publicar
// ---------------------------------------------------------------------------
test('datosPorDefecto y preguntaVacia son datos planos: sobreviven a un JSON.stringify/parse', () => {
  const datos = datosPorDefecto();
  assert.deepEqual(JSON.parse(JSON.stringify(datos)), datos);
  assert.equal(datos.escalaMax, '10');
  assert.equal(datos.modalidad, 'ventana_dias');
  assert.deepEqual(datos.niveles, nivelesPorDefecto());
  const pregunta = preguntaVacia(NIVELES);
  assert.deepEqual(JSON.parse(JSON.stringify(pregunta)), pregunta);
  assert.equal(pregunta.plegada, false);
  assert.equal(pregunta.puntajeMaximo, '');
  assert.equal(pregunta.criterios[0].peso, '');
  assert.ok(!('puntajeMaximo' in pregunta.criterios[0]));
  // Dos llamadas no comparten referencias.
  assert.notEqual(datosPorDefecto().niveles, datos.niveles);
});

test('validarDatos: pide título, consigna y curso; la escala; y la duración en sesiones con tiempo', () => {
  const vacios = validarDatos(datosPorDefecto());
  assert.deepEqual(vacios, ['Falta el título del examen.', 'Falta la consigna o las instrucciones generales.', 'Elegí un curso.']);

  const completo = { ...datosPorDefecto(), titulo: 'Parcial', consigna: 'Instrucciones', cursoElegido: 'c1' };
  assert.deepEqual(validarDatos(completo), []);
  assert.deepEqual(validarDatos({ ...completo, cursoElegido: 'nuevo' }), ['Falta el nombre del curso nuevo.']);
  assert.deepEqual(validarDatos({ ...completo, escalaMin: '10' }), ['La escala mínima tiene que ser menor que la máxima.']);
  assert.deepEqual(validarDatos({ ...completo, escalaMax: '' }), ['La escala necesita un mínimo y un máximo numéricos.']);
  assert.deepEqual(validarDatos({ ...completo, modalidad: 'sesion_tiempo', duracionMinutos: '0' }), ['La duración tiene que ser de al menos 1 minuto.']);
  assert.deepEqual(validarDatos({ ...completo, distOn: true, umbralAprobacion: '11' }), ['La nota de aprobación tiene que estar entre 0 y 10 (la escala del examen).']);
  assert.deepEqual(validarDatos({ ...completo, distOn: true, aprobadosPct: '120' }), ['El porcentaje de aprobados esperado tiene que estar entre 0 y 100.']);
  assert.equal(validarDatos({ ...completo, niveles: conPorcentajes(['0', '25', '50', '75', '90']) }).length, 1);
});

test('parsearAlumnos: nombre y email por línea, acepta lo pegado de una planilla y avisa de líneas con problemas', () => {
  const { alumnos, errores } = parsearAlumnos('Ana Pérez, ANA@mail.com\nluis@mail.com\nMaría\tmaria@mail.com\n\nsin-arroba\nluis@mail.com\nPedro;pedro@mail.com');
  assert.deepEqual(alumnos, [
    { nombre: 'Ana Pérez', email: 'ana@mail.com' },
    { nombre: 'luis', email: 'luis@mail.com' },
    { nombre: 'María', email: 'maria@mail.com' },
    { nombre: 'Pedro', email: 'pedro@mail.com' },
  ]);
  assert.equal(errores.length, 2);
  assert.match(errores[0], /Línea 5: no encontré un email válido \("sin-arroba"\)/);
  assert.match(errores[1], /Línea 6: el email luis@mail.com está repetido/);
  assert.deepEqual(parsearAlumnos('  \n'), { alumnos: [], errores: [] });
});

test('mensajesDelServidor: lista de class-validator, mensaje suelto, o nada', () => {
  const err = (body: string) => new ApiError(400, 'Error 400', body);
  assert.deepEqual(mensajesDelServidor(err(JSON.stringify({ message: ['a', 'b'] }))), ['a', 'b']);
  assert.deepEqual(mensajesDelServidor(err(JSON.stringify({ message: 'solo uno' }))), ['solo uno']);
  assert.deepEqual(mensajesDelServidor(err('no es json')), []);
  assert.deepEqual(mensajesDelServidor(err(JSON.stringify({ otra: 1 }))), []);
  assert.deepEqual(mensajesDelServidor(new Error('x')), []);
});
