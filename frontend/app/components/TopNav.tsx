'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Docente } from '@/lib/api';

const DOCENTE_STORAGE_KEY = 'ata_docente';

const LINKS = [
  { href: '/', label: 'Trabajos prácticos' },
  { href: '/cursos', label: 'Cátedra' },
  { href: '/matrices', label: 'Matrices' },
];

/**
 * Barra superior persistente, estilo "Cátedra" (marca + navegación + docente activo a
 * la derecha) — se muestra en todas las páginas del docente. `/rendir/[slug]` es la
 * única vista pública (el alumno no tiene sesión de docente) y queda afuera a propósito.
 */
export function TopNav() {
  const pathname = usePathname();
  const [docente, setDocente] = useState<Docente | null>(null);

  useEffect(() => {
    const raw = window.localStorage.getItem(DOCENTE_STORAGE_KEY);
    if (raw) setDocente(JSON.parse(raw));
  }, [pathname]);

  if (pathname?.startsWith('/rendir')) return null;

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
      {docente && <div className="topnav-user">{docente.nombre}</div>}
    </div>
  );
}
