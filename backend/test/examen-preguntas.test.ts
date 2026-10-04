// Tests de la lista de preguntas del wizard de "Nuevo examen" (frontend/lib/examen-preguntas.ts): reordenar y duplicar sin mutar,
// plegar y desplegar tarjetas, repartir los puntos en partes iguales (con la suma exacta), copiar una rúbrica a otras preguntas
// abiertas y ubicar qué preguntas nombran los errores de validación. Funciones puras: corren sin base de datos ni navegador.
//   node --require ts-node/register --test test/examen-preguntas.test.ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { TipoPregunta } from '../../frontend/lib/api';
import { criterioVacio, formatearPuntos, nivelesPorDefecto, preguntaVacia, puntosPorCriterio, redondearPuntos, totalCoincideConEscala, validarPregunta } from '../../frontend/lib/examen-form';
import type { CriterioForm, PreguntaForm } from '../../frontend/lib/examen-form';
import {
  agregarPreguntaPlegando,
  copiarRubricaA,
  desplegarPreguntas,
  duplicarPregunta,
  esPreguntaAbierta,
  etiquetaPuntos,
  hayPuntosCargados,
  indicesConError,
  moverPregunta,
  plegarCompletas,
  repartirPuntos,
  resumenEnunciado,
  tieneCriteriosCargados,
} from '../../frontend/lib/examen-preguntas';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const NIVELES = nivelesPorDefecto();

const criterio = (nombre: string, peso: string, detalle = false): CriterioForm => ({
  ...criterioVacio(NIVELES),
  nombre,
  descripcion: `Qué se espera de ${nombre}`,
  peso,
  detallar: detalle,
  niveles: NIVELES.map((n) => ({ orden: n.orden, nombre: n.nombre, descripcion: detalle ? `${nombre}: ${n.nombre}` : '' })),
});
/** Pregunta abierta completa (válida). */
const abierta = (enunciado: string, puntaje: string, criterios: CriterioForm[] = [criterio('Claridad', '1')]): PreguntaForm => ({
  ...preguntaVacia(NIVELES),
  tipo: 'desarrollo',
  enunciado,
  puntajeMaximo: puntaje,
  criterios,
});
/** Pregunta cerrada completa (válida). */
const cerrada = (enunciado: string, puntaje: string): PreguntaForm => ({
  ...preguntaVacia(NIVELES),
  tipo: 'verdadero_falso',
  enunciado,
  puntajeMaximo: puntaje,
});
/** Pregunta incompleta (sin enunciado ni puntos). */
const incompleta = (): PreguntaForm => preguntaVacia(NIVELES);
const enunciados = (lista: PreguntaForm[]) => lista.map((q) => q.enunciado);

