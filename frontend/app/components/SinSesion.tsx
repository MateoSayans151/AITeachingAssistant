import Link from 'next/link';

/** Lo que se ve al entrar a una pantalla sin haber iniciado sesión: qué pasa y un botón para resolverlo (antes era solo un texto). */
export function SinSesion() {
  return (
    <div className="empty-state">
      <p style={{ marginBottom: 'var(--space-4)' }}>Para seguir necesitás iniciar sesión.</p>
      <Link href="/" className="btn btn-primary">
        Ir a iniciar sesión
      </Link>
    </div>
  );
}
