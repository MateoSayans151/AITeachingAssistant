// Validación del archivo de material antes de subirlo (frontend/lib/material.ts). Corre sin red ni navegador.
//   node --require ts-node/register --test test/material.test.ts   (o `npm test`)
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { MAX_ARCHIVOS_POR_TANDA, MAX_ARCHIVO_BYTES as TOPE_FRONT, cantidadDeArchivos, caracteresLegibles, clasificarArchivos, problemaDelArchivo, tamanoLegible } from '../../frontend/lib/material';
import { EXTENSIONES_SOPORTADAS, MAX_ARCHIVO_BYTES as TOPE_BACK } from '../src/materiales-curso/extractor-texto.util';

test('los topes y formatos del navegador coinciden con los del servidor (si cambian allá, esto avisa)', () => {
  assert.equal(TOPE_FRONT, TOPE_BACK);
  for (const ext of EXTENSIONES_SOPORTADAS) assert.equal(problemaDelArchivo({ name: `apunte.${ext}`, size: 1000 }), null, ext);
});

test('problemaDelArchivo: acepta los formatos soportados, sin importar mayúsculas', () => {
  assert.equal(problemaDelArchivo({ name: 'Unidad 3.PDF', size: 500_000 }), null);
  assert.equal(problemaDelArchivo({ name: 'clase.Docx', size: 10 }), null);
  assert.equal(problemaDelArchivo({ name: 'notas.md', size: TOPE_BACK }), null, 'justo en el tope entra');
});

test('problemaDelArchivo: rechaza formatos que no se leen, con el nombre del archivo y qué subir', () => {
  for (const nombre of ['foto.png', 'planilla.xlsx', 'sin-extension', 'viejo.doc', 'archivo.pdf.exe']) {
    const msg = problemaDelArchivo({ name: nombre, size: 1000 }) ?? '';
    assert.match(msg, new RegExp(nombre.replace('.', '\\.')), nombre);
    assert.match(msg, /\.pdf, \.docx, \.pptx, \.md o \.txt/, nombre);
  }
});

test('problemaDelArchivo: archivo vacío y archivo de más del tope, con el tamaño real y qué hacer', () => {
  assert.match(problemaDelArchivo({ name: 'a.txt', size: 0 }) ?? '', /está vacío/);
  const grande = problemaDelArchivo({ name: 'libro.pdf', size: 6 * 1024 * 1024 }) ?? '';
  assert.match(grande, /pesa 6,0 MB/);
  assert.match(grande, /máximo es 4 MB/);
  assert.ok(problemaDelArchivo({ name: 'libro.pdf', size: TOPE_BACK + 1 }));
});

test('tamanoLegible: KB hasta 1 MB, MB con coma después; nunca "0 KB"', () => {
  assert.equal(tamanoLegible(850 * 1024), '850 KB');
  assert.equal(tamanoLegible(1.5 * 1024 * 1024), '1,5 MB');
  assert.equal(tamanoLegible(10), '1 KB');
});

test('caracteresLegibles: formato argentino y singular', () => {
  assert.equal(caracteresLegibles('x'.repeat(12340)), '12.340 caracteres');
  assert.equal(caracteresLegibles('a'), '1 carácter');
  assert.equal(caracteresLegibles(''), '0 caracteres');
  assert.equal(caracteresLegibles(undefined), '0 caracteres');
});

// ---------------------------------------------------------------------------
// Varios archivos de una vez
// ---------------------------------------------------------------------------
const f = (name: string, size = 1000) => ({ name, size });

test('clasificarArchivos: acepta los que sirven, en el orden en que se eligieron, y rechaza los que no con su motivo', () => {
  const r = clasificarArchivos([f('a.pdf'), f('foto.png'), f('b.docx'), f('vacio.txt', 0), f('enorme.pdf', TOPE_BACK + 1)], []);
  assert.deepEqual(r.aceptados.map((x) => x.name), ['a.pdf', 'b.docx']);
  assert.deepEqual(r.rechazados.map((x) => x.nombre), ['foto.png', 'vacio.txt', 'enorme.pdf']);
  assert.match(r.rechazados[0].motivo, /foto\.png/);
  assert.match(r.rechazados[2].motivo, /máximo es 4 MB/);
});

test('clasificarArchivos: no repite lo que ya estaba elegido ni dos veces el mismo archivo de la misma tanda (mismo nombre y tamaño)', () => {
  const r = clasificarArchivos([f('a.pdf'), f('a.pdf'), f('a.pdf', 2000), f('b.pdf')], [f('b.pdf')]);
  assert.deepEqual(r.aceptados.map((x) => `${x.name}:${x.size}`), ['a.pdf:1000', 'a.pdf:2000']);
  assert.equal(r.rechazados.length, 2);
  assert.ok(r.rechazados.every((x) => /ya estaba en la lista/.test(x.motivo)));
});

test('clasificarArchivos: respeta el tope por tanda contando lo ya elegido, y avisa qué quedó afuera', () => {
  const muchos = Array.from({ length: MAX_ARCHIVOS_POR_TANDA + 3 }, (_, i) => f(`apunte-${i}.pdf`));
  const r = clasificarArchivos(muchos, []);
  assert.equal(r.aceptados.length, MAX_ARCHIVOS_POR_TANDA);
  assert.equal(r.rechazados.length, 3);
  assert.match(r.rechazados[0].motivo, new RegExp(`hasta ${MAX_ARCHIVOS_POR_TANDA} archivos por vez`));
  // Con lugar para uno solo, entra el primero y el resto no.
  const casi = clasificarArchivos([f('x.pdf'), f('y.pdf')], Array.from({ length: MAX_ARCHIVOS_POR_TANDA - 1 }, (_, i) => f(`ya-${i}.pdf`)));
  assert.deepEqual(casi.aceptados.map((x) => x.name), ['x.pdf']);
  assert.deepEqual(casi.rechazados.map((x) => x.nombre), ['y.pdf']);
});

test('clasificarArchivos: sin archivos no hay nada que aceptar ni rechazar; cantidadDeArchivos concuerda en singular y plural', () => {
  assert.deepEqual(clasificarArchivos([], []), { aceptados: [], rechazados: [] });
  assert.equal(cantidadDeArchivos(1), '1 archivo');
  assert.equal(cantidadDeArchivos(3), '3 archivos');
});
