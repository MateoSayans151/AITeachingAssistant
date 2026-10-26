// Textos de la interfaz que se arman con números.

/** "1 alumno" / "3 alumnos": el número con su sustantivo en singular o plural. */
export function plural(cantidad: number, singular: string, plural: string): string {
  return `${cantidad} ${cantidad === 1 ? singular : plural}`;
}
