'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Modal } from './Modal';
import { Desplegable } from './Desplegable';
import { SelectorFecha } from './SelectorFecha';
import { plural } from '@/lib/texto';
import { isoAFechaLocal, fechaLocalAIso } from '@/lib/fechas';
import { mensajeDeError } from '@/lib/errores';
import { actualizarDatosExamen, actualizarPublicacion, cerrarExamen, getEnCurso, reabrirExamen } from '@/lib/api';
import type { Examen, ExamenComision, FeedbackModo } from '@/lib/api';

// Los diálogos con los que el docente maneja un examen en marcha: cerrarlo, reabrirlo, editar sus datos y mover las fechas de un link.
// Cada uno hace su pedido al servidor y avisa a la pantalla con `onListo` para que recargue.

/** Cerrar el examen: nadie nuevo puede empezar. Si hay alumnos rindiendo, el docente elige qué pasa con ellos con los números a la vista. */
export function CerrarExamenModal({ examenId, onListo, onCancelar }: { examenId: string; onListo: (mensaje: string) => void; onCancelar: () => void }) {
  const [enCurso, setEnCurso] = useState<number | null>(null);
  const [entregar, setEntregar] = useState<boolean | null>(null);
  const [cerrando, setCerrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    getEnCurso(examenId)
      .then((r) => !cancelado && setEnCurso(r.enCurso))
      .catch(() => !cancelado && setEnCurso(-1)); // sin el dato se cierra igual, pero obligando a elegir
    return () => {
      cancelado = true;
    };
  }, [examenId]);

  const hayRindiendo = enCurso === null || enCurso !== 0; // mientras carga, o si no se pudo saber, se pide elegir
  const puedeCerrar = enCurso !== null && (!hayRindiendo || entregar !== null);

  async function cerrar() {
    if (!puedeCerrar || cerrando) return;
    setCerrando(true);
    setError(null);
    try {
      const r = await cerrarExamen(examenId, entregar === true);
      onListo(
        r.entregados > 0
          ? `Examen cerrado. Se entregó lo que tenían ${plural(r.entregados, 'alumno', 'alumnos')}; la IA ya los está corrigiendo.`
          : r.siguenRindiendo > 0
            ? `Examen cerrado. ${plural(r.siguenRindiendo, 'alumno sigue', 'alumnos siguen')} rindiendo y puede${r.siguenRindiendo === 1 ? '' : 'n'} terminar.`
            : 'Examen cerrado. Ya no puede empezar ningún alumno nuevo.',
      );
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo cerrar el examen. Probá de nuevo.'));
      setCerrando(false);
    }
  }

  return (
    <Modal titulo="¿Cerrar el examen?" onCerrar={onCancelar} cerrable={!cerrando}>
      <p className="dialog-message">
        Los links dejan de aceptar alumnos nuevos. Lo que ya se entregó no cambia, y podés volver a abrirlo cuando quieras.
      </p>

      {enCurso === null && <p className="muted">Viendo cuántos alumnos están rindiendo…</p>}
      {enCurso === 0 && <p className="muted">Ahora no hay ningún alumno rindiendo.</p>}
      {hayRindiendo && enCurso !== null && (
        <fieldset className="control-opciones" disabled={cerrando}>
          <legend>
            {enCurso > 0 ? `Hay ${plural(enCurso, 'alumno rindiendo', 'alumnos rindiendo')} ahora. ¿Qué hacemos con ${enCurso === 1 ? 'él' : 'ellos'}?` : 'Puede haber alumnos rindiendo. ¿Qué hacemos con ellos?'}
          </legend>
          <label className="opcion-tarjeta">
            <span>
              <strong>Entregar lo que tengan escrito</strong>
              <span className="ayuda-campo">Se entrega ahora el último autoguardado de cada uno y la IA lo corrige. Cierra de verdad: nadie queda con tiempo.</span>
            </span>
            <input type="radio" name="que-hacer" checked={entregar === true} onChange={() => setEntregar(true)} />
          </label>
          <label className="opcion-tarjeta">
            <span>
              <strong>Dejar que terminen</strong>
              <span className="ayuda-campo">Siguen rindiendo hasta que entreguen o se les acabe el tiempo; solo se impide que empiecen nuevos.</span>
            </span>
            <input type="radio" name="que-hacer" checked={entregar === false} onChange={() => setEntregar(false)} />
          </label>
        </fieldset>
      )}

      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancelar} disabled={cerrando}>
          Cancelar
        </button>
        <button type="button" className="btn btn-danger" onClick={cerrar} disabled={!puedeCerrar || cerrando}>
          {cerrando ? 'Cerrando…' : 'Cerrar examen'}
        </button>
      </div>
    </Modal>
  );
}

