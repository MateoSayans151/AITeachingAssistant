// La revisión de una respuesta (backend/src/respuestas-examen/revision.util.ts): la nota final y la devolución de cada pregunta.
// Corre sin base de datos:  node --require ts-node/register --test test/revision-respuesta.test.ts   (o `npm test`)
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RevisarRespuestaExamenDto } from '../src/respuestas-examen/dto/revisar-respuesta-examen.dto';
import { MAX_DEVOLUCION, aplicarRevision, limpiarDevolucion } from '../src/respuestas-examen/revision.util';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const base = () => [
  { preguntaId: P1, notaSugerida: 1.5, notaFinal: null as number | null, feedbackFinal: undefined as string | null | undefined },
  { preguntaId: P2, notaSugerida: 2, notaFinal: 1 as number | null, feedbackFinal: 'Lo que ya había' as string | null | undefined },
];

test('limpiarDevolucion: recorta espacios, unifica saltos de línea, vacío es null y se acota al tope', () => {
  assert.equal(limpiarDevolucion('  Bien armado.  '), 'Bien armado.');
  assert.equal(limpiarDevolucion('a\r\nb'), 'a\nb');
  assert.equal(limpiarDevolucion('   '), null);
  assert.equal(limpiarDevolucion(''), null);
  assert.equal(limpiarDevolucion(undefined), null);
  assert.equal(limpiarDevolucion(null), null);
  assert.equal(limpiarDevolucion('x'.repeat(MAX_DEVOLUCION + 50))!.length, MAX_DEVOLUCION);
});

test('aplicarRevision «editada»: pisa la nota y la devolución de la pregunta indicada y no toca las demás', () => {
  const r = aplicarRevision(base(), 'editada', [{ preguntaId: P1, notaFinal: 1.2, feedbackFinal: '  Faltó justificar el ejemplo.  ' }]);
  assert.equal(r[0].notaFinal, 1.2);
  assert.equal(r[0].feedbackFinal, 'Faltó justificar el ejemplo.');
  assert.equal(r[1].notaFinal, 1, 'conserva la nota final que ya tenía');
  assert.equal(r[1].feedbackFinal, 'Lo que ya había', 'conserva su devolución');
});

test('aplicarRevision «editada»: sin feedbackFinal en el override la devolución no se toca; con texto vacío se quita', () => {
  const sin = aplicarRevision(base(), 'editada', [{ preguntaId: P2, notaFinal: 2 }]);
  assert.equal(sin[1].feedbackFinal, 'Lo que ya había');
  assert.equal(sin[1].notaFinal, 2);
  const quitada = aplicarRevision(base(), 'editada', [{ preguntaId: P2, notaFinal: 2, feedbackFinal: '   ' }]);
  assert.equal(quitada[1].feedbackFinal, '', 'quitada a propósito se guarda vacía, no null: «nunca la toqué» y «la saqué» son cosas distintas');
});

test('aplicarRevision «editada»: una pregunta sin nota final previa toma la sugerida', () => {
  const r = aplicarRevision(base(), 'editada', []);
  assert.equal(r[0].notaFinal, 1.5);
  assert.equal(r[1].notaFinal, 1);
});

test('aplicarRevision «aceptada»: confirma las notas sugeridas y deja las devoluciones como estaban; ignora overrides', () => {
  const r = aplicarRevision(base(), 'aceptada', [{ preguntaId: P1, notaFinal: 0, feedbackFinal: 'No debería aplicarse' }]);
  assert.deepEqual(r.map((x) => x.notaFinal), [1.5, 2]);
  assert.equal(r[0].feedbackFinal, undefined);
  assert.equal(r[1].feedbackFinal, 'Lo que ya había');
});

test('aplicarRevision no muta lo que recibe', () => {
  const original = base();
  aplicarRevision(original, 'editada', [{ preguntaId: P1, notaFinal: 0.1, feedbackFinal: 'x' }]);
  assert.equal(original[0].notaFinal, null);
  assert.equal(original[0].feedbackFinal, undefined);
});

test('RevisarRespuestaExamenDto: acepta la devolución por pregunta y rechaza una que se pasa del tope o no es texto', async () => {
  const dto = (feedbackFinal: unknown) => plainToInstance(RevisarRespuestaExamenDto, { estadoRevision: 'editada', overridesPorPregunta: [{ preguntaId: P1, notaFinal: 1, feedbackFinal }] });
  assert.equal((await validate(dto('Muy bien.'))).length, 0);
  assert.equal((await validate(dto(undefined))).length, 0);
  assert.ok((await validate(dto('x'.repeat(MAX_DEVOLUCION + 1)))).length > 0);
  assert.ok((await validate(dto(5))).length > 0);
});
