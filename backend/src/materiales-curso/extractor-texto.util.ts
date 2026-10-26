import { BadRequestException } from '@nestjs/common';

// Tope del archivo subido. Vercel limita el cuerpo de una función a 4,5 MB, así que se queda por debajo.
export const MAX_ARCHIVO_BYTES = 4 * 1024 * 1024;
// Tope del texto extraído (el DTO de texto pegado usa el mismo). El RAG solo manda al modelo los
// fragmentos más cercanos, así que un material largo no encarece cada corrección.
export const MAX_CONTENIDO_MATERIAL = 200_000;

export const EXTENSIONES_SOPORTADAS = ['pdf', 'docx', 'pptx', 'md', 'txt'] as const;
type Extension = (typeof EXTENSIONES_SOPORTADAS)[number];

export function extensionDe(nombre: string): string {
  const i = nombre.lastIndexOf('.');
  return i < 0 ? '' : nombre.slice(i + 1).toLowerCase();
}

/** Los .docx y .pptx son zip: empiezan con "PK". Un .pdf empieza con "%PDF". */
function coincideConFirma(ext: Extension, b: Buffer): boolean {
  if (ext === 'pdf') return b.subarray(0, 5).toString('latin1') === '%PDF-';
  if (ext === 'docx' || ext === 'pptx') return b[0] === 0x50 && b[1] === 0x4b;
  return !b.subarray(0, 8000).includes(0); // texto: sin bytes nulos
}

const decodificarEntidades = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');

/** Texto de cada diapositiva (<a:t>) en orden, con el número de lámina como encabezado. */
async function textoDePptx(buffer: Buffer): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);
  const numero = (nombre: string) => Number(/slide(\d+)\.xml$/.exec(nombre)?.[1] ?? 0);
  const laminas = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => numero(a) - numero(b));
  const salida: string[] = [];
  for (const nombre of laminas) {
    const xml = await zip.files[nombre].async('string');
    const parrafos = xml.split(/<\/a:p>/).map((p) =>
      [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodificarEntidades(m[1])).join(''),
    );
    const texto = parrafos.map((p) => p.trim()).filter(Boolean).join('\n');
    if (texto) salida.push(`Diapositiva ${numero(nombre)}\n${texto}`);
  }
  return salida.join('\n\n');
}

async function textoDePdf(buffer: Buffer): Promise<string> {
  // Import directo: el index de pdf-parse intenta leer un PDF de prueba al cargarse.
  const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (b: Buffer) => Promise<{ text: string }>;
  return (await pdfParse(buffer)).text;
}

async function textoDeDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  return (await mammoth.extractRawText({ buffer })).value;
}

/** Normaliza saltos de línea y espacios sobrantes sin tocar los párrafos. */
export function limpiarTexto(texto: string): string {
  return texto
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extrae el texto de un archivo de material. Lanza BadRequestException con un mensaje apto para el
 * docente si el formato no se soporta, el archivo está dañado o no tiene texto (PDF escaneado: no hay OCR).
 */
export async function extraerTexto(buffer: Buffer, nombreArchivo: string): Promise<string> {
  const ext = extensionDe(nombreArchivo) as Extension;
  if (!EXTENSIONES_SOPORTADAS.includes(ext)) {
    throw new BadRequestException(`Formato no soportado. Subí un archivo ${EXTENSIONES_SOPORTADAS.map((e) => '.' + e).join(', ')}.`);
  }
  if (buffer.length === 0) throw new BadRequestException('El archivo está vacío.');
  if (buffer.length > MAX_ARCHIVO_BYTES) {
    throw new BadRequestException(`El archivo supera el máximo de ${MAX_ARCHIVO_BYTES / 1024 / 1024} MB.`);
  }
  if (!coincideConFirma(ext, buffer)) {
    throw new BadRequestException(`El contenido no coincide con un archivo .${ext} válido.`);
  }

  let texto: string;
  try {
    if (ext === 'pdf') texto = await textoDePdf(buffer);
    else if (ext === 'docx') texto = await textoDeDocx(buffer);
    else if (ext === 'pptx') texto = await textoDePptx(buffer);
    else texto = buffer.toString('utf8');
  } catch {
    throw new BadRequestException(`No se pudo leer el archivo .${ext}: está dañado o protegido con contraseña.`);
  }

  texto = limpiarTexto(texto);
  if (!texto) {
    throw new BadRequestException(
      ext === 'pdf'
        ? 'El PDF no tiene texto seleccionable (probablemente es un escaneo). Todavía no se leen imágenes: subí una versión con texto.'
        : 'No se encontró texto en el archivo.',
    );
  }
  if (texto.length > MAX_CONTENIDO_MATERIAL) {
    throw new BadRequestException(
      `El texto extraído (${texto.length.toLocaleString('es-AR')} caracteres) supera el máximo de ${MAX_CONTENIDO_MATERIAL.toLocaleString('es-AR')}. Dividilo en varios materiales.`,
    );
  }
  return texto;
}