/** Volver a abrir un examen cerrado: pide tildar que se entiende (los links vuelven a aceptar alumnos), para que no sea un clic sin querer. */
export function ReabrirExamenModal({ examenId, onListo, onCancelar }: { examenId: string; onListo: (mensaje: string) => void; onCancelar: () => void }) {
  const [entiendo, setEntiendo] = useState(false);
  const [abriendo, setAbriendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reabrir() {
    if (!entiendo || abriendo) return;
    setAbriendo(true);
    setError(null);
    try {
      await reabrirExamen(examenId);
      onListo('Examen abierto de nuevo: los links vuelven a aceptar alumnos.');
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo abrir el examen. Probá de nuevo.'));
      setAbriendo(false);
    }
  }

  return (
    <Modal titulo="¿Volver a abrir el examen?" onCerrar={onCancelar} cerrable={!abriendo}>
      <p className="dialog-message">
        Los links que ya publicaste vuelven a funcionar, dentro de sus fechas, y cualquier alumno que todavía no rindió puede empezar. Los que ya entregaron no pueden
        rendir de nuevo.
      </p>
      <label className="opcion-tarjeta">
        <span>
          <strong>Entiendo que el examen vuelve a estar disponible para los alumnos</strong>
        </span>
        <input type="checkbox" checked={entiendo} onChange={(e) => setEntiendo(e.target.checked)} disabled={abriendo} />
      </label>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancelar} disabled={abriendo}>
          Cancelar
        </button>
        <button type="button" className="btn btn-primary" onClick={reabrir} disabled={!entiendo || abriendo}>
          {abriendo ? 'Abriendo…' : 'Volver a abrir'}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Editar un examen que ya existe. El título, la consigna y cuándo se libera el feedback se pueden cambiar siempre (no tocan ninguna nota).
 * Las preguntas y los ajustes, solo si nadie empezó: se abre el asistente de armado con el examen cargado.
 */
export function EditarExamenModal({
  examen,
  empezaron,
  onListo,
  onCancelar,
}: {
  examen: Examen;
  /** Cuántos alumnos empezaron o entregaron (si hay alguno, las preguntas no se pueden cambiar). */
  empezaron: number;
  onListo: (titulo: string, consigna: string, feedbackModo: FeedbackModo) => void;
  onCancelar: () => void;
}) {
  const [titulo, setTitulo] = useState(examen.titulo);
  const [consigna, setConsigna] = useState(examen.consigna);
  const [feedbackModo, setFeedbackModo] = useState<FeedbackModo>(examen.feedbackModo);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cambio = titulo.trim() !== examen.titulo || consigna.trim() !== examen.consigna || feedbackModo !== examen.feedbackModo;
  const valido = titulo.trim() !== '' && consigna.trim() !== '';

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!valido || !cambio || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      await actualizarDatosExamen(examen.id, { titulo: titulo.trim(), consigna: consigna.trim(), feedbackModo });
      onListo(titulo.trim(), consigna.trim(), feedbackModo);
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudieron guardar los cambios. Probá de nuevo.'));
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Editar examen" onCerrar={onCancelar} ancho={600} cerrable={!guardando}>
      <form onSubmit={guardar}>
        <div className="field">
          <label htmlFor="edit-titulo">Título</label>
          <input id="edit-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={200} disabled={guardando} />
        </div>
        <div className="field">
          <label htmlFor="edit-consigna">Consigna para los alumnos</label>
          <textarea id="edit-consigna" value={consigna} onChange={(e) => setConsigna(e.target.value)} rows={5} disabled={guardando} />
        </div>
        <div className="field">
          <label htmlFor="edit-feedback">Cuándo reciben su nota</label>
          <Desplegable
            id="edit-feedback"
            value={feedbackModo}
            onChange={(valor) => setFeedbackModo(valor as FeedbackModo)}
            disabled={guardando}
            opciones={[
              { valor: 'manual', etiqueta: 'Cuando yo publique las notas' },
              { valor: 'inmediato', etiqueta: 'Apenas reviso cada examen' },
            ]}
          />
        </div>

        <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
          {empezaron === 0 ? (
            <>
              Para cambiar las <strong>preguntas, los puntos o los ajustes</strong> como modalidad e integridad,{' '}
              <Link href={`/examenes/nuevo?editar=${examen.id}`}>abrí el asistente con este examen cargado</Link>.
            </>
          ) : (
            <>
              Las preguntas y los ajustes ya no se pueden cambiar porque {plural(empezaron, 'alumno empezó', 'alumnos empezaron')} o entregó el examen: las notas ya dadas
              dejarían de corresponder a lo que se preguntó. Para armar una versión nueva, usá «Duplicar y editar».
            </>
          )}
        </p>

        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancelar} disabled={guardando}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={!valido || !cambio || guardando}>
            {guardando ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Mover la apertura y el cierre de un link ya publicado (por ejemplo, extender el plazo). No afecta a quien ya empezó: su tiempo se fijó al iniciar. */
export function CambiarFechasModal({ examenId, publicacion, onListo, onCancelar }: { examenId: string; publicacion: ExamenComision; onListo: () => void; onCancelar: () => void }) {
  const [inicio, setInicio] = useState(isoAFechaLocal(publicacion.fechaInicio));
  const [fin, setFin] = useState(isoAFechaLocal(publicacion.fechaFin));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const incoherente = !!inicio && !!fin && new Date(inicio) >= new Date(fin);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (incoherente || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      await actualizarPublicacion(examenId, publicacion.id, { fechaInicio: fechaLocalAIso(inicio) ?? null, fechaFin: fechaLocalAIso(fin) ?? null });
      onListo();
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudieron cambiar las fechas. Probá de nuevo.'));
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={`Fechas de ${publicacion.comision?.nombre ?? 'la comisión'}`} onCerrar={onCancelar} cerrable={!guardando}>
      <form onSubmit={guardar}>
        <div className="fila-campos">
          <div className="field">
            <label htmlFor="fechas-inicio">Se habilita</label>
            <SelectorFecha id="fechas-inicio" value={inicio} onChange={setInicio} disabled={guardando} />
          </div>
          <div className="field">
            <label htmlFor="fechas-fin">Cierra</label>
            <SelectorFecha id="fechas-fin" value={fin} onChange={setFin} disabled={guardando} />
          </div>
        </div>
        <p className="ayuda-campo">Dejá una fecha vacía para quitarla. Quien ya empezó conserva el tiempo que tenía al empezar.</p>
        {incoherente && (
          <div className="error-box" role="alert">
            La fecha de cierre tiene que ser posterior a la de apertura.
          </div>
        )}
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancelar} disabled={guardando}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={incoherente || guardando}>
            {guardando ? 'Guardando…' : 'Guardar fechas'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
