// Tests del editor de rúbrica del wizard de "Nuevo examen" (frontend/lib/examen-form.ts, zona de criterios y matrices): guardar los
// criterios como matriz, usar una matriz (con y sin detalle por nivel), mapear una sugerencia de la IA, el detalle por nivel
// (resumen y validación), los puntos muy chicos y los mensajes de error en castellano. Funciones puras: corren sin base de datos
// ni navegador.
//   node --require ts-node/register --test test/rubrica.test.ts   (o `npm test`, una vez agregado al script)
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ApiError } from '../../frontend/lib/api';
import type { CriterioSugerido, MatrizRubrica, createMatrizRubrica } from '../../frontend/lib/api';
import {
  aplicarMatriz,
  construirPregunta,
  criterioVacio,
  criteriosDeSugerencia,
  criteriosParaMatriz,
  estadoDetalle,
  mensajeErrorMatriz,
  mensajeErrorSugerencia,
  nivelesPorDefecto,
  pesosEnPorcentaje,
  preguntaVacia,
  puntosPorCriterio,
  redondearPuntos,
  resumenDetalle,
  tieneCriteriosCargados,
  validarPregunta,
} from '../../frontend/lib/examen-form';
import type { CriterioForm, NivelForm, PreguntaForm } from '../../frontend/lib/examen-form';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const NIVELES = nivelesPorDefecto();
/** Escala de 3 niveles, para probar que el detalle de 5 no se usa donde no coincide. */
const NIVELES_3: NivelForm[] = [
  { orden: 1, nombre: 'Bajo', colorHex: '#c0392b', porcentaje: '0' },
  { orden: 2, nombre: 'Medio', colorHex: '#c9a227', porcentaje: '50' },
  { orden: 3, nombre: 'Alto', colorHex: '#1a7f4e', porcentaje: '100' },
];

const descritos = (niveles: NivelForm[], prefijo = 'Detalle') => niveles.map((n) => ({ orden: n.orden, nombre: n.nombre, descripcion: `${prefijo} ${n.nombre}` }));

/** Criterio completo (nombre, qué se espera y peso); con `detalle` trae todos sus niveles descritos. */
const criterio = (peso: string, nombre = 'Criterio', detalle = false, niveles = NIVELES): CriterioForm => ({
  ...criterioVacio(niveles),
  nombre,
  descripcion: `Qué se espera de ${nombre}`,
  peso,
  detallar: detalle,
  niveles: detalle ? descritos(niveles) : criterioVacio(niveles).niveles,
});

/** Pregunta abierta con los puntos `puntaje` y un criterio completo por cada peso. */
const abierta = (puntaje: string, pesos: string[], detalle = false): PreguntaForm => ({
  ...preguntaVacia(NIVELES),
  tipo: 'desarrollo',
  enunciado: 'Explicá',
  puntajeMaximo: puntaje,
  criterios: pesos.map((w, i) => criterio(w, `Criterio ${i + 1}`, detalle)),
});

const matriz = (criterios: { peso: string; niveles: { orden: number; nombre: string; descripcion: string }[] }[]): MatrizRubrica =>
  ({
    id: 'm1',
    docenteId: 'd1',
    nombre: 'Rúbrica de ensayo',
    descripcion: null,
    createdAt: '2026-01-01',
    criterios: criterios.map((c, i) => ({ id: `k${i}`, nombre: `Matriz ${i + 1}`, descripcion: `Qué se espera ${i + 1}`, puntajeMaximo: c.peso, orden: i, nivelesDescripcion: c.niveles })),
  }) as MatrizRubrica;

const NIVELES_5_MATRIZ = descritos(NIVELES, 'Matriz');
const suma = (xs: number[]) => redondearPuntos(xs.reduce((s, x) => s + x, 0));

