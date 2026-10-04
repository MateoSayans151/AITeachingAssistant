'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { cerrarSesion, useDocente } from '@/lib/auth';

const LINKS = [
  { href: '/', label: 'Trabajos prácticos' },
  { href: '/cursos', label: 'Cátedra' },
  { href: '/matrices', label: 'Matrices' },
];

/**
 * Barra superior persistente, estilo "Cátedra" (marca + navegación + docente activo a
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
            <Link
              key={link.href}
              href={link.href}
              data-active={pathname === link.href || (link.href !== '/' && pathname?.startsWith(link.href))}
            >
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
