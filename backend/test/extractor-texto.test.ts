// Extracción de texto de los archivos de material (pdf, docx, pptx, md, txt). Sin base de datos ni IA:
//   node --require ts-node/register --test test/extractor-texto.test.ts
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import JSZip from 'jszip';
import { BadRequestException } from '@nestjs/common';
import { MAX_ARCHIVO_BYTES, MAX_CONTENIDO_MATERIAL, extraerTexto } from '../src/materiales-curso/extractor-texto.util';

const rechaza = (p: Promise<unknown>, mensaje: RegExp) => assert.rejects(p, (e: unknown) => e instanceof BadRequestException && mensaje.test(e.message));

async function zip(archivos: Record<string, string>): Promise<Buffer> {
  const z = new JSZip();
  for (const [nombre, xml] of Object.entries(archivos)) z.file(nombre, xml);
  return z.generateAsync({ type: 'nodebuffer' });
}

test('txt y md: se leen como utf8 y se normalizan los saltos de línea', async () => {
  assert.equal(await extraerTexto(Buffer.from('Hola ñandú\r\n\r\n\r\n\r\nChau  \n'), 'apunte.txt'), 'Hola ñandú\n\nChau');
  assert.equal(await extraerTexto(Buffer.from('# Título\n\ntexto'), 'Apunte.MD'), '# Título\n\ntexto');
});

test('pdf con texto: se extrae', async () => {
  // Fixture: PDF real (de los datos de prueba de pdf-parse, MIT).
  const pdf = readFileSync(join(__dirname, 'fixtures', 'con-texto.pdf'));
  assert.match(await extraerTexto(pdf, 'clase.pdf'), /Dadfrtfjh/);
});

test('docx: se extrae el texto de los párrafos', async () => {
  const buf = await zip({
    '[Content_Types].xml':
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml':
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Primer párrafo</w:t></w:r></w:p><w:p><w:r><w:t>Segundo</w:t></w:r></w:p></w:body></w:document>',
  });
  const texto = await extraerTexto(buf, 'apunte.docx');
  assert.match(texto, /Primer párrafo/);
  assert.match(texto, /Segundo/);
});

test('pptx: texto por diapositiva, en orden numérico y con entidades decodificadas', async () => {
  const lamina = (t: string) => `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`;
  const buf = await zip({
    'ppt/slides/slide10.xml': lamina('Diez'),
    'ppt/slides/slide2.xml': lamina('Dos &amp; más'),
    'ppt/slides/slide1.xml': lamina('Uno'),
  });
  assert.equal(await extraerTexto(buf, 'clase.pptx'), 'Diapositiva 1\nUno\n\nDiapositiva 2\nDos & más\n\nDiapositiva 10\nDiez');
});

test('rechaza formatos no soportados, vacíos, de firma falsa o dañados', async () => {
  await rechaza(extraerTexto(Buffer.from('x'), 'a.exe'), /Formato no soportado/);
  await rechaza(extraerTexto(Buffer.alloc(0), 'a.txt'), /vacío/);
  await rechaza(extraerTexto(Buffer.from('no soy un pdf'), 'a.pdf'), /no coincide/);
  await rechaza(extraerTexto(Buffer.from([0x50, 0x4b, 1, 2, 3]), 'a.docx'), /No se pudo leer/);
  await rechaza(extraerTexto(Buffer.from([0, 1, 2, 3]), 'a.txt'), /no coincide/);
});

test('rechaza archivos sin texto y archivos demasiado grandes o largos', async () => {
  await rechaza(extraerTexto(Buffer.from('  \n  '), 'a.txt'), /No se encontró texto/);
  await rechaza(extraerTexto(await zip({ 'ppt/slides/slide1.xml': '<p:sld/>' }), 'a.pptx'), /No se encontró texto/);
  await rechaza(extraerTexto(Buffer.alloc(MAX_ARCHIVO_BYTES + 1, 97), 'a.txt'), /máximo/);
  await rechaza(extraerTexto(Buffer.alloc(MAX_CONTENIDO_MATERIAL + 1, 97), 'a.txt'), /supera el máximo/);
});