// ---------------------------------------------------------------------------
// 1. Puntos chicos: puntosPorCriterio nunca da negativos y validarPregunta lo avisa
// ---------------------------------------------------------------------------
test('puntosPorCriterio: con P muy chico para tantos criterios ninguno da negativo (0,04 entre 7)', () => {
  const puntos = puntosPorCriterio(abierta('0.04', ['1', '1', '1', '1', '1', '1', '1']));
  assert.equal(puntos.length, 7);
  assert.ok(puntos.every((x) => x >= 0), `ninguno negativo: ${puntos.join(',')}`);
  assert.deepEqual(puntos, [0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0]); // el último absorbe el ajuste, y queda en 0
});

test('puntosPorCriterio: nunca negativo con P y pesos chicos al azar; y los repartos normales siguen sumando exactamente P', () => {
  let semilla = 987654;
  const azar = () => {
    semilla = (semilla * 1664525 + 1013904223) % 4294967296;
    return semilla / 4294967296;
  };
  for (let vuelta = 0; vuelta < 500; vuelta += 1) {
    const puntaje = redondearPuntos(0.01 + azar() * 0.3);
    const cantidad = 1 + Math.floor(azar() * 12);
    const pesos = Array.from({ length: cantidad }, () => String(redondearPuntos(0.1 + azar() * 9)));
    const puntos = puntosPorCriterio(abierta(String(puntaje), pesos));
    assert.ok(puntos.every((x) => x >= 0), `P=${puntaje} pesos=${pesos.join(',')} -> ${puntos.join(',')}`);
  }
  // Con puntos suficientes no cambia nada.
  assert.deepEqual(puntosPorCriterio(abierta('10', ['1', '1', '1'])), [3.33, 3.33, 3.34]);
  assert.equal(suma(puntosPorCriterio(abierta('0.1', ['1', '1', '1']))), 0.1);
});

test('validarPregunta: avisa cuando los puntos son muy pocos para repartirlos entre K criterios', () => {
  const siete = validarPregunta(abierta('0.04', ['1', '1', '1', '1', '1', '1', '1']), 0);
  assert.deepEqual(siete, ['Pregunta 1: los puntos son muy pocos para repartirlos entre 7 criterios.']);

  // El número de pregunta y la cantidad de criterios salen de la pregunta.
  assert.deepEqual(validarPregunta(abierta('0.01', ['1', '1', '1']), 3), ['Pregunta 4: los puntos son muy pocos para repartirlos entre 3 criterios.']);

  // Un peso desproporcionado también deja a un criterio en 0.
  assert.match(validarPregunta(abierta('10', ['1000', '0.001']), 0)[0], /los puntos son muy pocos para repartirlos entre 2 criterios/);
});

test('validarPregunta: no avisa de puntos chicos si alcanzan, si no hay puntos (ya falta el puntaje) ni cuenta los criterios sin peso o en blanco', () => {
  assert.deepEqual(validarPregunta(abierta('0.04', ['1', '1']), 0), []); // 0,02 + 0,02
  assert.deepEqual(validarPregunta(abierta('10', ['1', '1', '1']), 0), []);
  assert.deepEqual(validarPregunta(abierta('', ['1', '1']), 0), ['Pregunta 1: falta el puntaje de la pregunta.']);

  // Un criterio en blanco no cuenta entre los K; uno con peso 0 se marca como falta de peso, no como "puntos chicos".
  const conBlanco = abierta('0.04', ['1', '1']);
  conBlanco.criterios.push(criterioVacio(NIVELES));
  assert.deepEqual(validarPregunta(conBlanco, 0), []);
});

// ---------------------------------------------------------------------------
// 2. Detalle por nivel: estado, resumen y validación
// ---------------------------------------------------------------------------
const conDescritos = (c: CriterioForm, cuantos: number): CriterioForm => ({
  ...c,
  niveles: c.niveles.map((n, i) => (i < cuantos ? { ...n, descripcion: `desc ${i + 1}` } : n)),
});

