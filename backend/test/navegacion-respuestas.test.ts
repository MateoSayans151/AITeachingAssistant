// Navegación entre respuestas al revisar en tanda (frontend/lib/navegacion-respuestas.ts) y formato de notas (frontend/lib/texto.ts).
//   node --require ts-node/register --test test/navegacion-respuestas.test.ts   (o `npm test`)
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { esParaRevisar, navegacion } from '../../frontend/lib/navegacion-respuestas';
import type { RespuestaDeLista } from '../../frontend/lib/navegacion-respuestas';
import { formatearNota, plural } from '../../frontend/lib/texto';

const revisar = (id: string): RespuestaDeLista => ({ id, estado: 'corregido', estadoRevision: 'pendiente' });
const aceptada = (id: string): RespuestaDeLista => ({ id, estado: 'revisado', estadoRevision: 'aceptada' });
const sinIA = (id: string): RespuestaDeLista => ({ id, estado: 'pendiente_correccion', estadoRevision: 'pendiente' });

test('esParaRevisar: la IA ya sugirió y el docente no revisó; no cuenta la que la IA todavía no corrigió ni la ya revisada', () => {
  assert.equal(esParaRevisar(revisar('a')), true);
  assert.equal(esParaRevisar(sinIA('a')), false);
  assert.equal(esParaRevisar(aceptada('a')), false);
  assert.equal(esParaRevisar({ estado: 'revisado', estadoRevision: 'editada' }), false);
});

test('navegacion: posición, anterior y siguiente en la lista', () => {
  const lista = [revisar('a'), aceptada('b'), revisar('c')];
  assert.deepEqual(navegacion(lista, 'b'), { posicion: 2, total: 3, anteriorId: 'a', siguienteId: 'c', siguienteParaRevisarId: 'c', restantesParaRevisar: 2 });
});

test('navegacion: en los extremos no hay anterior o siguiente', () => {
  const lista = [revisar('a'), revisar('b')];
  const primera = navegacion(lista, 'a');
  assert.equal(primera.anteriorId, null);
  assert.equal(primera.siguienteId, 'b');
  const ultima = navegacion(lista, 'b');
  assert.equal(ultima.anteriorId, 'a');
  assert.equal(ultima.siguienteId, null);
});

test('navegacion: la siguiente por revisar salta las ya revisadas y las que la IA todavía no corrigió', () => {
  const lista = [revisar('a'), aceptada('b'), sinIA('c'), revisar('d')];
  assert.equal(navegacion(lista, 'a').siguienteParaRevisarId, 'd');
});

test('navegacion: al llegar a la última da la vuelta y vuelve a las anteriores que quedaron sin revisar', () => {
  const lista = [revisar('a'), aceptada('b'), revisar('c')];
  const n = navegacion(lista, 'c');
  assert.equal(n.siguienteParaRevisarId, 'a');
  assert.equal(n.restantesParaRevisar, 1);
});

test('navegacion: si no queda ninguna otra por revisar, no hay siguiente pendiente (el docente termina)', () => {
  const lista = [aceptada('a'), revisar('b'), aceptada('c')];
  const n = navegacion(lista, 'b');
  assert.equal(n.siguienteParaRevisarId, null);
  assert.equal(n.restantesParaRevisar, 0);
});

test('navegacion: una respuesta que no está en la lista no revienta (posición null, sin anterior ni siguiente)', () => {
  const n = navegacion([revisar('a'), revisar('b')], 'zzz');
  assert.deepEqual(n, { posicion: null, total: 2, anteriorId: null, siguienteId: null, siguienteParaRevisarId: 'a', restantesParaRevisar: 2 });
  assert.deepEqual(navegacion([], 'a'), { posicion: null, total: 0, anteriorId: null, siguienteId: null, siguienteParaRevisarId: null, restantesParaRevisar: 0 });
});

test('formatearNota: formato argentino (coma decimal, sin ceros de más, máximo 2 decimales)', () => {
  assert.equal(formatearNota(6.5), '6,5');
  assert.equal(formatearNota(10), '10');
  assert.equal(formatearNota(0.5), '0,5');
  assert.equal(formatearNota(7.255), '7,26');
  assert.equal(formatearNota('6.5'), '6,5', 'Prisma entrega los decimales como string');
  assert.equal(formatearNota(null), '—');
  assert.equal(formatearNota(undefined), '—');
  assert.equal(formatearNota('abc'), '—');
});

test('plural: el número con su sustantivo', () => {
  assert.equal(plural(1, 'comisión', 'comisiones'), '1 comisión');
  assert.equal(plural(0, 'comisión', 'comisiones'), '0 comisiones');
  assert.equal(plural(2, 'examen', 'exámenes'), '2 exámenes');
});
