// Juntar varios archivos de texto en un solo .zip (para descargar de una vez los CSV de varios exámenes: el navegador suele bloquear varias
// descargas seguidas). Se carga recién al usarlo, para no sumar peso a las pantallas que no lo necesitan.

export interface ArchivoDeTexto {
  nombre: string;
  contenido: string;
}

/** Arma el .zip con los archivos (texto UTF-8; el BOM del CSV se conserva) y devuelve los bytes. */
export async function armarZip(archivos: ArchivoDeTexto[]): Promise<Uint8Array> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  for (const a of archivos) zip.file(a.nombre, a.contenido);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