test('estadoDetalle y resumenDetalle: sin detallar, completo y a medias (este, marcado como incompleto)', () => {
  const base = criterio('1');
  assert.deepEqual(estadoDetalle(base), { descritos: 0, total: 5, vacio: true, completo: false, incompleto: false });
  assert.deepEqual(resumenDetalle(base), { texto: 'sin detallar', incompleto: false });

  assert.deepEqual(resumenDetalle(conDescritos(base, 5)), { texto: '5 niveles descritos ✓', incompleto: false });
  assert.deepEqual(resumenDetalle(conDescritos(base, 3)), { texto: '3 de 5 niveles descritos', incompleto: true });
  assert.equal(estadoDetalle(conDescritos(base, 3)).incompleto, true);

  // Una descripción de puros espacios no cuenta; sin niveles tampoco hay detalle.
  const espacios = { ...base, niveles: base.niveles.map((n) => ({ ...n, descripcion: '   ' })) };
  assert.equal(resumenDetalle(espacios).texto, 'sin detallar');
  assert.deepEqual(resumenDetalle({ ...base, niveles: [] }), { texto: 'sin detallar', incompleto: false });
  // La cantidad sale de los niveles del criterio (escala de 3).
  assert.equal(resumenDetalle(conDescritos(criterio('1', 'x', false, NIVELES_3), 3)).texto, '3 niveles descritos ✓');
});

test('validarPregunta: un detalle por nivel a medias es un error aunque el acordeón esté plegado (detallar no importa)', () => {
  const p = abierta('10', ['1', '1']);
  p.criterios[1] = { ...conDescritos(p.criterios[1], 2), detallar: false };
  assert.deepEqual(validarPregunta(p, 0), ['Pregunta 1, criterio 2: describí los 5 niveles o dejá el detalle vacío.']);
  p.criterios[1] = { ...p.criterios[1], detallar: true };
  assert.equal(validarPregunta(p, 0).length, 1);

  // Completo o vacío está bien.
  assert.deepEqual(validarPregunta(abierta('10', ['1', '1'], true), 0), []);
  assert.deepEqual(validarPregunta(abierta('10', ['1', '1'], false), 0), []);
  // La cantidad del mensaje sigue la escala.
  const tres = { ...abierta('10', ['1']), criterios: [conDescritos(criterio('1', 'C', false, NIVELES_3), 1)] };
  assert.deepEqual(validarPregunta(tres, 0), ['Pregunta 1, criterio 1: describí los 3 niveles o dejá el detalle vacío.']);
});

test('tieneCriteriosCargados: una pregunta recién creada no tiene; con cualquier dato en un criterio, sí', () => {
  assert.equal(tieneCriteriosCargados(preguntaVacia(NIVELES)), false);
  assert.equal(tieneCriteriosCargados(abierta('', [''])), true); // el criterio tiene nombre
  const soloPeso = preguntaVacia(NIVELES);
  soloPeso.criterios[0].peso = '3';
  assert.equal(tieneCriteriosCargados(soloPeso), true);
  const soloNivel = preguntaVacia(NIVELES);
  soloNivel.criterios[0] = conDescritos(soloNivel.criterios[0], 1);
  assert.equal(tieneCriteriosCargados(soloNivel), true);
});

