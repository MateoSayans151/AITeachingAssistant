'use client';

import { useEffect, useRef } from 'react';

// Ventana modal con el mismo aspecto que el diálogo de Confirmar.tsx, pero con contenido propio (un formulario, una lista para tildar...).
// Esc y el clic afuera la cierran, el foco entra al abrir y vuelve al botón que la abrió, y Tab no sale de ella.
// Nunca usa los diálogos del navegador (ver sin-dialogos-nativos.test.ts).

export function Modal({
  titulo,
  onCerrar,
  children,
  ancho = 520,
  cerrable = true,
}: {
  titulo: string;
  onCerrar: () => void;
  children: React.ReactNode;
  /** Ancho máximo en píxeles. */
  ancho?: number;
  /** false mientras se está haciendo algo que no se puede interrumpir (Esc y clic afuera no cierran). */
  cerrable?: boolean;
}) {
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    const enfocable = caja.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-cerrar])');
    (enfocable ?? caja.current)?.focus();
    return () => anterior?.focus?.();
  }, []);

  function alTeclear(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && cerrable) {
      e.stopPropagation();
      onCerrar();
      return;
    }
    if (e.key !== 'Tab') return;
    const foco = Array.from(caja.current?.querySelectorAll<HTMLElement>('input:not([disabled]), select, textarea, button:not([disabled]), a[href]') ?? []);
    if (foco.length === 0) return;
    const primero = foco[0];
    const ultimo = foco[foco.length - 1];
    if (e.shiftKey && document.activeElement === primero) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (cerrable && e.target === e.currentTarget) onCerrar();
      }}
      onKeyDown={alTeclear}
    >
      <div ref={caja} className="dialog modal-ancho" style={{ width: `min(${ancho}px, 100%)`, maxHeight: '90vh', overflowY: 'auto' }} role="dialog" aria-modal="true" aria-label={titulo} tabIndex={-1}>
        <h2 className="dialog-title">{titulo}</h2>
        {children}
      </div>
    </div>
  );
}
