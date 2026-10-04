// Tests de la escala de niveles de desempeño del wizard de "Nuevo examen" (frontend/lib/examen-form.ts): cantidad elegible de
// 3 a 7 niveles, colores automáticos por posición, nombres y porcentajes por defecto, agregar / quitar / repartir, validación,
// reconciliación de los niveles de cada criterio con la escala y duplicado de un examen con otra cantidad de niveles.
// Funciones puras: corren sin base de datos ni navegador.
//   node --require ts-node/register --test test/niveles-escala.test.ts   (y se suma a `npm test`)
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Examen, Pregunta } from '../../frontend/lib/api';
import {
  MAX_NIVELES,
  MIN_NIVELES,
  agregarNivel,
  cambiarCantidadNiveles,
  colorDeNivel,
  construirPregunta,
  criterioVacio,
  datosPorDefecto,
  esEscalaPorDefecto,
  examenAFormulario,
  nivelDelMedio,
  nivelesParaCantidad,
  nivelesPorDefecto,
  normalizarNiveles,
  porcentajesParejos,
  preguntaVacia,
  quitarNivel,
  reconciliarNiveles,
  repartirPorcentajes,
  resumenNiveles,
  validarDatos,
  validarNiveles,
  validarPregunta,
} from '../../frontend/lib/examen-form';
import type { CriterioForm, NivelForm, PreguntaForm } from '../../frontend/lib/examen-form';

const nombres = (niveles: NivelForm[]) => niveles.map((n) => n.nombre);
const porcentajes = (niveles: NivelForm[]) => niveles.map((n) => n.porcentaje);
const ordenes = (niveles: NivelForm[]) => niveles.map((n) => n.orden);

/** Una escala es "consistente" si el orden es 1..N y cada color es el que le toca por posición. */
function assertConsistente(niveles: NivelForm[], mensaje = '') {
  assert.deepEqual(ordenes(niveles), niveles.map((_, i) => i + 1), `orden 1..N ${mensaje}`);
  assert.deepEqual(niveles.map((n) => n.colorHex), niveles.map((_, i) => colorDeNivel(i, niveles.length)), `colores por posición ${mensaje}`);
}

// ---------------------------------------------------------------------------
// 1. Colores automáticos
// ---------------------------------------------------------------------------
const COLORES_5 = ['#c0392b', '#c8511b', '#c9a227', '#3b4fb0', '#1a7f4e'];

test('colorDeNivel: con 5 niveles da EXACTAMENTE los 5 colores de siempre', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => colorDeNivel(i, 5)), COLORES_5);
  assert.deepEqual(nivelesPorDefecto().map((n) => n.colorHex), COLORES_5);
});

