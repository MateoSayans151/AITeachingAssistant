'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { cerrarSesion, useDocente } from '@/lib/auth';

/** `pathname` es `base` o cuelga de ella (`/cursos` y `/cursos/abc`, pero no `/cursos-viejos`). */
const cuelgaDe = (pathname: string | null, base: string) => pathname === base || !!pathname?.startsWith(`${base}/`);

// Orden: lo principal (exámenes por curso) primero; los trabajos prácticos (flujo simple) al final.
const LINKS: { href: string; label: string; activo: (pathname: string | null) => boolean }[] = [
  { href: '/', label: 'Inicio', activo: (p) => p === '/' },
  // Los exámenes cuelgan de un curso: mientras se mira uno, "Cursos" sigue marcado.
  { href: '/cursos', label: 'Cursos', activo: (p) => cuelgaDe(p, '/cursos') || cuelgaDe(p, '/examenes') },
  { href: '/matrices', label: 'Matrices de rúbrica', activo: (p) => cuelgaDe(p, '/matrices') },
  { href: '/trabajos', label: 'Trabajos prácticos', activo: (p) => cuelgaDe(p, '/trabajos') },
];

/**
 * Barra superior persistente, estilo "Cátedra" (el design system; marca + navegación + docente activo a
 * la derecha) — se muestra en todas las páginas del docente. `/rendir/[slug]` y
 * `/entregar/[slug]` son las únicas vistas públicas (el alumno no tiene sesión de docente)
 * y quedan afuera a propósito.
 */
export function TopNav() {
  const pathname = usePathname();
  const docente = useDocente();

  if (pathname?.startsWith('/rendir') || pathname?.startsWith('/entregar')) return null;

  return (
    <div className="topnav">
      <div className="topnav-left">
        <Link href="/" className="topnav-brand">
          AI Teaching Assistant
        </Link>
        <nav className="topnav-links">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} data-active={link.activo(pathname)}>
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
      {docente && (
        <div className="topnav-user">
          {docente.nombre} ·{' '}
          <button
            type="button"
            onClick={async () => {
              await cerrarSesion();
              window.location.href = '/';
            }}
            style={{ background: 'none', border: 0, padding: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
          >
            Salir
          </button>
        </div>
      )}
    </div>
  );
}
