'use client';

import { useState } from 'react';
import { Modal } from './Modal';
import { coincideNombre } from '@/lib/confirmar-nombre';

/**
 * Borrar algo que no se puede deshacer (un examen, un curso): hay que escribir su nombre. Un clic sin querer no alcanza.
 * `onConfirmar` hace el borrado y, si falla, tira un Error con el motivo para mostrarlo acá mismo (el diálogo queda abierto).
 */
export function ConfirmarBorrado({
  titulo,
  nombre,
  etiquetaNombre,
  perdida,
  textoConfirmar,
  onConfirmar,
  onCancelar,
}: {
  titulo: string;
  /** Lo que hay que escribir: el nombre del examen o del curso. */
  nombre: string;
  /** «examen» o «curso»: para el rótulo del campo. */
  etiquetaNombre: string;
  /** Qué se pierde, una cosa por renglón ("12 respuestas de alumnos", "3 exámenes"...). */
  perdida: string[];
  textoConfirmar: string;
  onConfirmar: () => Promise<void>;
  onCancelar: () => void;
}) {
  const [escrito, setEscrito] = useState('');
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coincide = coincideNombre(escrito, nombre);

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    if (!coincide || borrando) return;
    setBorrando(true);
    setError(null);
    try {
      await onConfirmar();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar. Probá de nuevo.');
      setBorrando(false);
    }
  }

  return (
    <Modal titulo={titulo} onCerrar={onCancelar} cerrable={!borrando}>
      <form onSubmit={confirmar}>
        <p className="dialog-message">
          Esto no se puede deshacer. Se borra {perdida.length > 0 ? 'con todo lo que tiene:' : 'por completo.'}
        </p>
        {perdida.length > 0 && (
          <ul className="borrado-perdida">
            {perdida.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <div className="field">
          <label htmlFor="confirmar-nombre">
            Para confirmar, escribí el nombre del {etiquetaNombre}: <strong className="borrado-nombre">{nombre}</strong>
          </label>
          <input
            id="confirmar-nombre"
            value={escrito}
            onChange={(e) => setEscrito(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={borrando}
            aria-invalid={escrito !== '' && !coincide}
          />
        </div>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancelar} disabled={borrando}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-danger" disabled={!coincide || borrando}>
            {borrando ? 'Borrando…' : textoConfirmar}
          </button>
        </div>
      </form>
    </Modal>
  );
}
