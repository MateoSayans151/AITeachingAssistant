'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cerrarSesion, useSesion } from '@/lib/auth';

/** `pathname` es `base` o cuelga de ella (`/cursos` y `/cursos/abc`, pero no `/cursos-viejos`). */
const cuelgaDe = (pathname: string | null, base: string) => pathname === base || !!pathname?.startsWith(`${base}/`);

const iconoProps = { width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const;
const IconoCursos = () => (
  <svg {...iconoProps}>
    <path d="M3.5 4.5A1.5 1.5 0 0 1 5 3h10.5v13H5a1.5 1.5 0 0 0-1.5 1.5v-13z" />
    <path d="M3.5 17.5A1.5 1.5 0 0 1 5 16h10.5" />
  </svg>
);
const IconoMatrices = () => (
  <svg {...iconoProps}>
    <rect x="3" y="3" width="6" height="6" rx="1.4" />
    <rect x="11" y="3" width="6" height="6" rx="1.4" />
    <rect x="3" y="11" width="6" height="6" rx="1.4" />
    <rect x="11" y="11" width="6" height="6" rx="1.4" />
  </svg>
);
const IconoMarca = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M4.5 10.5l3.4 3.4 7.6-8" />
  </svg>
);

const LINKS: { href: string; label: string; icono: ReactNode; activo: (pathname: string | null) => boolean }[] = [
  // La lista de cursos ES el inicio. Los exámenes cuelgan de un curso: mientras se mira uno, "Cursos" sigue marcado.
  { href: '/', label: 'Cursos', icono: <IconoCursos />, activo: (p) => p === '/' || cuelgaDe(p, '/cursos') || cuelgaDe(p, '/examenes') },
  { href: '/matrices', label: 'Matrices de rúbrica', icono: <IconoMatrices />, activo: (p) => cuelgaDe(p, '/matrices') },
];

/**
 * Barra lateral persistente (marca, navegación y docente activo abajo): se muestra en todas las páginas del docente.
 * `/rendir/[slug]` es la única vista pública (el alumno no tiene sesión de docente) y queda afuera a propósito. Sin sesión
 * (la pantalla de ingreso) tampoco se muestra; mientras se averigua si hay sesión sí, solo con la marca, para que el contenido
 * no se corra cuando llega.
 */
export function SideNav() {
  const pathname = usePathname();
  const { docente, cargando } = useSesion();

  if (pathname?.startsWith('/rendir')) return null;
  if (!docente && !cargando) return null;

  return (
    <aside className="sidebar" aria-label="Navegación principal">
      <Link href="/" className="sidebar-marca">
        <span className="sidebar-logo" aria-hidden="true">
          <IconoMarca />
        </span>
        <span>AI Teaching Assistant</span>
      </Link>
      {docente && (
        <>
          <nav className="sidebar-nav">
            {LINKS.map((link) => {
              const activo = link.activo(pathname);
              return (
                <Link key={link.href} href={link.href} data-active={activo} aria-current={activo ? 'page' : undefined}>
                  {link.icono}
                  {link.label}
                </Link>
              );
            })}
          </nav>
          <div className="sidebar-usuario">
            <span className="sidebar-avatar" aria-hidden="true">
              {(docente.nombre.trim()[0] ?? '?').toUpperCase()}
            </span>
            <div className="sidebar-usuario-datos">
              <strong>{docente.nombre}</strong>
              <button
                type="button"
                onClick={async () => {
                  await cerrarSesion();
                  window.location.href = '/';
                }}
              >
                Salir
              </button>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