test('colorDeNivel: para N de 3 a 7 el primero es rojo, el último verde, y cada color es un hex válido y distinto', () => {
  for (let n = MIN_NIVELES; n <= MAX_NIVELES; n += 1) {
    const colores = Array.from({ length: n }, (_, i) => colorDeNivel(i, n));
    assert.equal(colores[0], COLORES_5[0], `primero de ${n}`);
    assert.equal(colores[n - 1], COLORES_5[4], `último de ${n}`);
    assert.ok(colores.every((c) => /^#[0-9a-f]{6}$/.test(c)), `hex válidos de ${n}: ${colores.join(',')}`);
    assert.equal(new Set(colores).size, n, `colores distintos de ${n}`);
  }
  // Con 3 niveles: rojo, el color del medio de la escala y verde.
  assert.deepEqual([0, 1, 2].map((i) => colorDeNivel(i, 3)), ['#c0392b', '#c9a227', '#1a7f4e']);
  // Con 7 niveles pasa por los 5 colores ancla (posiciones 0, 3 y 6 del 7 caen en las anclas 0, 2 y 4) e interpola el resto.
  assert.deepEqual([0, 3, 6].map((i) => colorDeNivel(i, 7)), ['#c0392b', '#c9a227', '#1a7f4e']);
});

test('colorDeNivel: es una función pura y se acota ante índices o totales raros', () => {
  assert.equal(colorDeNivel(2, 5), colorDeNivel(2, 5));
  assert.equal(colorDeNivel(-3, 5), COLORES_5[0]);
  assert.equal(colorDeNivel(99, 5), COLORES_5[4]);
  assert.equal(colorDeNivel(0, 1), COLORES_5[0]);
  assert.equal(colorDeNivel(0, 0), COLORES_5[0]);
});

// ---------------------------------------------------------------------------
// 2. Escala por defecto de cada cantidad
// ---------------------------------------------------------------------------
test('nivelesParaCantidad: nombres por defecto de 3 a 7 niveles', () => {
  assert.deepEqual(nombres(nivelesParaCantidad(3)), ['Insuficiente', 'Adecuado', 'Excelente']);
  assert.deepEqual(nombres(nivelesParaCantidad(4)), ['Insuficiente', 'Básico', 'Avanzado', 'Excelente']);
  assert.deepEqual(nombres(nivelesParaCantidad(5)), ['Insuficiente', 'Básico', 'Intermedio', 'Avanzado', 'Excelente']);
  assert.deepEqual(nombres(nivelesParaCantidad(6)), ['Insuficiente', 'Básico', 'Intermedio', 'Bueno', 'Muy bueno', 'Excelente']);
  assert.deepEqual(nombres(nivelesParaCantidad(7)), ['Insuficiente', 'Muy bajo', 'Básico', 'Intermedio', 'Bueno', 'Muy bueno', 'Excelente']);
});

test('nivelesParaCantidad: porcentajes parejos (enteros, de 0 a 100, crecientes), orden 1..N y colores por posición', () => {
  assert.deepEqual(porcentajes(nivelesParaCantidad(5)), ['0', '25', '50', '75', '100']);
  assert.deepEqual(porcentajes(nivelesParaCantidad(3)), ['0', '50', '100']);
  assert.deepEqual(porcentajes(nivelesParaCantidad(4)), ['0', '33', '67', '100']);
  assert.deepEqual(porcentajes(nivelesParaCantidad(6)), ['0', '20', '40', '60', '80', '100']);
  assert.deepEqual(porcentajes(nivelesParaCantidad(7)), ['0', '17', '33', '50', '67', '83', '100']);
  for (let n = MIN_NIVELES; n <= MAX_NIVELES; n += 1) {
    const escala = nivelesParaCantidad(n);
    assert.equal(escala.length, n);
    assertConsistente(escala, `de ${n}`);
    assert.deepEqual(validarNiveles(escala), [], `la escala de ${n} es válida`);
    assert.deepEqual(porcentajesParejos(n).map(String), porcentajes(escala));
  }
});

test('nivelesParaCantidad: acota la cantidad a 3..7 y nivelesPorDefecto es la de 5 (el estado inicial)', () => {
  assert.equal(nivelesParaCantidad(1).length, 3);
  assert.equal(nivelesParaCantidad(12).length, 7);
  assert.deepEqual(nivelesPorDefecto(), nivelesParaCantidad(5));
  assert.equal(datosPorDefecto().niveles.length, 5);
  assert.deepEqual(datosPorDefecto().niveles, nivelesPorDefecto());
  // Cada llamada devuelve una escala propia (no se comparte el arreglo).
  assert.notEqual(nivelesPorDefecto(), nivelesPorDefecto());
});

test('esEscalaPorDefecto: solo si nombres y porcentajes son los generados para su cantidad', () => {
  for (let n = MIN_NIVELES; n <= MAX_NIVELES; n += 1) assert.equal(esEscalaPorDefecto(nivelesParaCantidad(n)), true, `de ${n}`);
  const renombrada = nivelesParaCantidad(5);
  renombrada[1].nombre = 'Casi';
  assert.equal(esEscalaPorDefecto(renombrada), false);
  assert.equal(esEscalaPorDefecto(repartirPorcentajes(agregarNivel(nivelesParaCantidad(5)))), false); // 6 niveles, pero nombres propios
  assert.equal(esEscalaPorDefecto([]), false);
});

// ---------------------------------------------------------------------------
// 3. Agregar, quitar, repartir y cambiar la cantidad
// ---------------------------------------------------------------------------
test('agregarNivel: entra justo antes del último, con % intermedio y nombre "Nivel N"; renumera y recolorea', () => {
  const base = nivelesParaCantidad(5);
  const mas = agregarNivel(base);
  assert.equal(mas.length, 6);
  assert.deepEqual(nombres(mas), ['Insuficiente', 'Básico', 'Intermedio', 'Avanzado', 'Nivel 5', 'Excelente']);
  assert.deepEqual(porcentajes(mas), ['0', '25', '50', '75', '88', '100']); // entre 75 y 100: 87,5 -> 88
  assert.equal(mas[mas.length - 1].nombre, 'Excelente'); // el mejor sigue al final
  assertConsistente(mas);
  assert.deepEqual(validarNiveles(mas), []);
  // No muta la escala original.
  assert.equal(base.length, 5);
  assert.deepEqual(base, nivelesPorDefecto());

  // Agregar de nuevo: otro "Nivel", otra vez antes del último.
  const siete = agregarNivel(mas);
  assert.equal(siete.length, 7);
  assert.deepEqual(nombres(siete), ['Insuficiente', 'Básico', 'Intermedio', 'Avanzado', 'Nivel 5', 'Nivel 6', 'Excelente']);
  assert.deepEqual(porcentajes(siete), ['0', '25', '50', '75', '88', '94', '100']);
  assertConsistente(siete);
  assert.deepEqual(validarNiveles(siete), []);
});

test('agregarNivel: con 7 niveles no hace nada; con 3 llega a 4 sin romper la escala', () => {
  const siete = nivelesParaCantidad(7);
  assert.equal(agregarNivel(siete), siete);
  const cuatro = agregarNivel(nivelesParaCantidad(3));
  assert.deepEqual(nombres(cuatro), ['Insuficiente', 'Adecuado', 'Nivel 3', 'Excelente']);
  assert.deepEqual(porcentajes(cuatro), ['0', '50', '75', '100']);
  assertConsistente(cuatro);
});

test('agregarNivel: el nombre sugerido no repite uno existente (sin distinguir mayúsculas) y el % se arregla si los vecinos están pegados', () => {
  const escala = nivelesParaCantidad(3);
  escala[1].nombre = 'nivel 3'; // el que se sugeriría
  assert.equal(agregarNivel(escala)[2].nombre, 'Nivel 4');

  const pegados = nivelesParaCantidad(4);
  pegados[2].porcentaje = '99'; // entre 99 y 100 no cabe un entero
  assert.equal(agregarNivel(pegados)[3].porcentaje, '99.5');

  const rotos = nivelesParaCantidad(4);
  rotos[2].porcentaje = ''; // vecino sin valor: se usa el reparto parejo de la posición
  assert.equal(agregarNivel(rotos)[3].porcentaje, String(porcentajesParejos(5)[3]));
});

test('quitarNivel: saca esa fila, renumera y recolorea; con 3 niveles (el mínimo) no hace nada', () => {
  const base = nivelesParaCantidad(5);
  const menos = quitarNivel(base, 2);
  assert.deepEqual(nombres(menos), ['Insuficiente', 'Básico', 'Avanzado', 'Excelente']);
  assert.deepEqual(porcentajes(menos), ['0', '25', '75', '100']);
  assertConsistente(menos);
  assert.equal(base.length, 5);

  const tres = nivelesParaCantidad(3);
  assert.equal(quitarNivel(tres, 1), tres);
  assert.equal(quitarNivel(base, 9), base); // índice inexistente
  assert.equal(quitarNivel(base, -1), base);
});

test('repartirPorcentajes: 0, 100/(n-1), …, 100 redondeados a enteros crecientes, sin tocar nombres ni colores', () => {
  for (let n = MIN_NIVELES; n <= MAX_NIVELES; n += 1) {
    const desparejos = nivelesParaCantidad(n).map((x, i) => ({ ...x, nombre: `N${i}`, porcentaje: i === 1 ? '3' : x.porcentaje }));
    const repartidos = repartirPorcentajes(desparejos);
    assert.deepEqual(porcentajes(repartidos), porcentajesParejos(n).map(String), `de ${n}`);
    assert.deepEqual(nombres(repartidos), nombres(desparejos));
    assert.deepEqual(repartidos.map((x) => x.colorHex), desparejos.map((x) => x.colorHex));
    const valores = porcentajes(repartidos).map(Number);
    assert.equal(valores[0], 0);
    assert.equal(valores[n - 1], 100);
    assert.ok(valores.every((v, i) => i === 0 || v > valores[i - 1]), `crecientes de ${n}`);
  }
  assert.deepEqual(porcentajes(repartirPorcentajes(nivelesParaCantidad(5))), ['0', '25', '50', '75', '100']);
});

test('cambiarCantidadNiveles: la escala sin tocar pasa a la por defecto de la cantidad; la editada conserva lo escrito', () => {
  // Sin tocar: nombres y % sugeridos de la cantidad nueva.
  assert.deepEqual(cambiarCantidadNiveles(nivelesParaCantidad(5), 3), nivelesParaCantidad(3));
  assert.deepEqual(cambiarCantidadNiveles(nivelesParaCantidad(5), 7), nivelesParaCantidad(7));
  const igual = nivelesParaCantidad(5);
  assert.equal(cambiarCantidadNiveles(igual, 5), igual);
  assert.equal(cambiarCantidadNiveles(nivelesParaCantidad(5), 99).length, 7);
  assert.equal(cambiarCantidadNiveles(nivelesParaCantidad(5), 1).length, 3);

  // Editada: agrega antes del último o saca los que están justo antes del último.
  const propia = nivelesParaCantidad(5);
  propia[1].nombre = 'Casi nada';
  const seis = cambiarCantidadNiveles(propia, 6);
  assert.deepEqual(nombres(seis), ['Insuficiente', 'Casi nada', 'Intermedio', 'Avanzado', 'Nivel 5', 'Excelente']);
  const tres = cambiarCantidadNiveles(propia, 3);
  assert.deepEqual(nombres(tres), ['Insuficiente', 'Casi nada', 'Excelente']);
  for (const e of [seis, tres]) assertConsistente(e);
});

// ---------------------------------------------------------------------------
// 4. validarNiveles con la cantidad variable
// ---------------------------------------------------------------------------
test('validarNiveles: de 3 a 7 niveles; fuera de ese rango pide ajustar la cantidad', () => {
  for (let n = MIN_NIVELES; n <= MAX_NIVELES; n += 1) assert.deepEqual(validarNiveles(nivelesParaCantidad(n)), [], `de ${n}`);
  const sinElMinimo = nivelesParaCantidad(3).slice(0, 2);
  assert.deepEqual(validarNiveles(sinElMinimo), ['La escala necesita entre 3 y 7 niveles (ahora tiene 2).']);
  const ocho = [...nivelesParaCantidad(7), { orden: 8, nombre: 'Extra', colorHex: '#000000', porcentaje: '100' }];
  assert.deepEqual(validarNiveles(ocho), ['La escala necesita entre 3 y 7 niveles (ahora tiene 8).']);
});

test('validarNiveles: no admite nombres repetidos (sin distinguir mayúsculas ni espacios de más)', () => {
  const escala = nivelesParaCantidad(4);
  escala[2].nombre = ' BÁSICO ';
  const errores = validarNiveles(escala);
  assert.equal(errores.length, 1);
  assert.match(errores[0], /Los niveles 2 y 3 se llaman igual/);
  assert.match(errores[0], /«BÁSICO»|«Básico»/);

  const tres = nivelesParaCantidad(7);
  tres[3].nombre = 'x';
  tres[4].nombre = 'X';
  tres[5].nombre = 'x ';
  assert.match(validarNiveles(tres)[0], /Los niveles 4 y 5 y 6 se llaman igual/);

  // Los nombres vacíos no cuentan como repetidos entre sí: solo piden un nombre.
  const vacios = nivelesParaCantidad(4);
  vacios[1].nombre = '';
  vacios[2].nombre = ' ';
  assert.deepEqual(validarNiveles(vacios), ['El nivel 2 necesita un nombre.', 'El nivel 3 necesita un nombre.']);
});

test('validarNiveles: las reglas de primero 0 %, último 100 % y crecientes valen para cualquier cantidad', () => {
  const siete = nivelesParaCantidad(7);
  siete[0].porcentaje = '5';
  assert.match(validarNiveles(siete)[0], /El primer nivel \(Insuficiente\) tiene que valer 0 %/);

  const tres = nivelesParaCantidad(3);
  tres[2].porcentaje = '90';
  assert.match(validarNiveles(tres)[0], /El último nivel \(Excelente\) tiene que valer 100 %/);

  const seis = nivelesParaCantidad(6);
  seis[4].porcentaje = '30';
  const errores = validarNiveles(seis);
  assert.equal(errores.length, 1);
  assert.match(errores[0], /tienen que ir creciendo.*«Bueno» vale 60 % y «Muy bueno» vale 30 %/);
});

test('validarDatos incluye la cantidad de niveles; resumenNiveles muestra la cantidad y los porcentajes', () => {
  const completo = { ...datosPorDefecto(), titulo: 'Parcial', consigna: 'Instrucciones', cursoElegido: 'c1' };
  assert.deepEqual(validarDatos(completo), []);
  assert.deepEqual(validarDatos({ ...completo, niveles: nivelesParaCantidad(7) }), []);
  assert.equal(validarDatos({ ...completo, niveles: nivelesParaCantidad(3).slice(0, 2) }).length, 1);
  assert.equal(resumenNiveles(nivelesParaCantidad(5)), '5 niveles · 0 / 25 / 50 / 75 / 100 %');
  assert.equal(resumenNiveles(nivelesParaCantidad(3)), '3 niveles · 0 / 50 / 100 %');
  assert.equal(resumenNiveles(nivelesParaCantidad(7)), '7 niveles · 0 / 17 / 33 / 50 / 67 / 83 / 100 %');
});

test('nivelDelMedio: con 5 niveles el 3.º (el ejemplo de siempre); con 3 el 2.º; con 7 el 4.º', () => {
  assert.equal(nivelDelMedio(nivelesParaCantidad(5))?.nombre, 'Intermedio');
  assert.equal(nivelDelMedio(nivelesParaCantidad(3))?.nombre, 'Adecuado');
  assert.equal(nivelDelMedio(nivelesParaCantidad(7))?.nombre, 'Intermedio');
});

test('normalizarNiveles: renumera 1..N y recalcula los colores, conservando nombre y porcentaje', () => {
  const raros: NivelForm[] = [
    { orden: 9, nombre: 'A', colorHex: '#000', porcentaje: '0' },
    { orden: 2, nombre: 'B', colorHex: '#111', porcentaje: '40' },
    { orden: 7, nombre: 'C', colorHex: '#222', porcentaje: '100' },
  ];
  const n = normalizarNiveles(raros);
  assertConsistente(n);
  assert.deepEqual(nombres(n), ['A', 'B', 'C']);
  assert.deepEqual(porcentajes(n), ['0', '40', '100']);
  assert.equal(raros[0].orden, 9); // no muta
});

// ---------------------------------------------------------------------------
// 5. reconciliarNiveles: los niveles de cada criterio acompañan a la escala
// ---------------------------------------------------------------------------
/** Criterio de una pregunta abierta cuyos niveles siguen la escala `escala`, con la descripción "D-<nombre>" en cada uno. */
function criterioDescripto(escala: NivelForm[], nombre = 'Claridad', detallar = true): CriterioForm {
  return {
    ...criterioVacio(escala),
    nombre,
    descripcion: 'Qué se espera',
    peso: '1',
    detallar,
    niveles: escala.map((n) => ({ orden: n.orden, nombre: n.nombre, descripcion: `D-${n.nombre}` })),
  };
}
const preguntaCon = (escala: NivelForm[], ...criterios: CriterioForm[]): PreguntaForm => ({
  ...preguntaVacia(escala),
  enunciado: 'Explicá',
  puntajeMaximo: '10',
  criterios: criterios.length > 0 ? criterios : [criterioDescripto(escala)],
});
const descripciones = (c: CriterioForm) => c.niveles.map((n) => n.descripcion);
const nombresDe = (c: CriterioForm) => c.niveles.map((n) => n.nombre);

test('reconciliarNiveles: al agregar un nivel antes del último, el nuevo queda vacío y el resto conserva su descripción', () => {
  const vieja = nivelesParaCantidad(5);
  const nueva = agregarNivel(vieja);
  const [p] = reconciliarNiveles([preguntaCon(vieja)], nueva, vieja);
  const c = p.criterios[0];
  assert.equal(c.niveles.length, 6);
  assert.deepEqual(nombresDe(c), nombres(nueva));
  assert.deepEqual(c.niveles.map((n) => n.orden), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(descripciones(c), ['D-Insuficiente', 'D-Básico', 'D-Intermedio', 'D-Avanzado', '', 'D-Excelente']);
  assert.equal(c.detallar, true); // detallar no cambia
});

test('reconciliarNiveles: al quitar un nivel se descarta el suyo y los demás conservan lo escrito', () => {
  const vieja = nivelesParaCantidad(5);
  const nueva = quitarNivel(vieja, 1); // sale "Básico"
  const [p] = reconciliarNiveles([preguntaCon(vieja)], nueva, vieja);
  assert.deepEqual(nombresDe(p.criterios[0]), ['Insuficiente', 'Intermedio', 'Avanzado', 'Excelente']);
  assert.deepEqual(descripciones(p.criterios[0]), ['D-Insuficiente', 'D-Intermedio', 'D-Avanzado', 'D-Excelente']);

  const sinElUltimo = quitarNivel(vieja, 4); // sale "Excelente"
  const [q] = reconciliarNiveles([preguntaCon(vieja)], sinElUltimo, vieja);
  assert.deepEqual(descripciones(q.criterios[0]), ['D-Insuficiente', 'D-Básico', 'D-Intermedio', 'D-Avanzado']);
});

test('reconciliarNiveles: si cambió solo un nombre se conserva la descripción (con el nombre nuevo)', () => {
  const vieja = nivelesParaCantidad(5);
  const nueva = vieja.map((n, i) => (i === 2 ? { ...n, nombre: 'Aceptable' } : n));
  const [p] = reconciliarNiveles([preguntaCon(vieja)], nueva, vieja);
  assert.deepEqual(nombresDe(p.criterios[0]), ['Insuficiente', 'Básico', 'Aceptable', 'Avanzado', 'Excelente']);
  assert.deepEqual(descripciones(p.criterios[0]), ['D-Insuficiente', 'D-Básico', 'D-Intermedio', 'D-Avanzado', 'D-Excelente']);
  // Mientras se escribe el nombre (incluso vacío o a medias) la descripción tampoco se pierde.
  const aMedias = vieja.map((n, i) => (i === 2 ? { ...n, nombre: '' } : n));
  assert.equal(reconciliarNiveles([preguntaCon(vieja)], aMedias, vieja)[0].criterios[0].niveles[2].descripcion, 'D-Intermedio');
});

test('reconciliarNiveles: cambiar la cantidad de la escala por defecto alinea por nombre (3, 4, 6 y 7 niveles)', () => {
  const cinco = nivelesParaCantidad(5);
  const aTres = reconciliarNiveles([preguntaCon(cinco)], nivelesParaCantidad(3), cinco)[0].criterios[0];
  assert.deepEqual(nombresDe(aTres), ['Insuficiente', 'Adecuado', 'Excelente']);
  assert.deepEqual(descripciones(aTres), ['D-Insuficiente', '', 'D-Excelente']);

  const aSiete = reconciliarNiveles([preguntaCon(cinco)], nivelesParaCantidad(7), cinco)[0].criterios[0];
  assert.equal(aSiete.niveles.length, 7);
  assert.deepEqual(nombresDe(aSiete), nombres(nivelesParaCantidad(7)));
  // Insuficiente, Básico, Intermedio y Excelente están en las dos escalas; "Avanzado" no existe en la de 7.
  assert.deepEqual(descripciones(aSiete), ['D-Insuficiente', '', 'D-Básico', 'D-Intermedio', '', '', 'D-Excelente']);

  const tres = nivelesParaCantidad(3);
  const aCuatro = reconciliarNiveles([preguntaCon(tres)], nivelesParaCantidad(4), tres)[0].criterios[0];
  assert.deepEqual(descripciones(aCuatro), ['D-Insuficiente', '', '', 'D-Excelente']);
});

test('reconciliarNiveles: cada criterio de cada pregunta se arregla, y detallar y el resto de la pregunta quedan como estaban', () => {
  const vieja = nivelesParaCantidad(5);
  const nueva = agregarNivel(vieja);
  const sinDetalle = { ...criterioDescripto(vieja, 'Orden', false), niveles: vieja.map((n) => ({ orden: n.orden, nombre: n.nombre, descripcion: '' })) };
  const p1 = { ...preguntaCon(vieja, criterioDescripto(vieja, 'A'), sinDetalle), plegada: true, enunciado: 'Primera' };
  const p2 = preguntaCon(vieja, criterioDescripto(vieja, 'B'));
  const cerrada: PreguntaForm = { ...preguntaVacia(vieja), tipo: 'verdadero_falso', enunciado: 'V o F', puntajeMaximo: '1' };
  const [r1, r2, r3] = reconciliarNiveles([p1, p2, cerrada], nueva, vieja);
  for (const c of [...r1.criterios, ...r2.criterios, ...r3.criterios]) {
    assert.equal(c.niveles.length, 6);
    assert.deepEqual(nombresDe(c), nombres(nueva));
  }
  assert.deepEqual(r1.criterios.map((c) => c.detallar), [true, false]);
  assert.deepEqual(descripciones(r1.criterios[1]), ['', '', '', '', '', '']);
  assert.equal(r1.plegada, true);
  assert.equal(r1.enunciado, 'Primera');
  assert.equal(r1.criterios[0].nombre, 'A');
  assert.equal(r2.criterios[0].nombre, 'B');
  assert.equal(r1.criterios[0].niveles[4].descripcion, '');
  assert.equal(r1.criterios[0].niveles[5].descripcion, 'D-Excelente');
});

test('reconciliarNiveles: si solo cambió un porcentaje no toca nada (devuelve las mismas preguntas); idempotente y sin mutar', () => {
  const vieja = nivelesParaCantidad(5);
  const preguntas = [preguntaCon(vieja)];
  const soloPct = vieja.map((n, i) => (i === 1 ? { ...n, porcentaje: '20' } : n));
  assert.equal(reconciliarNiveles(preguntas, soloPct, vieja), preguntas);

  const nueva = agregarNivel(vieja);
  const una = reconciliarNiveles(preguntas, nueva, vieja);
  assert.equal(preguntas[0].criterios[0].niveles.length, 5); // no muta
  // Una segunda pasada con la misma escala ya no cambia nada.
  const dos = reconciliarNiveles(una, nueva, vieja);
  assert.deepEqual(dos, una);
  assert.equal(dos[0], una[0]);
  assert.equal(reconciliarNiveles(una, nueva)[0], una[0]); // sin `anteriores`: el criterio ya sigue la escala
});

test('reconciliarNiveles: sin `anteriores` usa los niveles del propio criterio como referencia', () => {
  const vieja = nivelesParaCantidad(5);
  const nueva = agregarNivel(vieja);
  const [p] = reconciliarNiveles([preguntaCon(vieja)], nueva);
  assert.deepEqual(descripciones(p.criterios[0]), ['D-Insuficiente', 'D-Básico', 'D-Intermedio', 'D-Avanzado', '', 'D-Excelente']);
  // Un criterio que ya sigue la escala (y un criterio nuevo y vacío) se devuelven tal cual.
  const ya = preguntaCon(nueva);
  assert.equal(reconciliarNiveles([ya], nueva)[0], ya);
});

test('reconciliarNiveles: un criterio que no seguía la escala (p. ej. de una matriz con otros nombres) toma la forma de la escala', () => {
  const escala = nivelesParaCantidad(3);
  const deMatriz: CriterioForm = {
    ...criterioVacio(nivelesParaCantidad(5)),
    nombre: 'De matriz',
    descripcion: 'x',
    peso: '2',
    detallar: true,
    niveles: ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco'].map((nombre, i) => ({ orden: i + 1, nombre, descripcion: `M-${nombre}` })),
  };
  const preguntas = [preguntaCon(escala, deMatriz)];
  // Si la escala no cambió (`anteriores` igual a la nueva) no se toca nada: reconciliar es una respuesta a un cambio de escala.
  assert.equal(reconciliarNiveles(preguntas, escala, escala), preguntas);
  // Sin `anteriores` (la red de seguridad antes de mandar el examen) el criterio sí toma la forma de la escala.
  const [p] = reconciliarNiveles(preguntas, escala);
  assert.equal(p.criterios[0].niveles.length, 3);
  assert.deepEqual(nombresDe(p.criterios[0]), nombres(escala));
  assert.equal(p.criterios[0].detallar, true);
  assert.equal(construirPregunta(p).criterios![0].nivelesDescripcion?.length ?? 3, 3);
});

test('reconciliarNiveles: todas las escalas de 3 a 7 dejan los criterios listos para el payload (nivelesDescripcion con N elementos)', () => {
  for (let desde = MIN_NIVELES; desde <= MAX_NIVELES; desde += 1) {
    for (let hasta = MIN_NIVELES; hasta <= MAX_NIVELES; hasta += 1) {
      const vieja = nivelesParaCantidad(desde);
      const nueva = nivelesParaCantidad(hasta);
      const [p] = reconciliarNiveles([preguntaCon(vieja)], nueva, vieja);
      const c = p.criterios[0];
      assert.equal(c.niveles.length, hasta, `${desde} -> ${hasta}`);
      assert.deepEqual(nombresDe(c), nombres(nueva), `${desde} -> ${hasta}`);
      // Si quedó algún nivel sin describir, el payload no manda detalle (el servidor acepta ausente o exactamente N).
      const payload = construirPregunta(p).criterios![0].nivelesDescripcion;
      assert.ok(payload === undefined || payload.length === hasta, `payload ${desde} -> ${hasta}`);
    }
  }
});

test('reconciliarNiveles + validarPregunta: tras agregar un nivel, un criterio detallado pide describir el nuevo', () => {
  const vieja = nivelesParaCantidad(5);
  const nueva = agregarNivel(vieja);
  const [p] = reconciliarNiveles([preguntaCon(vieja)], nueva, vieja);
  const errores = validarPregunta(p, 0);
  assert.equal(errores.length, 1);
  assert.match(errores[0], /Pregunta 1, criterio 1: describí los \d+ niveles o dejá el detalle vacío\./);
});

// ---------------------------------------------------------------------------
// 6. Duplicar un examen con 3 o 7 niveles (examenAFormulario)
// ---------------------------------------------------------------------------
function examenConNiveles(cantidad: number, opts: { detallado?: boolean; coloresPropios?: boolean } = {}): Examen {
  const escala = nivelesParaCantidad(cantidad);
  const niveles = escala.map((n) => ({
    orden: n.orden,
    nombre: n.nombre,
    colorHex: opts.coloresPropios ? '#123456' : n.colorHex,
    porcentaje: `${n.porcentaje}.00`,
  }));
  const nivelesDescripcion = opts.detallado ? escala.map((n) => ({ orden: n.orden, nombre: n.nombre, descripcion: `Detalle ${n.nombre}` })) : [];
  const abierta = {
    id: 'p1',
    tipo: 'desarrollo',
    enunciado: 'Explicá',
    orden: 0,
    puntajeMaximo: '10.00',
    opciones: null,
    criterios: [
      { id: 'k1', nombre: 'Claridad', descripcion: 'Qué se espera', puntajeMaximo: '6.00', orden: 0, matrizOrigenId: null, nivelesDescripcion },
      { id: 'k2', nombre: 'Rigor', descripcion: 'Qué se espera', puntajeMaximo: '4.00', orden: 1, matrizOrigenId: null, nivelesDescripcion: [] },
    ],
  } as unknown as Pregunta;
  return {
    id: 'e1',
    cursoId: 'c1',
    titulo: 'Parcial',
    consigna: 'Consigna',
    modalidad: 'ventana_dias',
    duracionMinutos: null,
    escalaMin: '0.00',
    escalaMax: '10.00',
    feedbackModo: 'manual',
    antiCheat: null,
    distribucionEsperada: null,
    niveles,
    preguntas: [abierta],
  } as unknown as Examen;
}

test('examenAFormulario: respeta la cantidad real de niveles del examen (3 y 7), con orden 1..N y colores por posición', () => {
  for (const cantidad of [3, 4, 6, 7]) {
    const form = examenAFormulario(examenConNiveles(cantidad));
    assert.equal(form.niveles.length, cantidad);
    assert.deepEqual(form.niveles, nivelesParaCantidad(cantidad));
    assertConsistente(form.niveles, `de ${cantidad}`);
    assert.deepEqual(validarNiveles(form.niveles), []);
    // Cada criterio queda con tantos niveles como la escala.
    for (const c of form.preguntas[0].criterios) {
      assert.equal(c.niveles.length, cantidad);
      assert.deepEqual(nombresDe(c), nombres(form.niveles));
    }
  }
});

test('examenAFormulario: los colores se calculan por posición aunque el examen guardado traiga otros', () => {
  const form = examenAFormulario(examenConNiveles(3, { coloresPropios: true }));
  assert.deepEqual(form.niveles.map((n) => n.colorHex), [0, 1, 2].map((i) => colorDeNivel(i, 3)));
});

test('examenAFormulario: el detalle por nivel de un criterio de 3 o 7 niveles se conserva (detallar) y vuelve a salir en el payload', () => {
  for (const cantidad of [3, 7]) {
    const form = examenAFormulario(examenConNiveles(cantidad, { detallado: true }));
    const [claridad, rigor] = form.preguntas[0].criterios;
    assert.equal(claridad.detallar, true);
    assert.deepEqual(descripciones(claridad), form.niveles.map((n) => `Detalle ${n.nombre}`));
    assert.equal(rigor.detallar, false);
    assert.deepEqual(descripciones(rigor), form.niveles.map(() => ''));
    const payload = construirPregunta(form.preguntas[0]);
    assert.equal(payload.criterios![0].nivelesDescripcion!.length, cantidad);
    assert.equal(payload.criterios![1].nivelesDescripcion, undefined);
    assert.deepEqual(validarPregunta(form.preguntas[0], 0), []);
  }
});

test('examenAFormulario: un detalle guardado con otra cantidad que la escala no se arrastra (el criterio queda con la forma de la escala)', () => {
  const examen = examenConNiveles(4);
  const abierta = examen.preguntas![0] as unknown as { criterios: { nivelesDescripcion: unknown }[] };
  abierta.criterios[0].nivelesDescripcion = nivelesParaCantidad(5).map((n) => ({ orden: n.orden, nombre: n.nombre, descripcion: 'x' }));
  const [claridad] = examenAFormulario(examen).preguntas[0].criterios;
  assert.equal(claridad.niveles.length, 4);
  assert.equal(claridad.detallar, false);
  assert.deepEqual(descripciones(claridad), ['', '', '', '']);
});

test('examenAFormulario: sin niveles guardados cae a la escala por defecto de 5', () => {
  const examen = examenConNiveles(5);
  (examen as unknown as { niveles: unknown[] }).niveles = [];
  const form = examenAFormulario(examen);
  assert.deepEqual(form.niveles, nivelesPorDefecto());
  assert.equal(form.preguntas[0].criterios[0].niveles.length, 5);
});
