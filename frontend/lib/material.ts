// Material de cátedra (pestaña "Material" del curso): validaciones del archivo ANTES de subirlo y textos con números. Son funciones
// puras (sin React ni red) para testearlas con node:test (backend/test/material.test.ts). Los topes son los del servidor
// (backend/src/materiales-curso/extractor-texto.util.ts): si cambian allá hay que cambiarlos acá.

export const MAX_ARCHIVO_BYTES = 4 * 1024 * 1024;
export const EXTENSIONES_MATERIAL = ['pdf', 'docx', 'pptx', 'md', 'txt'] as const;

/** "850 KB", "1,5 MB": el tamaño de un archivo como se lee en una pantalla. */
export function tamanoLegible(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Por qué un archivo no se puede subir, en lenguaje del docente, o null si está bien. Se chequea en el navegador para no hacerle
 * esperar la subida entera (hasta 4 MB) solo para decirle que el formato no sirve.
 */
export function problemaDelArchivo(archivo: { name: string; size: number }): string | null {
  const punto = archivo.name.lastIndexOf('.');
  const extension = punto < 0 ? '' : archivo.name.slice(punto + 1).toLowerCase();
  if (!(EXTENSIONES_MATERIAL as readonly string[]).includes(extension)) {
    return `“${archivo.name}” no es un formato que podamos leer. Subí un archivo .pdf, .docx, .pptx, .md o .txt.`;
  }
  if (archivo.size === 0) return `“${archivo.name}” está vacío.`;
  if (archivo.size > MAX_ARCHIVO_BYTES) {
    return `“${archivo.name}” pesa ${tamanoLegible(archivo.size)} y el máximo es ${MAX_ARCHIVO_BYTES / 1024 / 1024} MB. Probá exportarlo más liviano o dividirlo en partes.`;
  }
  return null;
}

/** "12.340 caracteres": cuánto texto se leyó del material (el docente ve así que el archivo se leyó). */
export function caracteresLegibles(contenido: string | null | undefined): string {
  const n = contenido?.length ?? 0;
  return `${n.toLocaleString('es-AR')} ${n === 1 ? 'carácter' : 'caracteres'}`;
}

/** Cuántos archivos se pueden elegir de una vez (se suben de a uno: más que esto vuelve eterna la espera sin que se sepa qué pasó). */
export const MAX_ARCHIVOS_POR_TANDA = 20;

export interface ArchivoRechazado {
  nombre: string;
  motivo: string;
}

/**
 * Qué archivos de los recién elegidos entran en la tanda y cuáles no, y por qué: formato o tamaño que no sirve (`problemaDelArchivo`),
 * uno que ya está en la lista (mismo nombre y mismo tamaño: es casi seguro el mismo) o que se pasa del tope de la tanda. Mantiene el
 * orden y no toca lo ya elegido. Funciona con cualquier objeto con `name` y `size` (un `File` en el navegador).
 */
export function clasificarArchivos<T extends { name: string; size: number }>(
  nuevos: T[],
  yaElegidos: { name: string; size: number }[],
  max: number = MAX_ARCHIVOS_POR_TANDA,
): { aceptados: T[]; rechazados: ArchivoRechazado[] } {
  const aceptados: T[] = [];
  const rechazados: ArchivoRechazado[] = [];
  const vistos = new Set(yaElegidos.map((a) => `${a.name}\u0000${a.size}`));
  for (const archivo of nuevos) {
    const clave = `${archivo.name}\u0000${archivo.size}`;
    const problema = problemaDelArchivo(archivo);
    if (problema) {
      rechazados.push({ nombre: archivo.name, motivo: problema });
    } else if (vistos.has(clave)) {
      rechazados.push({ nombre: archivo.name, motivo: `“${archivo.name}” ya estaba en la lista.` });
    } else if (yaElegidos.length + aceptados.length >= max) {
      rechazados.push({ nombre: archivo.name, motivo: `“${archivo.name}” no entra: se pueden subir hasta ${max} archivos por vez. Subí estos y después elegí los demás.` });
    } else {
      vistos.add(clave);
      aceptados.push(archivo);
    }
  }
  return { aceptados, rechazados };
}

/** "3 archivos" / "1 archivo". */
export const cantidadDeArchivos = (n: number): string => `${n} ${n === 1 ? 'archivo' : 'archivos'}`;
