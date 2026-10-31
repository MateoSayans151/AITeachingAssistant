import Link from 'next/link';

export type PestanaExamen = 'examen' | 'respuestas' | 'vara';

/**
 * Las tres caras de un examen, como pestañas (el mismo control que usa la página de un curso): el examen en sí, sus respuestas y la
 * vara, que es una herramienta para ajustar las notas de esas respuestas y por eso vive al lado de ellas y no escondida entre botones.
 */
export function TabsExamen({ examenId, activa, cantidadRespuestas }: { examenId: string; activa: PestanaExamen; cantidadRespuestas?: number }) {
  const items: { clave: PestanaExamen; href: string; etiqueta: string }[] = [
    { clave: 'examen', href: `/examenes/${examenId}`, etiqueta: 'Examen' },
    { clave: 'respuestas', href: `/examenes/${examenId}/respuestas`, etiqueta: cantidadRespuestas !== undefined ? `Respuestas (${cantidadRespuestas})` : 'Respuestas' },
    { clave: 'vara', href: `/examenes/${examenId}/vara`, etiqueta: 'Vara' },
  ];
  return (
    <nav className="tabs" aria-label="Secciones del examen">
      {items.map((i) => (
        <Link
          key={i.clave}
          href={i.href}
          className={`tab ${activa === i.clave ? 'tab-active' : ''}`}
          aria-current={activa === i.clave ? 'page' : undefined}
          title={i.clave === 'vara' ? 'Subir o bajar las notas sugeridas de todos con una regla, por ejemplo que apruebe el 60 % de los alumnos' : undefined}
        >
          {i.etiqueta}
        </Link>
      ))}
    </nav>
  );
}
