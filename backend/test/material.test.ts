// Validación del archivo de material antes de subirlo (frontend/lib/material.ts). Corre sin red ni navegador.
//   node --require ts-node/register --test test/material.test.ts   (o `npm test`)
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { MAX_ARCHIVO_BYTES as TOPE_FRONT, caracteresLegibles, problemaDelArchivo, tamanoLegible } from '../../frontend/lib/material';
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
