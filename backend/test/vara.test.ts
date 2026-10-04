import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularVara, describirRegla, validarRegla } from '../src/examenes/vara.util';

const ent = (notas: number[], ajustable = true) => notas.map((base, i) => ({ id: `${ajustable ? 'a' : 'f'}${i}`, base, ajustable }));
const nota = (r: ReturnType<typeof calcularVara>, id: string) => r.items.find((i) => i.id === id)!.despues;

test('porcentaje: multiplica la base y acota a la escala', () => {
  const r = calcularVara(ent([4, 9.5, 0]), { modo: 'porcentaje', valor: 10 }, 0, 10);
  assert.deepEqual(r.items.map((i) => i.despues), [4.4, 10, 0]);
  assert.equal(r.desplazamiento, null);
  assert.equal(r.resumen.aprobadosAntes, null);
});

test('puntos: suma fija, acota y puede ser negativa', () => {
  assert.deepEqual(calcularVara(ent([4, 9.5]), { modo: 'puntos', valor: 1 }, 0, 10).items.map((i) => i.despues), [5, 10]);
  assert.deepEqual(calcularVara(ent([4, 0.5]), { modo: 'puntos', valor: -1 }, 0, 10).items.map((i) => i.despues), [3, 0]);
});

test('aprobados esperados: sube lo mínimo para llegar al objetivo', () => {
  // 4 alumnos, umbral 6, objetivo 75% = 3 aprobados. Hoy aprueba 1 (el 7): faltan 2.
  // Las más cercanas al umbral son 5.5 (+0.5) y 5 (+1): el desplazamiento uniforme mínimo es +1.
  const r = calcularVara(ent([7, 5.5, 5, 3]), { modo: 'aprobados_esperados', valor: 75, umbral: 6 }, 0, 10);
  assert.equal(r.desplazamiento, 1);
  assert.equal(r.resumen.aprobadosAntes, 1);
  assert.equal(r.resumen.aprobadosDespues, 3);
  assert.equal(r.resumen.alcanzable, true);
  assert.equal(nota(r, 'a2'), 6);
});

test('aprobados esperados: si ya se cumple no mueve nada', () => {
  const r = calcularVara(ent([8, 7, 6, 2]), { modo: 'aprobados_esperados', valor: 50, umbral: 6 }, 0, 10);
  assert.equal(r.desplazamiento, 0);
  assert.deepEqual(r.items.map((i) => i.despues), [8, 7, 6, 2]);
  assert.equal(r.resumen.alcanzable, true);
});

test('aprobados esperados: el tope limita el desplazamiento y marca no alcanzable', () => {
  const r = calcularVara(ent([2, 2, 2, 9]), { modo: 'aprobados_esperados', valor: 100, umbral: 6 }, 0, 10);
  // Faltan +4 puntos, el tope por defecto es 2.5 (un cuarto del rango).
  assert.equal(r.desplazamiento, 2.5);
  assert.equal(r.resumen.alcanzable, false);
  assert.equal(r.resumen.aprobadosDespues, 1);
  const conTope = calcularVara(ent([2, 2, 2, 9]), { modo: 'aprobados_esperados', valor: 100, umbral: 6, tope: 4 }, 0, 10);
  assert.equal(conTope.resumen.alcanzable, true);
  assert.equal(conTope.resumen.aprobadosDespues, 4);
});

test('aprobados esperados: las respuestas ya revisadas cuentan pero no se tocan', () => {
  // 2 revisadas (una aprueba, con 7) y 2 pendientes. Objetivo 50% = 2 aprobados: falta 1, el pendiente más cercano (5.5).
  const entradas = [...ent([7, 4], false), ...ent([5.5, 3])];
  const r = calcularVara(entradas, { modo: 'aprobados_esperados', valor: 50, umbral: 6 }, 0, 10);
  assert.equal(r.items.length, 2);
  assert.ok(r.items.every((i) => i.id.startsWith('a')));
  assert.equal(r.desplazamiento, 0.5);
  assert.equal(r.resumen.total, 4);
  assert.equal(r.resumen.aprobadosAntes, 1);
  assert.equal(r.resumen.aprobadosDespues, 2);
});

test('aprobados esperados: sin respuestas ajustables no hay qué mover', () => {
  const r = calcularVara(ent([4, 5], false), { modo: 'aprobados_esperados', valor: 100, umbral: 6 }, 0, 10);
  assert.equal(r.items.length, 0);
  assert.equal(r.resumen.alcanzable, false);
});

test('el redondeo a centésimos no deja a nadie a un pelo del umbral', () => {
  const r = calcularVara(ent([5.994, 3]), { modo: 'aprobados_esperados', valor: 50, umbral: 6 }, 0, 10);
  assert.ok(nota(r, 'a0') >= 6);
  assert.equal(r.resumen.aprobadosDespues, 1);
});

