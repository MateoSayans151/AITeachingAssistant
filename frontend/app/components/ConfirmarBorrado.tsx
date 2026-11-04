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
  descarga,
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
  /**
   * Opcional: un botón para quedarse con una copia de las respuestas (CSV) antes de borrar. `accion` baja el archivo y devuelve cuántas respuestas
   * descargó; si falla, tira un Error con el motivo. Nunca es obligatorio para borrar.
   */
  descarga?: { etiqueta: string; accion: () => Promise<number> };
}) {
  const [bajando, setBajando] = useState(false);
  const [resultadoDescarga, setResultadoDescarga] = useState<{ ok: boolean; texto: string } | null>(null);
  const [escrito, setEscrito] = useState('');
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coincide = coincideNombre(escrito, nombre);

  async function descargar() {
    if (!descarga || bajando) return;
    setBajando(true);
    setResultadoDescarga(null);
    try {
      const n = await descarga.accion();
      setResultadoDescarga({ ok: true, texto: `Listo: se descargó un archivo con ${n === 1 ? '1 respuesta' : `${n} respuestas`}.` });
    } catch (err) {
      setResultadoDescarga({ ok: false, texto: err instanceof Error ? err.message : 'No se pudo descargar. Probá de nuevo.' });
    } finally {
      setBajando(false);
    }
  }

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
    <Modal titulo={titulo} onCerrar={onCancelar} cerrable={!borrando && !bajando}>
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
        {descarga && (
          <div className="borrado-descarga">
            <button type="button" className="btn btn-secondary" onClick={descargar} disabled={bajando || borrando}>
              {bajando ? 'Preparando el archivo…' : descarga.etiqueta}
            </button>
            <span className="muted">Opcional: guarda una copia en tu computadora antes de borrar.</span>
            {resultadoDescarga && (
              <p role="status" className={resultadoDescarga.ok ? 'borrado-descarga-ok' : 'borrado-descarga-error'}>
                {resultadoDescarga.texto}
              </p>
            )}
          </div>
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