// ---------------------------------------------------------------------------
// 3. aplicarMatriz: el detalle por nivel de la matriz es opcional
// ---------------------------------------------------------------------------
test('aplicarMatriz: una matriz con [] en nivelesDescripcion NO marca detallar y deja los niveles vacíos (con y sin escala del examen)', () => {
  const sinNiveles = matriz([{ peso: '5', niveles: [] }, { peso: '5', niveles: [] }]);

  const sinEscala = aplicarMatriz(abierta('', ['']), sinNiveles);
  assert.ok(sinEscala.criterios.every((c) => c.detallar === false));
  assert.ok(sinEscala.criterios.every((c) => c.niveles.length === 5 && c.niveles.every((n) => n.descripcion === '')));
  assert.equal(sinEscala.puntajeMaximo, '10');

  const conEscala = aplicarMatriz(abierta('', ['']), sinNiveles, NIVELES_3);
  assert.ok(conEscala.criterios.every((c) => c.detallar === false));
  assert.deepEqual(
    conEscala.criterios[0].niveles,
    NIVELES_3.map((n) => ({ orden: n.orden, nombre: n.nombre, descripcion: '' })),
  );
  // Esos niveles vacíos no se mandan como detalle.
  assert.ok(construirPregunta(conEscala).criterios!.every((c) => c.nivelesDescripcion === undefined));
});

test('aplicarMatriz: sin nivelesExamen usa el detalle de la matriz tal cual (como siempre); con matriz sin detalle de un criterio y con detalle de otro, cada uno por su lado', () => {
  const resultado = aplicarMatriz(abierta('', ['']), matriz([{ peso: '6', niveles: NIVELES_5_MATRIZ }, { peso: '4', niveles: [] }]));
  assert.equal(resultado.criterios[0].detallar, true);
  assert.deepEqual(resultado.criterios[0].niveles, NIVELES_5_MATRIZ);
  assert.equal(resultado.criterios[1].detallar, false);
  assert.ok(resultado.criterios[1].niveles.every((n) => n.descripcion === ''));
  assert.ok(resultado.criterios.every((c) => c.matrizOrigenId === 'm1'));
});

test('aplicarMatriz: con nivelesExamen y la misma cantidad usa las descripciones con los NOMBRES de nivel del examen', () => {
  const escala = nivelesPorDefecto().map((n, i) => ({ ...n, nombre: `Nivel ${i + 1}` }));
  const resultado = aplicarMatriz(abierta('10', ['']), matriz([{ peso: '1', niveles: NIVELES_5_MATRIZ }]), escala);
  const c = resultado.criterios[0];
  assert.equal(c.detallar, true);
  assert.deepEqual(c.niveles.map((n) => n.nombre), ['Nivel 1', 'Nivel 2', 'Nivel 3', 'Nivel 4', 'Nivel 5']);
  assert.deepEqual(c.niveles.map((n) => n.descripcion), NIVELES_5_MATRIZ.map((n) => n.descripcion));
  assert.deepEqual(c.niveles.map((n) => n.orden), [1, 2, 3, 4, 5]);

  // También con una escala de 3 niveles y una matriz de 3 descripciones.
  const tres = aplicarMatriz(abierta('10', ['']), matriz([{ peso: '1', niveles: descritos(NIVELES_3, 'M3') }]), NIVELES_3);
  assert.equal(tres.criterios[0].detallar, true);
  assert.deepEqual(tres.criterios[0].niveles.map((n) => `${n.nombre}: ${n.descripcion}`), ['Bajo: M3 Bajo', 'Medio: M3 Medio', 'Alto: M3 Alto']);
});

test('aplicarMatriz: si la cantidad de descripciones no coincide con la escala del examen, se aplican los criterios sin detalle', () => {
  const m5 = matriz([{ peso: '3', niveles: NIVELES_5_MATRIZ }, { peso: '1', niveles: NIVELES_5_MATRIZ }]);
  const resultado = aplicarMatriz(abierta('8', ['']), m5, NIVELES_3);
  assert.deepEqual(resultado.criterios.map((c) => c.nombre), ['Matriz 1', 'Matriz 2']);
  assert.ok(resultado.criterios.every((c) => c.detallar === false && c.niveles.length === 3 && c.niveles.every((n) => n.descripcion === '')));
  assert.deepEqual(resultado.criterios[0].niveles.map((n) => n.nombre), ['Bajo', 'Medio', 'Alto']);
  // Nombre, qué se espera y peso se aplican igual, y el reparto no cambia.
  assert.deepEqual(resultado.criterios.map((c) => c.peso), ['3', '1']);
  assert.deepEqual(puntosPorCriterio(resultado), [6, 2]);

  // A la inversa: matriz de 3 niveles en un examen de 5.
  const m3 = matriz([{ peso: '1', niveles: descritos(NIVELES_3) }]);
  const alReves = aplicarMatriz(abierta('8', ['']), m3, NIVELES);
  assert.equal(alReves.criterios[0].detallar, false);
  assert.equal(alReves.criterios[0].niveles.length, 5);
});

