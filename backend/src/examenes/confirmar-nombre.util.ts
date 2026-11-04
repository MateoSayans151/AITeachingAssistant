// Confirmación por nombre para borrar un examen o un curso: el docente tiene que escribir el nombre. El frontend usa la misma
// regla (frontend/lib/confirmar-nombre.ts); un test comprueba que las dos coinciden.

export const MENSAJE_CONFIRMACION_NO_COINCIDE = 'El nombre que escribiste no coincide. Escribilo igual que aparece para confirmar que querés borrarlo.';

const normalizar = (texto: string) => (texto ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

/** ¿Lo escrito es el nombre? Ignora espacios de más y de los bordes; distingue mayúsculas (hay que escribirlo, no adivinarlo). */
export function coincideNombre(escrito: string | null | undefined, nombre: string): boolean {
  const esperado = normalizar(nombre);
  return esperado !== '' && normalizar(escrito ?? '') === esperado;
}
