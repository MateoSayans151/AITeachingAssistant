'use client';

import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { buscarPorTexto, indiceDe, moverIndice, primerHabilitado } from '@/lib/desplegable';
import type { OpcionDesplegable } from '@/lib/desplegable';

export type { OpcionDesplegable };

/**
 * Menú desplegable con el aspecto del resto de la app (el `<select>` del navegador abre una lista del sistema que no se puede estilar).
 * Funciona como el nativo: se abre con clic, Enter, espacio o flechas; se mueve con las flechas, Inicio y Fin; escribir una letra salta a la opción;
 * Enter elige, Esc cierra. La lista sale por un portal, así no la recorta una ventana con scroll (los diálogos).
 *
 * Reemplaza a `<select>`: en vez de `<option>`, recibe `opciones`; y `onChange` recibe el valor, no el evento.
 */
export function Desplegable({
  id,
  value,
  onChange,
  opciones,
  placeholder = 'Elegí…',
  disabled = false,
  ariaLabel,
  className,
  ariaInvalid,
}: {
  id?: string;
  value: string;
  onChange: (valor: string) => void;
  opciones: OpcionDesplegable[];
  /** Lo que se ve cuando `value` no coincide con ninguna opción. */
  placeholder?: string;
  disabled?: boolean;
  /** Obligatorio si no hay un `<label htmlFor={id}>` que lo nombre. */
  ariaLabel?: string;
  /** Clases extra para el botón (por si una pantalla le da su propio tamaño). */
  className?: string;
  ariaInvalid?: boolean;
}) {
  const idAuto = useId();
  const idBoton = id ?? `desp-${idAuto}`;
  const idLista = `${idBoton}-lista`;
  const boton = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [resaltada, setResaltada] = useState(-1);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; arriba: boolean; alto: number } | null>(null);
  const escrito = useRef({ texto: '', t: 0 });

  const elegida = indiceDe(opciones, value);
  const etiqueta = elegida >= 0 ? opciones[elegida].etiqueta : null;

  const abrir = useCallback(() => {
    if (disabled) return;
    setResaltada(elegida >= 0 && !opciones[elegida].deshabilitada ? elegida : primerHabilitado(opciones, 'inicio'));
    setAbierto(true);
  }, [disabled, elegida, opciones]);

  const cerrar = useCallback((devolverFoco = true) => {
    setAbierto(false);
    if (devolverFoco) boton.current?.focus();
  }, []);

  function elegir(i: number) {
    const o = opciones[i];
    if (!o || o.deshabilitada) return;
    if (o.valor !== value) onChange(o.valor);
    cerrar();
  }

  // Posición de la lista junto al botón (fixed): hacia abajo, o hacia arriba si abajo no entra. Se recalcula al hacer scroll o cambiar el tamaño.
  const ubicar = useCallback(() => {
    const r = boton.current?.getBoundingClientRect();
    if (!r) return;
    const abajo = window.innerHeight - r.bottom - 8;
    const arribaEspacio = r.top - 8;
    const necesita = Math.min(opciones.length * 44 + 8, 288);
    const arriba = abajo < necesita && arribaEspacio > abajo;
    setPos({ left: r.left, top: arriba ? r.top - 4 : r.bottom + 4, width: r.width, arriba, alto: Math.max(120, Math.min(288, arriba ? arribaEspacio : abajo)) });
  }, [opciones.length]);

  useLayoutEffect(() => {
    if (!abierto) return;
    ubicar();
    window.addEventListener('resize', ubicar);
    window.addEventListener('scroll', ubicar, true);
    return () => {
      window.removeEventListener('resize', ubicar);
      window.removeEventListener('scroll', ubicar, true);
    };
  }, [abierto, ubicar]);

  // Clic afuera cierra (sin robarle el foco a lo que se tocó).
  useEffect(() => {
    if (!abierto) return;
    const alTocar = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (boton.current?.contains(t) || lista.current?.contains(t)) return;
      cerrar(false);
    };
    document.addEventListener('mousedown', alTocar);
    document.addEventListener('touchstart', alTocar);
    return () => {
      document.removeEventListener('mousedown', alTocar);
      document.removeEventListener('touchstart', alTocar);
    };
  }, [abierto, cerrar]);

  // La opción resaltada se mantiene a la vista al moverse con el teclado.
  useEffect(() => {
    if (!abierto || resaltada < 0) return;
    lista.current?.querySelector<HTMLElement>(`[data-i="${resaltada}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [abierto, resaltada, pos]);

  function alTeclear(e: React.KeyboardEvent) {
    if (disabled) return;
    const k = e.key;
    if (!abierto) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') {
        e.preventDefault();
        abrir();
      }
      return;
    }
    if (k === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // no cierra también el diálogo que lo contiene
      cerrar();
    } else if (k === 'ArrowDown') {
      e.preventDefault();
      setResaltada((r) => moverIndice(opciones, r, 1));
    } else if (k === 'ArrowUp') {
      e.preventDefault();
      setResaltada((r) => moverIndice(opciones, r, -1));
    } else if (k === 'Home') {
      e.preventDefault();
      setResaltada(primerHabilitado(opciones, 'inicio'));
    } else if (k === 'End') {
      e.preventDefault();
      setResaltada(primerHabilitado(opciones, 'fin'));
    } else if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      elegir(resaltada);
    } else if (k === 'Tab') {
      cerrar(false);
    } else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Buscar escribiendo: las letras seguidas (menos de 1 s entre una y otra) forman una sola palabra.
      const ahora = Date.now();
      const previo = ahora - escrito.current.t < 1000 ? escrito.current.texto : '';
      escrito.current = { texto: previo + k, t: ahora };
      const i = buscarPorTexto(opciones, escrito.current.texto, resaltada);
      if (i >= 0) setResaltada(i);
    }
  }

  return (
    <>
      <button
        ref={boton}
        id={idBoton}
        type="button"
        className={`desplegable ${abierto ? 'desplegable-abierto' : ''} ${className ?? ''}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-controls={abierto ? idLista : undefined}
        aria-activedescendant={abierto && resaltada >= 0 ? `${idBoton}-op-${resaltada}` : undefined}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid || undefined}
        disabled={disabled}
        onClick={() => (abierto ? cerrar() : abrir())}
        onKeyDown={alTeclear}
      >
        <span className={etiqueta === null ? 'desplegable-placeholder' : undefined}>{etiqueta ?? placeholder}</span>
        <svg className="desplegable-flecha" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {abierto &&
        pos &&
        createPortal(
          <ul
            ref={lista}
            id={idLista}
            role="listbox"
            aria-labelledby={idBoton}
            className="desplegable-lista"
            style={{
              left: pos.left,
              width: pos.width,
              maxHeight: pos.alto,
              ...(pos.arriba ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
            }}
          >
            {opciones.map((o, i) => (
              <Fragment key={`${i}-${o.valor}`}>
                {o.grupo && o.grupo !== opciones[i - 1]?.grupo && (
                  <li role="presentation" className="desplegable-grupo">
                    {o.grupo}
                  </li>
                )}
              <li
                id={`${idBoton}-op-${i}`}
                data-i={i}
                role="option"
                aria-selected={i === elegida}
                aria-disabled={o.deshabilitada || undefined}
                className={`desplegable-opcion ${i === resaltada ? 'desplegable-opcion-activa' : ''} ${i === elegida ? 'desplegable-opcion-elegida' : ''} ${o.deshabilitada ? 'desplegable-opcion-off' : ''}`}
                onMouseEnter={() => !o.deshabilitada && setResaltada(i)}
                // mousedown (no click): se elige antes de que el botón pierda el foco.
                onMouseDown={(e) => {
                  e.preventDefault();
                  elegir(i);
                }}
              >
                <span>{o.etiqueta}</span>
                {i === elegida && (
                  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="desplegable-tilde">
                    <path d="M3.5 8.5l3 3 6-7" />
                  </svg>
                )}
              </li>
              </Fragment>
            ))}
            {opciones.length === 0 && <li className="desplegable-vacio">No hay opciones.</li>}
          </ul>,
          document.body,
        )}
    </>
  );
}