test('aplicarMatriz: una descripción vacía en la matriz la deja sin detalle (no hay descripción de TODOS los niveles)', () => {
  const incompleta = NIVELES_5_MATRIZ.map((n, i) => (i === 2 ? { ...n, descripcion: '  ' } : n));
  const resultado = aplicarMatriz(abierta('', ['']), matriz([{ peso: '1', niveles: incompleta }]), NIVELES);
  assert.equal(resultado.criterios[0].detallar, false);
  assert.ok(resultado.criterios[0].niveles.every((n) => n.descripcion === ''));
});

test('aplicarMatriz: los niveles de la matriz llegan en cualquier orden y se aplican por `orden`', () => {
  const desordenados = [...NIVELES_5_MATRIZ].reverse();
  const resultado = aplicarMatriz(abierta('', ['']), matriz([{ peso: '1', niveles: desordenados }]), NIVELES);
  assert.deepEqual(resultado.criterios[0].niveles.map((n) => n.descripcion), NIVELES_5_MATRIZ.map((n) => n.descripcion));
});

// ---------------------------------------------------------------------------
// 4. criteriosParaMatriz: guardar los criterios de la pregunta como matriz
// ---------------------------------------------------------------------------
test('criteriosParaMatriz: el peso viaja como puntajeMaximo (número) y sin detalle por nivel no hay nivelesDescripcion', () => {
  const resultado = criteriosParaMatriz(abierta('10', ['2', '1.5']), NIVELES);
  assert.deepEqual(resultado, [
    { nombre: 'Criterio 1', descripcion: 'Qué se espera de Criterio 1', puntajeMaximo: 2 },
    { nombre: 'Criterio 2', descripcion: 'Qué se espera de Criterio 2', puntajeMaximo: 1.5 },
  ]);
  assert.ok(resultado.every((c) => !('nivelesDescripcion' in c)));
});

test('criteriosParaMatriz: nivelesDescripcion solo si TODOS los criterios tienen los 5 niveles descritos', () => {
  const todos = criteriosParaMatriz(abierta('10', ['1', '1'], true), NIVELES);
  assert.equal(todos.length, 2);
  assert.ok(todos.every((c) => c.nivelesDescripcion?.length === 5));
  assert.deepEqual(todos[0].nivelesDescripcion, descritos(NIVELES));

  // Uno sin detalle -> se omite en todos.
  const mixto = abierta('10', ['1', '1'], true);
  mixto.criterios[1] = criterio('1', 'Sin detalle');
  assert.ok(criteriosParaMatriz(mixto, NIVELES).every((c) => c.nivelesDescripcion === undefined));

  // Uno a medias -> se omite en todos (y la matriz igual se puede guardar).
  const medias = abierta('10', ['1', '1'], true);
  medias.criterios[0] = conDescritos(criterio('1', 'A medias'), 2);
  const sinDetalle = criteriosParaMatriz(medias, NIVELES);
  assert.equal(sinDetalle.length, 2);
  assert.ok(sinDetalle.every((c) => c.nivelesDescripcion === undefined));

  // Las descripciones van recortadas.
  const conEspacios = abierta('10', ['1'], true);
  conEspacios.criterios[0].niveles = conEspacios.criterios[0].niveles.map((n) => ({ ...n, descripcion: `  ${n.descripcion}  ` }));
  assert.equal(criteriosParaMatriz(conEspacios, NIVELES)[0].nivelesDescripcion![0].descripcion, 'Detalle Insuficiente');
});

