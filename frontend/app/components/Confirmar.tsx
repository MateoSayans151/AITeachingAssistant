'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// Confirmación propia en lugar de `window.confirm`: el diálogo nativo no se muestra (o devuelve "no") en los navegadores
// embebidos de WhatsApp, Instagram o Gmail, donde muchos alumnos abren el link del examen, y entonces no podían entregar.
// Se usa con `const confirmar = useConfirmar()` y `if (!(await confirmar({ mensaje: '…' }))) return;`.

export interface OpcionesConfirmar {
  /** Frase corta que dice qué se va a hacer. Si se omite, el mensaje es lo único que se muestra. */
  titulo?: string;
  /** Detalle: se respetan los saltos de línea. */
  mensaje: string;
  /** Texto del botón que confirma (por defecto "Aceptar"). Conviene un verbo: "Entregar", "Publicar", "Eliminar". */
  textoConfirmar?: string;
  /** Texto del botón que cancela (por defecto "Cancelar"). */
  textoCancelar?: string;
  /** La acción no se puede deshacer: el botón de confirmar se muestra en rojo y el foco empieza en "Cancelar". */
  peligrosa?: boolean;
}

type Confirmar = (opciones: OpcionesConfirmar) => Promise<boolean>;

const ConfirmarContext = createContext<Confirmar | null>(null);

/** Devuelve la función que abre el diálogo y resuelve true (confirmó) o false (canceló, Esc o clic afuera). */
export function useConfirmar(): Confirmar {
  const confirmar = useContext(ConfirmarContext);
  // Sin proveedor (tests o una pantalla aislada) se cae al diálogo del navegador en vez de romper.
  return confirmar ?? (async ({ titulo, mensaje }) => window.confirm(titulo ? `${titulo}\n\n${mensaje}` : mensaje));
}

interface Pendiente extends OpcionesConfirmar {
  resolver: (confirmado: boolean) => void;
}

export function ConfirmarProvider({ children }: { children: React.ReactNode }) {
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const pendienteRef = useRef<Pendiente | null>(null);
  pendienteRef.current = pendiente;

  const confirmar = useCallback<Confirmar>(
    (opciones) =>
      new Promise<boolean>((resolver) => {
        // Si ya había uno abierto se lo cancela: nunca quedan dos promesas colgadas.
        pendienteRef.current?.resolver(false);
        setPendiente({ ...opciones, resolver });
      }),
    [],
  );

  function cerrar(confirmado: boolean) {
    pendienteRef.current?.resolver(confirmado);
    setPendiente(null);
  }

  return (
    <ConfirmarContext.Provider value={confirmar}>
      {children}
      {pendiente && <Dialogo pendiente={pendiente} onCerrar={cerrar} />}
    </ConfirmarContext.Provider>
  );
}

function Dialogo({ pendiente, onCerrar }: { pendiente: Pendiente; onCerrar: (confirmado: boolean) => void }) {
  const cancelarRef = useRef<HTMLButtonElement>(null);
  const confirmarRef = useRef<HTMLButtonElement>(null);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Al cerrar, el foco vuelve al botón que lo abrió (el teclado no se pierde al principio de la página).
    const anterior = document.activeElement as HTMLElement | null;
    (pendiente.peligrosa ? cancelarRef : confirmarRef).current?.focus();
    return () => anterior?.focus?.();
  }, [pendiente.peligrosa]);

  function alTeclear(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCerrar(false);
      return;
    }
    // Trampa de foco: Tab no sale del diálogo.
    if (e.key === 'Tab') {
      const botones = Array.from(caja.current?.querySelectorAll<HTMLElement>('button') ?? []);
      if (botones.length === 0) return;
      const primero = botones[0];
      const ultimo = botones[botones.length - 1];
      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar(false);
      }}
      onKeyDown={alTeclear}
    >
      <div
        ref={caja}
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={pendiente.titulo ? 'confirmar-titulo' : undefined}
        aria-describedby="confirmar-mensaje"
      >
        {pendiente.titulo && (
          <h2 id="confirmar-titulo" className="dialog-title">
            {pendiente.titulo}
          </h2>
        )}
        <p id="confirmar-mensaje" className="dialog-message">
          {pendiente.mensaje}
        </p>
        <div className="dialog-actions">
          <button ref={cancelarRef} type="button" className="btn btn-secondary" onClick={() => onCerrar(false)}>
            {pendiente.textoCancelar ?? 'Cancelar'}
          </button>
          <button
            ref={confirmarRef}
            type="button"
            className={`btn ${pendiente.peligrosa ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => onCerrar(true)}
          >
            {pendiente.textoConfirmar ?? 'Aceptar'}
          </button>
        </div>
      </div>
    </div>
  );
}
