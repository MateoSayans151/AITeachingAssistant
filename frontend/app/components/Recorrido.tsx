'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { PasoRecorrido, recorridoDe } from '@/lib/guia';
import s from './Recorrido.module.css';

// «Mostrame esta pantalla»: oscurece la pantalla real y va señalando sus partes, una por vez. No cambia nada: mientras está abierto no
// se puede tocar lo de abajo. Los pasos salen de lib/guia.ts y apuntan a elementos con `data-guia`.
// Se usa con `const { disponible, iniciar } = useRecorrido()`.

interface ContextoRecorrido {
  /** Esta pantalla tiene recorrido. */
  disponible: boolean;
  iniciar: () => void;
}

const Contexto = createContext<ContextoRecorrido>({ disponible: false, iniciar: () => {} });

export const useRecorrido = () => useContext(Contexto);

const MARGEN_FOCO = 8;
const SEPARACION_TARJETA = 16;
const BORDE_VENTANA = 16;
const ANCHO_BOTTOM_SHEET = 560;

function elementoDe(paso: PasoRecorrido): HTMLElement | null {
  if (!paso.destino) return null;
  const el = document.querySelector<HTMLElement>(`[data-guia="${paso.destino}"]`);
  return el && el.getClientRects().length > 0 ? el : null;
}

const movimientoReducido = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function RecorridoProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [pasos, setPasos] = useState<PasoRecorrido[] | null>(null);
  const recorrido = recorridoDe(pathname);

  // Otra pantalla, otro recorrido: el que estaba abierto ya no señala nada.
  useEffect(() => setPasos(null), [pathname]);

  const iniciar = useCallback(() => {
    if (!recorrido) return;
    // Solo lo que hoy está en la pantalla: un examen sin respuestas no tiene filtros, y un paso del asistente no muestra los otros.
    setPasos(recorrido.pasos.filter((p) => !p.destino || elementoDe(p)));
  }, [recorrido]);

  const valor = useMemo(() => ({ disponible: recorrido !== null, iniciar }), [recorrido, iniciar]);

  return (
    <Contexto.Provider value={valor}>
      {children}
      {pasos && pasos.length > 0 && <Superposicion pasos={pasos} onCerrar={() => setPasos(null)} />}
    </Contexto.Provider>
  );
}

