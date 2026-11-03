'use client';

import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { plural } from '@/lib/texto';
import { alternarTodos, filtrarDestinatarios, preseleccion, resumenSeleccion } from '@/lib/destinatarios';
import type { DestinatarioLista } from '@/lib/destinatarios';

const fecha = (iso: string) => new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Elegir a quiénes mandarles un mail (el link del examen o su nota) antes de enviarlo: con un botón para marcar o desmarcar todos, una
 * búsqueda, y a la vista quién ya lo recibió. Se puede volver a mandar a quien ya lo recibió: basta con tildarlo de nuevo. Así el
 * docente no gasta el cupo diario de mails cada vez que usa la función.
 */
export function SelectorDestinatarios({
  titulo,
  explicacion,
  lista,
  verbo,
  avisoModoPrueba,
  onEnviar,
  onCancelar,
  alternativa,
}: {
  titulo: string;
  explicacion: string;
  lista: DestinatarioLista[];
  /** Lo que reciben: «la invitación» o «su nota». */
  verbo: { lo: string; yaLo: string };
  /** Si el servidor está en modo prueba: a qué casilla llegan en realidad. */
  avisoModoPrueba?: string | null;
  /** Hace el envío; si falla tira un Error con el motivo, que se muestra acá. */
  onEnviar: (ids: string[]) => Promise<void>;
  onCancelar: () => void;
  /** Otra salida que no manda ningún mail (por ejemplo «Publicar sin enviar mails»). Si falla tira un Error con el motivo. */
  alternativa?: { texto: string; onClick: () => Promise<void> };
}) {
  const [elegidos, setElegidos] = useState<Set<string>>(() => preseleccion(lista));
  const [busqueda, setBusqueda] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibles = useMemo(() => filtrarDestinatarios(lista, busqueda), [lista, busqueda]);
  const { total, nuevos, repetidos } = resumenSeleccion(lista, elegidos);
  const todosVisiblesMarcados = visibles.length > 0 && visibles.every((d) => elegidos.has(d.id));

  function alternar(id: string) {
    setElegidos((previo) => {
      const siguiente = new Set(previo);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });
  }

  async function sinEnviar() {
    if (!alternativa || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      await alternativa.onClick();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar. Probá de nuevo.');
      setEnviando(false);
    }
  }

  async function enviar() {
    if (total === 0 || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      await onEnviar([...elegidos]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron mandar los mails. Probá de nuevo.');
      setEnviando(false);
    }
  }

  return (
    <Modal titulo={titulo} onCerrar={onCancelar} ancho={640} cerrable={!enviando}>
      <p className="dialog-message">{explicacion}</p>
      {avisoModoPrueba && (
        <p className="muted" role="status">
          Modo prueba: los mails llegan a <strong>{avisoModoPrueba}</strong>, no a los alumnos.
        </p>
      )}

      <div className="selector-barra">
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre o mail"
          aria-label="Buscar alumno"
          disabled={enviando}
        />
        <button type="button" className="btn btn-secondary" onClick={() => setElegidos(alternarTodos(lista, elegidos, visibles))} disabled={enviando || visibles.length === 0}>
          {todosVisiblesMarcados ? 'Desmarcar todos' : busqueda ? 'Marcar los que se ven' : 'Marcar todos'}
        </button>
      </div>

      <ul className="selector-lista" aria-label="Alumnos">
        {visibles.map((d) => (
          <li key={d.id}>
            <label className="selector-fila">
              <input type="checkbox" checked={elegidos.has(d.id)} onChange={() => alternar(d.id)} disabled={enviando} />
              <span className="selector-datos">
                <strong>{d.nombre}</strong>
                <span className="muted">{d.email}</span>
                {d.detalle && <span className="muted">{d.detalle}</span>}
              </span>
              {d.enCamino ? (
                <span className="badge badge-pendiente">Enviándose…</span>
              ) : d.enviadoEn ? (
                <span className="badge badge-revisado" title={d.veces && d.veces > 1 ? `Se le mandó ${d.veces} veces` : undefined}>
                  {verbo.yaLo} el {fecha(d.enviadoEn)}
                </span>
              ) : d.error ? (
                <span className="badge" style={{ background: 'var(--color-error-soft)', color: 'var(--color-error)' }} title={d.error}>
                  Falló el envío
                </span>
              ) : (
                <span className="badge badge-pendiente">Sin enviar</span>
              )}
            </label>
          </li>
        ))}
        {visibles.length === 0 && <li className="muted selector-vacio">No hay alumnos que coincidan con la búsqueda.</li>}
      </ul>

      <p className="selector-resumen" role="status">
        <strong>{total === 0 ? 'No elegiste a nadie' : `Se va a mandar ${plural(total, 'mail', 'mails')}`}</strong>
        {repetidos > 0 && (
          <span className="muted">
            {' '}
            · {plural(repetidos, 'alumno', 'alumnos')} ya {repetidos === 1 ? 'lo había recibido y se le vuelve' : 'lo habían recibido y se les vuelve'} a mandar
          </span>
        )}
        {nuevos > 0 && repetidos > 0 && <span className="muted"> · {nuevos} {nuevos === 1 ? 'nuevo' : 'nuevos'}</span>}
      </p>
      <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>
        El plan gratuito de Resend permite 100 mails por día; elegí solo a quienes lo necesitan.
      </p>

      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </button>
        {alternativa && (
          <button type="button" className="btn btn-ghost" onClick={sinEnviar} disabled={enviando}>
            {alternativa.texto}
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={enviar} disabled={total === 0 || enviando}>
          {enviando ? 'Enviando…' : total === 0 ? 'Mandar mails' : `Mandar a ${plural(total, 'alumno', 'alumnos')}`}
        </button>
      </div>
    </Modal>
  );
}
