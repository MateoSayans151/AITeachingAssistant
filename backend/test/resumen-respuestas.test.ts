// Resumen de respuestas por examen (home "Para revisar" y lista de exámenes de un curso): clasificación y orden. Sin base de datos.
//   node --require ts-node/register --test test/resumen-respuestas.test.ts   (o `npm test`)
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { RESUMEN_VACIO, examenesPorRevisar, resumirConteos } from '../src/examenes/resumen-respuestas.util';
import type { FilaConteoRespuestas } from '../src/examenes/resumen-respuestas.util';

const fila = (examenId: string, estado: FilaConteoRespuestas['estado'], estadoRevision: FilaConteoRespuestas['estadoRevision'], cantidad: number): FilaConteoRespuestas => ({
  examenId,
  estado,
  estadoRevision,
  cantidad,
});

test('resumirConteos: la IA sin corregir, las que esperan al docente y las ya revisadas se cuentan por separado', () => {
  const r = resumirConteos([
    fila('e1', 'pendiente_correccion', 'pendiente', 2),
    fila('e1', 'corregido', 'pendiente', 5),
    fila('e1', 'revisado', 'aceptada', 3),
    fila('e1', 'revisado', 'editada', 1),
  ]);
  assert.deepEqual(r.get('e1'), { entregadas: 11, sinCorregir: 2, porRevisar: 5, revisadas: 4 });
});

test('resumirConteos: una respuesta sin corregir por la IA no cuenta como "por revisar" aunque su revisión esté pendiente', () => {
  const r = resumirConteos([fila('e1', 'pendiente_correccion', 'pendiente', 4)]);
  assert.deepEqual(r.get('e1'), { entregadas: 4, sinCorregir: 4, porRevisar: 0, revisadas: 0 });
});

test('resumirConteos: separa por examen y un examen sin respuestas no aparece', () => {
  const r = resumirConteos([fila('e1', 'corregido', 'pendiente', 1), fila('e2', 'revisado', 'aceptada', 7)]);
  assert.equal(r.size, 2);
  assert.equal(r.get('e2')!.porRevisar, 0);
  assert.equal(r.get('e3'), undefined);
  assert.equal(resumirConteos([]).size, 0);
});

test('resumirConteos: no comparte el objeto vacío (cada examen tiene el suyo)', () => {
  const r = resumirConteos([fila('e1', 'corregido', 'pendiente', 1)]);
  assert.deepEqual(RESUMEN_VACIO, { entregadas: 0, sinCorregir: 0, porRevisar: 0, revisadas: 0 }, 'RESUMEN_VACIO no se muta');
  assert.notEqual(r.get('e1'), RESUMEN_VACIO);
});

test('examenesPorRevisar: solo los que esperan algo, primero los que más tienen por revisar', () => {
  const examenes = [
    { id: 'a', titulo: 'Parcial A', cursoId: 'c1', curso: { nombre: 'Datos' } },
    { id: 'b', titulo: 'Parcial B', cursoId: 'c1', curso: { nombre: 'Datos' } },
    { id: 'c', titulo: 'Final', cursoId: 'c2', curso: { nombre: 'Redes' } },
    { id: 'd', titulo: 'Sin entregas', cursoId: 'c2', curso: { nombre: 'Redes' } },
  ];
  const resumenes = resumirConteos([
    fila('a', 'corregido', 'pendiente', 2),
    fila('b', 'corregido', 'pendiente', 9),
    fila('c', 'revisado', 'aceptada', 30), // al día: no aparece
    fila('a', 'pendiente_correccion', 'pendiente', 1),
  ]);
  const lista = examenesPorRevisar(examenes, resumenes);
  assert.deepEqual(lista.map((e) => e.id), ['b', 'a']);
  assert.equal(lista[0].cursoNombre, 'Datos');
  assert.deepEqual({ entregadas: lista[1].entregadas, sinCorregir: lista[1].sinCorregir, porRevisar: lista[1].porRevisar }, { entregadas: 3, sinCorregir: 1, porRevisar: 2 });
});

test('examenesPorRevisar: un examen con solo respuestas sin corregir por la IA también aparece (la IA está trabajando)', () => {
  const lista = examenesPorRevisar(
    [{ id: 'a', titulo: 'A', cursoId: 'c', curso: { nombre: 'X' } }],
    resumirConteos([fila('a', 'pendiente_correccion', 'pendiente', 3)]),
  );
  assert.equal(lista.length, 1);
  assert.equal(lista[0].porRevisar, 0);
  assert.equal(lista[0].sinCorregir, 3);
});