function Superposicion({ pasos, onCerrar }: { pasos: PasoRecorrido[]; onCerrar: () => void }) {
  const [indice, setIndice] = useState(0);
  const [foco, setFoco] = useState<DOMRect | null>(null);
  const [posicion, setPosicion] = useState<{ top: number; left: number } | null>(null);
  const tarjeta = useRef<HTMLDivElement>(null);
  const siguiente = useRef<HTMLButtonElement>(null);

  const paso = pasos[indice];
  const ultimo = indice === pasos.length - 1;

  // El foco del teclado vuelve a donde estaba al cerrar.
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    return () => anterior?.focus?.();
  }, []);

  useEffect(() => {
    siguiente.current?.focus();
  }, [indice]);

  // Lleva el elemento a la vista y lo sigue si la página se mueve o cambia de tamaño.
  useEffect(() => {
    const el = elementoDe(paso);
    if (!el) {
      setFoco(null);
      return;
    }
    const alto = el.getBoundingClientRect().height;
    el.scrollIntoView({ block: alto > window.innerHeight * 0.6 ? 'start' : 'center', behavior: movimientoReducido() ? 'auto' : 'smooth' });
    const medir = () => setFoco(el.getBoundingClientRect());
    medir();
    window.addEventListener('scroll', medir, true);
    window.addEventListener('resize', medir);
    return () => {
      window.removeEventListener('scroll', medir, true);
      window.removeEventListener('resize', medir);
    };
  }, [paso]);

  // La tarjeta va debajo del elemento; si no entra, arriba; si tampoco, sobre él. En el celular es una hoja fija abajo (la pone el CSS).
  useLayoutEffect(() => {
    const caja = tarjeta.current;
    if (!caja || !foco || window.innerWidth <= ANCHO_BOTTOM_SHEET) {
      setPosicion(null);
      return;
    }
    const { offsetWidth: ancho, offsetHeight: alto } = caja;
    const abajo = foco.bottom + MARGEN_FOCO + SEPARACION_TARJETA;
    const arriba = foco.top - MARGEN_FOCO - SEPARACION_TARJETA - alto;
    const maxTop = window.innerHeight - alto - BORDE_VENTANA;
    const top = abajo <= maxTop ? abajo : arriba >= BORDE_VENTANA ? arriba : Math.max(BORDE_VENTANA, maxTop);
    const left = Math.min(Math.max(foco.left + foco.width / 2 - ancho / 2, BORDE_VENTANA), window.innerWidth - ancho - BORDE_VENTANA);
    setPosicion({ top, left });
  }, [foco, indice]);

  const avanzar = useCallback(() => (ultimo ? onCerrar() : setIndice((i) => i + 1)), [ultimo, onCerrar]);
  const retroceder = useCallback(() => setIndice((i) => Math.max(i - 1, 0)), []);

  function alTeclear(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCerrar();
    } else if (e.key === 'ArrowRight') {
      avanzar();
    } else if (e.key === 'ArrowLeft') {
      retroceder();
    } else if (e.key === 'Tab') {
      // Trampa de foco: Tab no sale de la tarjeta.
      const botones = Array.from(tarjeta.current?.querySelectorAll<HTMLElement>('button') ?? []);
      const primero = botones[0];
      const final = botones[botones.length - 1];
      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        final?.focus();
      } else if (!e.shiftKey && document.activeElement === final) {
        e.preventDefault();
        primero?.focus();
      }
    }
  }

  return (
    <div className={s.capa} onKeyDown={alTeclear}>
      {/* Tapa toda la pantalla: lo de abajo se ve, pero no se puede tocar. */}
      <div className={foco ? s.bloqueo : `${s.bloqueo} ${s.fondo}`} />
      {foco && (
        <div
          className={s.foco}
          aria-hidden="true"
          style={{
            width: foco.width + MARGEN_FOCO * 2,
            height: foco.height + MARGEN_FOCO * 2,
            transform: `translate3d(${foco.left - MARGEN_FOCO}px, ${foco.top - MARGEN_FOCO}px, 0)`,
          }}
        >
          <span key={indice} className={s.pulso} />
        </div>
      )}
      <div
        ref={tarjeta}
        className={s.tarjeta}
        data-centrada={!foco}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recorrido-titulo"
        aria-describedby="recorrido-texto"
        style={foco && posicion ? { top: posicion.top, left: posicion.left } : undefined}
      >
        <div key={indice} className={s.contenido} aria-live="polite">
          <p className={s.contador}>
            Paso {indice + 1} de {pasos.length}
          </p>
          <h2 id="recorrido-titulo" className={s.titulo}>
            {paso.titulo}
          </h2>
          <p id="recorrido-texto" className={s.texto}>
            {paso.texto}
          </p>
        </div>
        <div className={s.barra} aria-hidden="true">
          <span className={s.barraRelleno} style={{ transform: `scaleX(${(indice + 1) / pasos.length})` }} />
        </div>
        <div className={s.acciones}>
          <button type="button" className="btn btn-ghost" onClick={onCerrar}>
            Cerrar
          </button>
          <span className={s.separador} />
          {indice > 0 && (
            <button type="button" className="btn btn-secondary" onClick={retroceder}>
              Atrás
            </button>
          )}
          <button ref={siguiente} type="button" className="btn btn-primary" onClick={avanzar}>
            {ultimo ? 'Listo' : 'Siguiente'}
          </button>
        </div>
      </div>
    </div>
  );
}