/** Generador determinístico para no depender del azar. */
function generador(semilla: number) {
  let s = semilla;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const centesimas = (xs: string[]) => xs.reduce((acc, x) => acc + Math.round(Number(x) * 100), 0);

// ---------------------------------------------------------------------------
// 1. moverPregunta
// ---------------------------------------------------------------------------
test('moverPregunta: sube y baja una posición, y devuelve una lista nueva sin mutar la original', () => {
  const lista = ['a', 'b', 'c', 'd'];
  const copia = [...lista];
  assert.deepEqual(moverPregunta(lista, 2, -1), ['a', 'c', 'b', 'd']);
  assert.deepEqual(moverPregunta(lista, 1, 1), ['a', 'c', 'b', 'd']);
  assert.deepEqual(moverPregunta(lista, 0, 1), ['b', 'a', 'c', 'd']);
  assert.deepEqual(moverPregunta(lista, 3, -1), ['a', 'b', 'd', 'c']);
  assert.deepEqual(lista, copia, 'la lista original no cambia');
  assert.notEqual(moverPregunta(lista, 2, -1), lista);
});

test('moverPregunta: la primera no sube y la última no baja (copia sin cambios), igual que un índice o un delta inválidos', () => {
  const lista = ['a', 'b', 'c'];
  assert.deepEqual(moverPregunta(lista, 0, -1), lista);
  assert.deepEqual(moverPregunta(lista, 2, 1), lista);
  assert.deepEqual(moverPregunta(lista, 1, 0), lista);
  assert.deepEqual(moverPregunta(lista, -1, 1), lista);
  assert.deepEqual(moverPregunta(lista, 3, -1), lista);
  assert.deepEqual(moverPregunta(lista, 0.5, 1), lista);
  assert.deepEqual(moverPregunta([], 0, 1), []);
  assert.deepEqual(moverPregunta(['x'], 0, -1), ['x']);
  assert.notEqual(moverPregunta(lista, 0, -1), lista, 'también en el caso sin cambios es una lista nueva');
});

test('moverPregunta: mueve las MISMAS preguntas (no las copia) y conserva su contenido', () => {
  const a = abierta('A', '2');
  const b = cerrada('B', '3');
  const c = abierta('C', '5');
  const movida = moverPregunta([a, b, c], 2, -2);
  assert.deepEqual(enunciados(movida), ['C', 'A', 'B']);
  assert.equal(movida[0], c);
  assert.equal(movida[1], a);
  assert.equal(movida[2], b);
});

test('moverPregunta: subir y volver a bajar deja el orden original (cualquier posición)', () => {
  const lista = ['a', 'b', 'c', 'd', 'e'];
  for (let i = 1; i < lista.length; i += 1) {
    assert.deepEqual(moverPregunta(moverPregunta(lista, i, -1), i - 1, 1), lista);
  }
});

// ---------------------------------------------------------------------------
// 2. duplicarPregunta
// ---------------------------------------------------------------------------
test('duplicarPregunta: la copia queda justo debajo, desplegada, con el mismo contenido', () => {
  const lista = [{ ...abierta('A', '4', [criterio('Claridad', '1', true), criterio('Fuentes', '2')]), plegada: true }, cerrada('B', '3')];
  const resultado = duplicarPregunta(lista, 0);
  assert.equal(resultado.length, 3);
  assert.deepEqual(enunciados(resultado), ['A', 'A', 'B']);
  assert.equal(resultado[1].plegada, false, 'la copia queda desplegada');
  assert.equal(resultado[0].plegada, true, 'la original conserva su estado');
  assert.deepEqual({ ...resultado[1], plegada: true }, resultado[0], 'mismo contenido, salvo que está desplegada');
  assert.equal(resultado[2], lista[1], 'las demás no se tocan');
});

test('duplicarPregunta: es una copia profunda (nueva identidad, ninguna referencia compartida) y no muta la lista', () => {
  const original = abierta('A', '4', [criterio('Claridad', '1', true), criterio('Fuentes', '2')]);
  const lista = [original];
  const antes = JSON.parse(JSON.stringify(lista));
  const copia = duplicarPregunta(lista, 0)[1];

  assert.notEqual(copia, original);
  assert.notEqual(copia.criterios, original.criterios);
  assert.notEqual(copia.criterios[0], original.criterios[0]);
  assert.notEqual(copia.criterios[0].niveles, original.criterios[0].niveles);
  assert.notEqual(copia.criterios[0].niveles[0], original.criterios[0].niveles[0]);
  assert.notEqual(copia.opcionesChoice, original.opcionesChoice);
  assert.notEqual(copia.opcionesChoice[0], original.opcionesChoice[0]);
  assert.notEqual(copia.paresIzquierda, original.paresIzquierda);
  assert.notEqual(copia.paresDerecha, original.paresDerecha);

  // Editar la copia no toca la original.
  copia.criterios[0].niveles[0].descripcion = 'cambiado';
  copia.criterios[1].nombre = 'otro';
  copia.opcionesChoice[0].texto = 'otro';
  copia.paresIzquierda[0] = 'otro';
  assert.deepEqual(JSON.parse(JSON.stringify(lista)), antes, 'la original quedó intacta');
});

test('duplicarPregunta: conserva los campos opcionales (matrizOrigenId) y funciona en cualquier posición', () => {
  const conMatriz: CriterioForm = { ...criterio('Claridad', '1'), matrizOrigenId: 'm1' };
  const lista = [cerrada('A', '1'), abierta('B', '2', [conMatriz]), cerrada('C', '3')];
  const resultado = duplicarPregunta(lista, 1);
  assert.deepEqual(enunciados(resultado), ['A', 'B', 'B', 'C']);
  assert.equal(resultado[2].criterios[0].matrizOrigenId, 'm1');
  assert.deepEqual(enunciados(duplicarPregunta(lista, 2)), ['A', 'B', 'C', 'C'], 'duplicar la última la deja al final');
});

test('duplicarPregunta: con un índice que no existe devuelve una copia sin cambios', () => {
  const lista = [cerrada('A', '1')];
  for (const i of [-1, 1, 5, 0.5, NaN]) assert.deepEqual(duplicarPregunta(lista, i), lista, `indice ${i}`);
  assert.deepEqual(duplicarPregunta([], 0), []);
});

// ---------------------------------------------------------------------------
// 3. plegar y desplegar
// ---------------------------------------------------------------------------
test('plegarCompletas: pliega solo las preguntas sin errores y no muta', () => {
  const lista = [abierta('A', '2'), incompleta(), cerrada('C', '3'), cerrada('', '1')];
  const antes = JSON.parse(JSON.stringify(lista));
  const resultado = plegarCompletas(lista);
  assert.deepEqual(resultado.map((q) => q.plegada), [true, false, true, false]);
  assert.deepEqual(JSON.parse(JSON.stringify(lista)), antes);
  // Una incompleta que ya estaba plegada sigue plegada.
  assert.equal(plegarCompletas([{ ...incompleta(), plegada: true }])[0].plegada, true);
});

test('agregarPreguntaPlegando: agrega al final desplegada y pliega las demás que estén completas', () => {
  const lista = [abierta('A', '2'), incompleta(), cerrada('C', '3')];
  const nueva = { ...preguntaVacia(NIVELES), tipo: 'numerica' as TipoPregunta, plegada: true };
  const resultado = agregarPreguntaPlegando(lista, nueva);
  assert.equal(resultado.length, 4);
  assert.deepEqual(resultado.map((q) => q.plegada), [true, false, true, false], 'las completas se pliegan; la incompleta y la nueva no');
  assert.equal(resultado[3].tipo, 'numerica');
  assert.equal(lista.length, 3, 'no muta');
  assert.equal(lista[0].plegada, false);
});

test('desplegarPreguntas: despliega solo los índices pedidos y devuelve la misma lista si no hay nada que hacer', () => {
  const lista = [1, 2, 3, 4].map((n) => ({ ...cerrada(`P${n}`, '1'), plegada: true }));
  const resultado = desplegarPreguntas(lista, [1, 3]);
  assert.deepEqual(resultado.map((q) => q.plegada), [true, false, true, false]);
  assert.deepEqual(lista.map((q) => q.plegada), [true, true, true, true], 'no muta');
  assert.equal(resultado[0], lista[0], 'las que no cambian conservan su identidad');

  const yaDesplegadas = [cerrada('A', '1'), cerrada('B', '1')];
  assert.equal(desplegarPreguntas(yaDesplegadas, [0, 1]), yaDesplegadas);
  assert.equal(desplegarPreguntas(lista, []), lista);
  assert.equal(desplegarPreguntas(lista, [9, -1]), lista, 'índices fuera de la lista no hacen nada');
});

test('resumenEnunciado y etiquetaPuntos: lo que muestra la fila plegada', () => {
  assert.equal(resumenEnunciado('  Explicá   qué es\n una cola\t de prioridad.  '), 'Explicá qué es una cola de prioridad.');
  assert.equal(resumenEnunciado('   \n '), '');
  assert.equal(etiquetaPuntos(cerrada('A', '1.5')), '1,5 pts');
  assert.equal(etiquetaPuntos(cerrada('A', '10')), '10 pts');
  assert.equal(etiquetaPuntos(cerrada('A', '3.33')), '3,33 pts');
  for (const puntaje of ['', '  ', 'abc', '0', '-2']) assert.equal(etiquetaPuntos(cerrada('A', puntaje)), 'sin puntos', `puntaje "${puntaje}"`);
});

// ---------------------------------------------------------------------------
// 4. repartirPuntos
// ---------------------------------------------------------------------------
test('repartirPuntos: 10 entre 3 da 3,33 / 3,33 / 3,34 (el resto lo absorbe la última)', () => {
  assert.deepEqual(repartirPuntos(3, 10), ['3.33', '3.33', '3.34']);
  assert.deepEqual(repartirPuntos(7, 10), ['1.42', '1.42', '1.42', '1.42', '1.42', '1.42', '1.48']);
  assert.deepEqual(repartirPuntos(6, 10), ['1.66', '1.66', '1.66', '1.66', '1.66', '1.7']);
});

test('repartirPuntos: reparto parejo cuando divide exacto, y una sola pregunta se lleva todo', () => {
  assert.deepEqual(repartirPuntos(4, 10), ['2.5', '2.5', '2.5', '2.5']);
  assert.deepEqual(repartirPuntos(5, 10), ['2', '2', '2', '2', '2']);
  assert.deepEqual(repartirPuntos(1, 10), ['10']);
  assert.deepEqual(repartirPuntos(1, 7.25), ['7.25']);
  assert.deepEqual(repartirPuntos(2, 7), ['3.5', '3.5']);
});

test('repartirPuntos: totales con decimales', () => {
  assert.deepEqual(repartirPuntos(4, 10.5), ['2.62', '2.62', '2.62', '2.64']);
  assert.deepEqual(repartirPuntos(3, 7.1), ['2.36', '2.36', '2.38']);
  assert.deepEqual(repartirPuntos(2, 0.03), ['0.01', '0.02']);
  // Ruido de coma flotante: 0,1 + 0,2 y compañía no se cuelan en el reparto.
  assert.deepEqual(repartirPuntos(3, 0.3), ['0.1', '0.1', '0.1']);
  assert.deepEqual(repartirPuntos(1, 4.35), ['4.35']);
});

test('repartirPuntos: sin nada que repartir devuelve []', () => {
  for (const cantidad of [0, -1, 1.5, NaN, Infinity]) assert.deepEqual(repartirPuntos(cantidad, 10), [], `cantidad ${cantidad}`);
  for (const total of [0, -3, NaN, Infinity, -Infinity, 0.004]) assert.deepEqual(repartirPuntos(3, total), [], `total ${total}`);
});

test('repartirPuntos: con menos de un centésimo por pregunta las primeras quedan en 0 y la suma sigue exacta', () => {
  const reparto = repartirPuntos(10, 0.05);
  assert.deepEqual(reparto, ['0', '0', '0', '0', '0', '0', '0', '0', '0', '0.05']);
  assert.equal(centesimas(reparto), 5);
});

test('repartirPuntos: 500 casos aleatorios (1 a 30 preguntas, totales con decimales): la suma es EXACTA y el reparto es parejo', () => {
  const azar = generador(20240607);
  for (let vuelta = 0; vuelta < 500; vuelta += 1) {
    const cantidad = 1 + Math.floor(azar() * 30);
    const total = redondearPuntos(1 + azar() * 99); // con hasta 2 decimales
    const reparto = repartirPuntos(cantidad, total);
    const detalle = `cantidad=${cantidad} total=${total} -> ${reparto.join(' / ')}`;

    assert.equal(reparto.length, cantidad, detalle);
    assert.equal(centesimas(reparto), Math.round(total * 100), `la suma en centésimas: ${detalle}`);
    assert.ok(totalCoincideConEscala(reparto.reduce((s, x) => s + Number(x), 0), total), `el examen coincide con la escala: ${detalle}`);

    // Todas las partes tienen a lo sumo 2 decimales, son números válidos > 0 y las primeras son iguales entre sí.
    for (const parte of reparto) {
      assert.match(parte, /^\d+(\.\d{1,2})?$/, detalle);
      assert.ok(Number(parte) > 0, detalle);
    }
    const primeras = reparto.slice(0, -1);
    assert.ok(primeras.every((x) => x === reparto[0]), `las primeras son iguales: ${detalle}`);
    // La última se lleva el resto: nunca menos que las demás, y menos de `cantidad` centésimas de diferencia.
    const dif = Math.round(Number(reparto[cantidad - 1]) * 100) - Math.round(Number(reparto[0]) * 100);
    assert.ok(dif >= 0 && dif < cantidad, `diferencia de la última ${dif}: ${detalle}`);
  }
});

test('repartirPuntos: lo que se muestra con formatearPuntos es lo mismo que se guarda (sin ceros de más)', () => {
  assert.deepEqual(repartirPuntos(3, 10).map((x) => formatearPuntos(Number(x))), ['3,33', '3,33', '3,34']);
  assert.deepEqual(repartirPuntos(4, 10).map((x) => formatearPuntos(Number(x))), ['2,5', '2,5', '2,5', '2,5']);
});

test('repartirPuntos: cada pregunta abierta reparte SUS puntos entre sus criterios y la suma de la pregunta sigue exacta', () => {
  const reparto = repartirPuntos(3, 10);
  const preguntas = reparto.map((puntos) => abierta('A', puntos, [criterio('Claridad', '1'), criterio('Fuentes', '1'), criterio('Estilo', '1')]));
  for (const q of preguntas) {
    assert.equal(redondearPuntos(puntosPorCriterio(q).reduce((s, x) => s + x, 0)), redondearPuntos(Number(q.puntajeMaximo)));
  }
});

test('hayPuntosCargados: avisa si algún puntaje ya tiene algo escrito', () => {
  assert.equal(hayPuntosCargados([cerrada('A', ''), abierta('B', '  ')]), false);
  assert.equal(hayPuntosCargados([cerrada('A', ''), abierta('B', '2')]), true);
  assert.equal(hayPuntosCargados([cerrada('A', '0')]), true);
  assert.equal(hayPuntosCargados([]), false);
});

// ---------------------------------------------------------------------------
// 5. copiarRubricaA
// ---------------------------------------------------------------------------
test('tieneCriteriosCargados: una fila en blanco no cuenta, con algo escrito sí', () => {
  assert.equal(tieneCriteriosCargados(incompleta()), false);
  assert.equal(tieneCriteriosCargados({ ...incompleta(), criterios: [] }), false);
  assert.equal(tieneCriteriosCargados({ ...incompleta(), criterios: [{ ...criterioVacio(NIVELES), nombre: ' x ' }] }), true);
  assert.equal(tieneCriteriosCargados({ ...incompleta(), criterios: [{ ...criterioVacio(NIVELES), peso: '2' }] }), true);
  assert.equal(tieneCriteriosCargados(abierta('A', '2')), true);
});

test('copiarRubricaA: copia nombre, descripción, peso y detalle de niveles, y conserva los puntos propios del destino', () => {
  const origen = abierta('O', '6', [{ ...criterio('Claridad', '3', true), matrizOrigenId: 'm1' }, criterio('Fuentes', '1')]);
  const destino = { ...abierta('D', '10', [criterio('Otro', '5')]), plegada: true };
  const antesOrigen = JSON.parse(JSON.stringify(origen));
  const antesDestino = JSON.parse(JSON.stringify(destino));

  const resultado = copiarRubricaA(origen, destino);
  assert.deepEqual(resultado.criterios, origen.criterios, 'mismos criterios (nombre, descripción, peso, niveles, matriz)');
  assert.equal(resultado.puntajeMaximo, '10', 'los puntos de la pregunta destino no cambian');
  assert.equal(resultado.enunciado, 'D');
  assert.equal(resultado.plegada, true, 'conserva si estaba plegada');
  assert.deepEqual(JSON.parse(JSON.stringify(origen)), antesOrigen, 'el origen no se muta');
  assert.deepEqual(JSON.parse(JSON.stringify(destino)), antesDestino, 'el destino no se muta');

  // Con sus propios puntos: 10 repartidos 3:1.
  assert.deepEqual(puntosPorCriterio(resultado), [7.5, 2.5]);
});

test('copiarRubricaA: la copia es profunda (editar los criterios del destino no toca los del origen)', () => {
  const origen = abierta('O', '6', [criterio('Claridad', '3', true)]);
  const resultado = copiarRubricaA(origen, abierta('D', '4', []));
  assert.notEqual(resultado.criterios, origen.criterios);
  assert.notEqual(resultado.criterios[0], origen.criterios[0]);
  assert.notEqual(resultado.criterios[0].niveles, origen.criterios[0].niveles);
  assert.notEqual(resultado.criterios[0].niveles[0], origen.criterios[0].niveles[0]);
  resultado.criterios[0].nombre = 'cambiado';
  resultado.criterios[0].niveles[0].descripcion = 'cambiado';
  assert.equal(origen.criterios[0].nombre, 'Claridad');
  assert.equal(origen.criterios[0].niveles[0].descripcion, 'Claridad: Insuficiente');
});

test('copiarRubricaA: sirve con cualquier tipo de pregunta abierta y deja las cerradas como están', () => {
  const origen = abierta('O', '6', [criterio('Claridad', '3')]);
  for (const tipo of ['resolucion_problema', 'demostracion', 'analisis_caso', 'respuesta_corta'] as TipoPregunta[]) {
    const destino: PreguntaForm = { ...abierta('D', '2', []), tipo };
    assert.equal(esPreguntaAbierta(destino), true);
    assert.deepEqual(copiarRubricaA(origen, destino).criterios, origen.criterios, tipo);
  }
  const cerr = cerrada('C', '3');
  assert.equal(copiarRubricaA(origen, cerr), cerr, 'una cerrada no tiene rúbrica');
  assert.equal(esPreguntaAbierta(cerr), false);
});

// ---------------------------------------------------------------------------
// 6. indicesConError
// ---------------------------------------------------------------------------
test('indicesConError: extrae los índices (base 0) de las preguntas que nombran los mensajes', () => {
  assert.deepEqual(indicesConError(['Pregunta 3: falta el enunciado.']), [2]);
  assert.deepEqual(indicesConError(['Pregunta 1: falta el enunciado.', 'Pregunta 4: falta el puntaje máximo.']), [0, 3]);
  assert.deepEqual(indicesConError(['Pregunta 2, criterio 1: falta el peso.']), [1], 'también los mensajes de un criterio');
  assert.deepEqual(indicesConError(['Pregunta 10: falta el enunciado.', 'Pregunta 12, criterio 3: falta el nombre.']), [9, 11], 'números de dos dígitos enteros');
});

test('indicesConError: sin repetir, en orden y ignorando los mensajes que no apuntan a una pregunta', () => {
  assert.deepEqual(
    indicesConError([
      'Pregunta 5: falta el enunciado.',
      'Pregunta 2: falta el enunciado.',
      'Pregunta 5: falta el puntaje máximo.',
      'Pregunta 2, criterio 1: falta el nombre.',
    ]),
    [1, 4],
  );
  assert.deepEqual(
    indicesConError([
      'El total de puntos de las preguntas (7) tiene que ser igual a la escala máxima (10).',
      'No se pudo crear el examen. Tus datos siguen acá.',
      'Detalle: Pregunta 3 inválida',
      'La pregunta 2 está mal',
      'Pregunta sin número',
      'Pregunta 0: raro',
      'Preguntas 3: raro',
      'Pregunta 3x: raro',
      '',
    ]),
    [],
  );
  assert.deepEqual(indicesConError([]), []);
});

test('indicesConError: coincide con los mensajes reales de validarPregunta sobre una lista', () => {
  const lista = [abierta('A', '2'), incompleta(), cerrada('C', '3'), { ...abierta('D', '', []), criterios: [{ ...criterioVacio(NIVELES), nombre: 'X' }] }];
  const errores = lista.flatMap((q, i) => validarPregunta(q, i));
  assert.deepEqual(indicesConError(errores), [1, 3]);
});
