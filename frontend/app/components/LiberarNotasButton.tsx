'use client';

import { useState } from 'react';
import { ExamenConPendientes, FeedbackModo, liberarFeedback, listRespuestasPorExamen } from '@/lib/api';

const formatearFecha = (iso: string) => new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

// Publicar las notas de un examen (feedback "manual"): cada alumno con el examen ya revisado recibe por mail su nota y su
// feedback; el resto, apenas el docente revise el suyo. Es autocontenido: la página solo pasa el estado actual y se
// entera del cambio por onChange. Publicar no se puede retirar, por eso pide confirmación.
export function LiberarNotasButton({
  examenId,
  feedbackModo,
  liberadoEn,
  onChange,
}: {
  examenId: string;
  feedbackModo: FeedbackModo;
  liberadoEn: string | null;
  onChange: (examen: ExamenConPendientes) => void;
}) {
  const [publicadoEn, setPublicadoEn] = useState<string | null>(null);
  const [sinRevisar, setSinRevisar] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (feedbackModo === 'inmediato') {
    return (
      <p className="muted">
        Este examen es de feedback inmediato: cada alumno recibe su nota y su feedback por mail apenas revisás su examen. No hace falta
        publicar las notas.
      </p>
    );
  }

  const fecha = publicadoEn ?? liberadoEn;
  if (fecha) {
    return (
      <div role="status">
        <strong>Notas publicadas el {formatearFecha(fecha)}</strong>
        <p className="muted" style={{ marginTop: 6 }}>
          Cada alumno recibe su nota por mail apenas revisás su examen
          {sinRevisar ? `: todavía te quedan ${sinRevisar} respuesta(s) sin revisar` : ''}.
        </p>
      </div>
    );
  }

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      // Antes de confirmar se cuenta a quiénes les llega el mail ya y cuántos exámenes siguen sin revisar.
      let aviso = '';
      try {
        const respuestas = await listRespuestasPorExamen(examenId);
        const pendientes = respuestas.filter((r) => r.estadoRevision === 'pendiente').length;
        const revisadas = respuestas.length - pendientes;
        aviso =
          (revisadas > 0
            ? `Se van a enviar por mail las notas de ${revisadas} alumno(s) con el examen revisado. `
            : 'Todavía no revisaste ninguna respuesta: por ahora no se envía ningún mail. ') +
          (pendientes > 0
            ? `Hay ${pendientes} respuesta(s) sin revisar: esos alumnos reciben su mail apenas las revises. `
            : '');
      } catch {
        /* si no se pudo contar, se confirma igual sin ese detalle */
      }
      if (!window.confirm(`${aviso}Las notas publicadas no se pueden retirar. ¿Publicarlas y enviarlas por mail?`)) return;

      const examen = await liberarFeedback(examenId);
      setPublicadoEn(examen.feedbackLiberadoEn);
      setSinRevisar(examen.pendientesDeRevision);
      onChange(examen);
    } catch {
      setError('No se pudieron publicar las notas. Probá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button className="btn btn-primary" onClick={handleClick} disabled={loading}>
        {loading ? 'Publicando…' : 'Publicar notas y enviarlas por mail'}
      </button>
      {error && (
        <div className="error-box" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}