test('criteriosParaMatriz: el detalle por nivel viaja solo si coincide con la escala del examen y esa escala es de 3 a 7 niveles', () => {
  const escalaDe = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ orden: i + 1, nombre: `N${i + 1}`, colorHex: '#000000', porcentaje: String(Math.round((100 * i) / (n - 1))) }));

  // Detalle de 3 niveles en un examen de 3, y de 7 en uno de 7: es lo que acepta el servidor (3 a 7), viaja completo.
  for (const n of [3, 5, 7]) {
    const niv = escalaDe(n);
    const p = { ...preguntaVacia(niv), tipo: 'desarrollo' as const, puntajeMaximo: '10', criterios: [criterio('1', 'Crit', true, niv)] };
    assert.equal(criteriosParaMatriz(p, niv)[0].nivelesDescripcion?.length, n, `${n} niveles`);
  }

  // Criterios con 5 niveles pero el examen ahora tiene 3: no coincide con la escala, se omite.
  assert.ok(criteriosParaMatriz(abierta('10', ['1'], true), NIVELES_3).every((c) => c.nivelesDescripcion === undefined));

  // Una escala fuera de rango (2 u 8 niveles) no es válida en una matriz: se guarda sin detalle en vez de provocar un 400.
  for (const n of [2, 8]) {
    const niv = escalaDe(n);
    const p = { ...preguntaVacia(niv), tipo: 'desarrollo' as const, puntajeMaximo: '10', criterios: [criterio('1', 'Crit', true, niv)] };
    assert.equal(criteriosParaMatriz(p, niv)[0].nivelesDescripcion, undefined, `${n} niveles`);
  }

  // Sin escala se toman los niveles del propio criterio.
  assert.equal(criteriosParaMatriz(abierta('10', ['1'], true))[0].nivelesDescripcion?.length, 5);
});

test('criteriosParaMatriz: [] si no hay criterios, alguno está a medias o el peso no llega al mínimo del servidor; las filas en blanco se saltean', () => {
  assert.deepEqual(criteriosParaMatriz(preguntaVacia(NIVELES), NIVELES), []);
  assert.deepEqual(criteriosParaMatriz({ ...abierta('10', ['1']), criterios: [] }, NIVELES), []);

  const sinDescripcion = abierta('10', ['1', '1']);
  sinDescripcion.criterios[1] = { ...sinDescripcion.criterios[1], descripcion: ' ' };
  assert.deepEqual(criteriosParaMatriz(sinDescripcion, NIVELES), []);
  const sinNombre = abierta('10', ['1', '1']);
  sinNombre.criterios[0] = { ...sinNombre.criterios[0], nombre: '' };
  assert.deepEqual(criteriosParaMatriz(sinNombre, NIVELES), []);
  for (const peso of ['', '0', '-1', 'abc', '0.001']) {
    assert.deepEqual(criteriosParaMatriz(abierta('10', ['1', peso]), NIVELES), [], `peso "${peso}"`);
  }
  assert.equal(criteriosParaMatriz(abierta('10', ['1', '0.01']), NIVELES).length, 2);

  const conBlanco = abierta('10', ['1', '2']);
  conBlanco.criterios.push(criterioVacio(NIVELES));
  assert.deepEqual(criteriosParaMatriz(conBlanco, NIVELES).map((c) => c.puntajeMaximo), [1, 2]);
});

test('criteriosParaMatriz: el resultado tiene la forma de lo que recibe createMatrizRubrica', () => {
  type Criterios = Parameters<typeof createMatrizRubrica>[0]['criterios'];
  const criterios: Criterios = criteriosParaMatriz(abierta('10', ['1', '1'], true), NIVELES);
  assert.equal(criterios.length, 2);
  assert.ok(criterios.every((c) => typeof c.puntajeMaximo === 'number' && c.nivelesDescripcion?.every((n) => n.orden >= 1 && n.nombre && n.descripcion)));
});

