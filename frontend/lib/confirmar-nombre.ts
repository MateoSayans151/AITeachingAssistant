// Confirmar un borrado escribiendo el nombre. Es la misma regla que aplica el servidor (backend/src/examenes/confirmar-nombre.util.ts):
// si cambia allá hay que cambiarla acá (un test las compara).

const normalizar = (texto: string) => (texto ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

/** ¿Lo escrito es el nombre? Ignora espacios de más y de los bordes; distingue mayúsculas (hay que escribirlo, no adivinarlo). */
export function coincideNombre(escrito: string | null | undefined, nombre: string): boolean {
  const esperado = normalizar(nombre);
  return esperado !== '' && normalizar(escrito ?? '') === esperado;
}
