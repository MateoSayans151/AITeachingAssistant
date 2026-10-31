'use client';

// El título de la página, editable en el lugar (como el «Formulario sin título» de Google Forms): no hay un campo aparte, el
// encabezado ES el campo. Se ve como un título; al pasar el mouse aparece la línea de abajo y un lápiz, y al enfocarlo se
// subraya. Nunca queda vacío: si se lo deja en blanco al salir, vuelve el nombre por defecto.
//
// Con `onConfirmar` (examen ya creado) el nombre se guarda en el servidor al salir del campo o con Enter, y se muestra el
// estado ("Guardando…", "✓ Guardado" o un error con la posibilidad de reintentar). Sin él (examen todavía sin crear) solo
// actualiza el formulario.

import { useRef, useState } from 'react';
import { TITULO_POR_DEFECTO } from '@/lib/examen-form';

export interface TituloEditableProps {
  valor: string;
  onCambiar: (valor: string) => void;
  /** Guarda el nombre en el servidor; si rechaza (lanza), se muestra el error y se puede reintentar. */
  onConfirmar?: (valor: string) => Promise<unknown>;
}

type Estado = 'libre' | 'guardando' | 'guardado' | 'error';

export function TituloEditable({ valor, onCambiar, onConfirmar }: TituloEditableProps) {
  const ultimoGuardado = useRef(valor);
  const [estado, setEstado] = useState<Estado>('libre');

  async function terminar() {
    const limpio = valor.replace(/\s+/g, ' ').trim() || TITULO_POR_DEFECTO;
    if (limpio !== valor) onCambiar(limpio);
    if (!onConfirmar || limpio === ultimoGuardado.current) return;
    setEstado('guardando');
    try {
      await onConfirmar(limpio);
      ultimoGuardado.current = limpio;
      setEstado('guardado');
      setTimeout(() => setEstado((e) => (e === 'guardado' ? 'libre' : e)), 2500);
    } catch {
      setEstado('error');
    }
  }

  return (
    <div className="titulo-editable-caja">
      <h1>
        <input
          className="titulo-editable"
          value={valor}
          maxLength={200}
          aria-label="Nombre del examen: tocalo para cambiarlo"
          onChange={(e) => onCambiar(e.target.value)}
          // Con el nombre por defecto, al entrar queda todo seleccionado: lo primero que se escribe lo reemplaza.
          onFocus={(e) => {
            if (e.target.value === TITULO_POR_DEFECTO) e.target.select();
          }}
          onBlur={terminar}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
        <svg className="titulo-editable-lapiz" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M2.5 13.5l.7-3L11 2.7a1.4 1.4 0 0 1 2 2L5.3 12.5l-2.8 1z" />
        </svg>
      </h1>
      <span className={estado === 'error' ? 'estado-error' : 'estado-guardado'} role="status" aria-live="polite">
        {estado === 'guardando' && 'Guardando…'}
        {estado === 'guardado' && '✓ Guardado'}
        {estado === 'error' && 'No pudimos guardar el nombre. Tocá el título y salí del campo para reintentar.'}
      </span>
    </div>
  );
}