// ---------------------------------------------------------------------------
// 5. criteriosDeSugerencia: sugerencia de la IA -> criterios del formulario
// ---------------------------------------------------------------------------
const sugerencia = (niveles = 5): CriterioSugerido[] => [
  { nombre: 'Claridad', descripcion: 'Se entiende la idea', peso: 50, niveles: Array.from({ length: niveles }, (_, i) => `Claridad nivel ${i + 1}`) },
  { nombre: 'Fundamentos', descripcion: 'Cita teoría', peso: 30, niveles: Array.from({ length: niveles }, (_, i) => `Fundamentos nivel ${i + 1}`) },
  { nombre: 'Ejemplos', descripcion: 'Aporta ejemplos', peso: 20, niveles: Array.from({ length: niveles }, (_, i) => `Ejemplos nivel ${i + 1}`) },
];

test('criteriosDeSugerencia: con la misma cantidad de niveles que la escala usa el detalle (detallar true) con los nombres del examen', () => {
  const criterios = criteriosDeSugerencia(sugerencia(5), NIVELES);
  assert.deepEqual(criterios.map((c) => [c.nombre, c.descripcion, c.peso]), [
    ['Claridad', 'Se entiende la idea', '50'],
    ['Fundamentos', 'Cita teoría', '30'],
    ['Ejemplos', 'Aporta ejemplos', '20'],
  ]);
  assert.ok(criterios.every((c) => c.detallar === true && c.matrizOrigenId === undefined));
  assert.deepEqual(criterios[0].niveles, NIVELES.map((n, i) => ({ orden: n.orden, nombre: n.nombre, descripcion: `Claridad nivel ${i + 1}` })));
});

test('criteriosDeSugerencia: si la cantidad no coincide con la escala, los criterios quedan SIN detalle (detallar false, niveles vacíos de la escala)', () => {
  const criterios = criteriosDeSugerencia(sugerencia(5), NIVELES_3);
  assert.ok(criterios.every((c) => c.detallar === false));
  assert.ok(criterios.every((c) => c.niveles.length === 3 && c.niveles.every((n) => n.descripcion === '')));
  assert.deepEqual(criterios[0].niveles.map((n) => n.nombre), ['Bajo', 'Medio', 'Alto']);
  assert.deepEqual(criterios.map((c) => c.peso), ['50', '30', '20']); // el peso se conserva

  // Una descripción vacía o ausente tampoco cuenta como detalle.
  const rota = sugerencia(5);
  rota[0].niveles[2] = ' ';
  assert.equal(criteriosDeSugerencia(rota, NIVELES)[0].detallar, false);
  assert.equal(criteriosDeSugerencia(rota, NIVELES)[1].detallar, true);
  assert.equal(criteriosDeSugerencia([{ ...sugerencia()[0], niveles: undefined as unknown as string[] }], NIVELES)[0].detallar, false);
});

test('criteriosDeSugerencia: no inventa puntos; el "= X pts" sale del peso apenas la pregunta tiene puntos', () => {
  const criterios = criteriosDeSugerencia(sugerencia(5), NIVELES);
  const sinPuntos: PreguntaForm = { ...preguntaVacia(NIVELES), tipo: 'respuesta_corta', criterios };
  assert.equal(sinPuntos.puntajeMaximo, '');
  assert.deepEqual(puntosPorCriterio(sinPuntos), [0, 0, 0]);
  assert.deepEqual(puntosPorCriterio({ ...sinPuntos, puntajeMaximo: '10' }), [5, 3, 2]);
  assert.deepEqual(validarPregunta({ ...sinPuntos, enunciado: 'x', puntajeMaximo: '10' }, 0), []);
  // El borrador completo es un payload válido: la suma de los criterios es P.
  const payload = construirPregunta({ ...sinPuntos, enunciado: 'x', puntajeMaximo: '7' });
  assert.equal(suma(payload.criterios!.map((c) => c.puntajeMaximo)), 7);
  assert.equal(payload.criterios![0].nivelesDescripcion?.length, 5);
});