test('aprobados esperados con permitirBajar: baja lo mínimo cuando aprueban más de lo esperado', () => {
  // 5 alumnos, umbral 6, "alrededor de 40%" = 2 aprobados. Hoy aprueban 4: sobran 2.
  // Sacar a 2 exige bajar más que el margen del 2º más justo (7 → hay que restarle 1.01 para dejarlo en 5.99).
  const regla = { modo: 'aprobados_esperados' as const, valor: 40, umbral: 6, permitirBajar: true };
  const r = calcularVara(ent([9, 8, 7, 6, 3]), regla, 0, 10);
  assert.equal(r.desplazamiento, -1.01);
  assert.deepEqual(r.items.map((i) => i.despues), [7.99, 6.99, 5.99, 4.99, 1.99]);
  assert.equal(r.resumen.aprobadosAntes, 4);
  assert.equal(r.resumen.aprobadosDespues, 2);
  assert.equal(r.resumen.alcanzable, true);
});

test('sin permitirBajar nunca baja, aunque aprueben más de lo esperado', () => {
  const r = calcularVara(ent([9, 8, 7, 6, 3]), { modo: 'aprobados_esperados', valor: 40, umbral: 6 }, 0, 10);
  assert.equal(r.desplazamiento, 0);
  assert.deepEqual(r.items.map((i) => i.despues), [9, 8, 7, 6, 3]);
});

test('permitirBajar: el tope limita la baja y marca no alcanzable', () => {
  const r = calcularVara(ent([9, 8, 7, 6, 3]), { modo: 'aprobados_esperados', valor: 40, umbral: 6, permitirBajar: true, tope: 0.5 }, 0, 10);
  assert.equal(r.desplazamiento, -0.5);
  assert.equal(r.resumen.aprobadosDespues, 3);
  assert.equal(r.resumen.alcanzable, false);
});

test('permitirBajar: los bordes de la escala también impiden llegar (no se baja de la nota mínima)', () => {
  // Con umbral = escalaMin nadie puede quedar por debajo: no se puede sacar a nadie.
  const r = calcularVara(ent([5, 4, 3]), { modo: 'aprobados_esperados', valor: 0, umbral: 0, permitirBajar: true }, 0, 10);
  assert.equal(r.resumen.aprobadosDespues, 3);
  assert.equal(r.resumen.alcanzable, false);
  assert.ok(r.items.every((i) => i.despues >= 0));
});

test('permitirBajar: las revisadas cuentan y no se bajan; si ya se cumple no mueve nada', () => {
  // 2 revisadas aprobadas (7, 8) + 3 pendientes (6.5, 6, 2). "Alrededor de 60%" = 3 aprobados; hoy 4: sobra 1.
  const entradas = [...ent([7, 8], false), ...ent([6.5, 6, 2])];
  const r = calcularVara(entradas, { modo: 'aprobados_esperados', valor: 60, umbral: 6, permitirBajar: true }, 0, 10);
  assert.equal(r.items.length, 3);
  assert.equal(r.desplazamiento, -0.01); // alcanza con dejar al más justo (el 6) en 5.99
  assert.equal(r.resumen.aprobadosDespues, 3);
  const igual = calcularVara(entradas, { modo: 'aprobados_esperados', valor: 80, umbral: 6, permitirBajar: true }, 0, 10);
  assert.equal(igual.desplazamiento, 0);
});

test('validarRegla rechaza reglas fuera de la escala', () => {
  assert.equal(validarRegla({ modo: 'porcentaje', valor: 10 }, 0, 10), null);
  assert.ok(validarRegla({ modo: 'porcentaje', valor: 150 }, 0, 10));
  assert.ok(validarRegla({ modo: 'puntos', valor: 11 }, 0, 10));
  assert.ok(validarRegla({ modo: 'aprobados_esperados', valor: 60 }, 0, 10), 'falta el umbral');
  assert.ok(validarRegla({ modo: 'aprobados_esperados', valor: 60, umbral: 11 }, 0, 10));
  assert.ok(validarRegla({ modo: 'aprobados_esperados', valor: 101, umbral: 6 }, 0, 10));
  assert.ok(validarRegla({ modo: 'aprobados_esperados', valor: 60, umbral: 6, tope: -1 }, 0, 10));
  assert.equal(validarRegla({ modo: 'aprobados_esperados', valor: 60, umbral: 6, tope: 3 }, 0, 10), null);
  assert.ok(validarRegla({ modo: 'raro' as any, valor: 1 }, 0, 10));
  assert.ok(validarRegla({ modo: 'puntos', valor: 1, permitirBajar: true }, 0, 10), 'permitirBajar solo va con aprobados_esperados');
  assert.equal(validarRegla({ modo: 'aprobados_esperados', valor: 60, umbral: 6, permitirBajar: true }, 0, 10), null);
});

test('describirRegla habla en castellano', () => {
  assert.equal(describirRegla({ modo: 'porcentaje', valor: 10 }, null), 'ajuste de +10% sobre la nota sugerida');
  assert.match(describirRegla({ modo: 'aprobados_esperados', valor: 60, umbral: 6 }, 0.5), /al menos 60%.*nota mínima 6.*\+0\.5/);
  assert.match(describirRegla({ modo: 'aprobados_esperados', valor: 60, umbral: 6, permitirBajar: true }, -1), /alrededor de 60%.*-1 puntos/);
});