// ---------------------------------------------------------------------------
// 6. Pesos en porcentaje (lista de matrices) y mensajes de error en castellano
// ---------------------------------------------------------------------------
test('pesosEnPorcentaje: proporción sobre el total; strings o números; inválidos valen 0', () => {
  assert.deepEqual(pesosEnPorcentaje(['5.00', '5.00']), [50, 50]);
  assert.deepEqual(pesosEnPorcentaje([1, 3]), [25, 75]);
  assert.deepEqual(pesosEnPorcentaje(['2', 'abc', '', '-1', '2']), [50, 0, 0, 0, 50]);
  assert.deepEqual(pesosEnPorcentaje(['0', '0']), [0, 0]);
  assert.deepEqual(pesosEnPorcentaje([]), []);
  assert.ok(Math.abs(pesosEnPorcentaje(['1', '1', '1']).reduce((s, x) => s + x, 0) - 100) < 1e-9);
});

const apiError = (status: number, body: unknown) => new ApiError(status, `Error ${status} en /x: ${JSON.stringify(body)}`, JSON.stringify(body));

test('mensajeErrorSugerencia: 429, 401, 502 y red caída dan mensajes en castellano, nunca el JSON crudo', () => {
  const limite = mensajeErrorSugerencia(apiError(429, { statusCode: 429, message: 'ThrottlerException: Too Many Requests' }));
  assert.match(limite, /20 por minuto/);
  assert.match(mensajeErrorSugerencia(apiError(401, { statusCode: 401, message: 'Unauthorized' })), /sesión venció/);
  const generico = mensajeErrorSugerencia(apiError(502, { statusCode: 502, message: 'Bad Gateway' }));
  assert.match(generico, /La IA no pudo armar una sugerencia/);
  assert.match(mensajeErrorSugerencia(apiError(400, { message: ['enunciado must be shorter than or equal to 5000 characters'] })), /enunciado/);
  assert.match(mensajeErrorSugerencia(new TypeError('Failed to fetch')), /No pudimos conectarnos/);

  for (const m of [limite, generico]) {
    assert.ok(!/[{}"]|statusCode|Throttler|Bad Gateway|Error \d{3}/.test(m), `sin JSON crudo ni inglés: ${m}`);
  }
});

test('mensajeErrorMatriz: usa el detalle del servidor en los 4xx y no filtra errores internos ni JSON crudo', () => {
  assert.equal(
    mensajeErrorMatriz(apiError(400, { statusCode: 400, message: ['criterios.0.descripcion should not be empty', 'otro'] })),
    'No se pudo guardar la matriz. Revisá los datos y probá de nuevo. Detalle: criterios.0.descripcion should not be empty; otro',
  );
  assert.equal(mensajeErrorMatriz(apiError(400, { message: 'Algo en castellano' })), 'No se pudo guardar la matriz. Revisá los datos y probá de nuevo. Detalle: Algo en castellano');
  assert.equal(mensajeErrorMatriz(new ApiError(400, 'Error 400', 'no es json')), 'No se pudo guardar la matriz. Revisá los datos y probá de nuevo.');
  assert.match(mensajeErrorMatriz(apiError(401, {})), /sesión venció/);
  const interno = mensajeErrorMatriz(apiError(500, { statusCode: 500, message: 'Internal server error' }));
  assert.match(interno, /problema del servidor/);
  assert.ok(!/Internal|statusCode|[{}]/.test(interno));
  assert.match(mensajeErrorMatriz(new Error('network')), /No pudimos conectarnos/);
});
