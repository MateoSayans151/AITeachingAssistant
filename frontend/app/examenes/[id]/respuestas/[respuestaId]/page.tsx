'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  RespuestaExamen,
  getRespuestaExamen,
  recorregirRespuestaExamen,
  revisarRespuestaExamen,
} from '@/lib/api';

export default function DetalleRespuestaExamenPage() {
  const params = useParams<{ id: string; respuestaId: string }>();
  const router = useRouter();

  const [respuesta, setRespuesta] = useState<RespuestaExamen | null>(null);
  const [notasFinales, setNotasFinales] = useState<Record<string, string>>({});
  const [feedbackFinal, setFeedbackFinal] = useState('');
  const [loading, setLoading] = useState(false);
  const [recorrigiendo, setRecorrigiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRespuestaExamen(params.id, params.respuestaId).then((r) => {
      setRespuesta(r);
      setFeedbackFinal(r.feedbackGeneralFinal ?? r.feedbackGeneralSugerido ?? '');
      setNotasFinales(
        Object.fromEntries(
          r.respuestasPorPregunta.map((rp) => [rp.preguntaId, String(rp.notaFinal ?? rp.notaSugerida)]),
        ),
      );
    });
  }, [params.id, params.respuestaId]);

  if (!respuesta) {
    return (
      <div className="page">
        <p className="muted">Cargando…</p>
      </div>
    );
  }

  const preguntasPorId = new Map((respuesta.examen?.preguntas ?? []).map((p) => [p.id, p]));

  async function handleAceptar() {
    setLoading(true);
    setError(null);
    try {
      await revisarRespuestaExamen(params.id, params.respuestaId, { estadoRevision: 'aceptada' });
      router.push(`/examenes/${params.id}/respuestas`);
    } catch (err) {
      setError('No se pudo confirmar la corrección.');
    } finally {
      setLoading(false);
    }
  }

  async function handleGuardarEdicion() {
    setLoading(true);
    setError(null);
    try {
      const overridesPorPregunta = respuesta!.respuestasPorPregunta.map((rp) => ({
        preguntaId: rp.preguntaId,
        notaFinal: Number(notasFinales[rp.preguntaId] ?? rp.notaSugerida),
      }));
      const notaTotalFinal = overridesPorPregunta.reduce((sum, o) => sum + o.notaFinal, 0);
      await revisarRespuestaExamen(params.id, params.respuestaId, {
        estadoRevision: 'editada',
        notaTotalFinal,
        feedbackGeneralFinal: feedbackFinal,
        overridesPorPregunta,
      });
      router.push(`/examenes/${params.id}/respuestas`);
    } catch (err) {
      setError('No se pudo guardar la edición.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRecorregir() {
    setRecorrigiendo(true);
    setError(null);
    try {
      const actualizada = await recorregirRespuestaExamen(params.id, params.respuestaId);
      setRespuesta((prev) => (prev ? { ...prev, ...actualizada, examen: prev.examen } : prev));
      setFeedbackFinal(actualizada.feedbackGeneralSugerido ?? '');
      setNotasFinales(
        Object.fromEntries(actualizada.respuestasPorPregunta.map((rp) => [rp.preguntaId, String(rp.notaSugerida)])),
      );
    } catch (err) {
      setError('Falló la re-corrección con IA.');
    } finally {
      setRecorrigiendo(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">{respuesta.alumno?.nombre}</div>
        <h1>Detalle de la respuesta</h1>
        {respuesta.modeloIa && <p className="muted">Corregido con {respuesta.modeloIa}</p>}
      </header>

      {error && <div className="error-box">{error}</div>}

      {respuesta.respuestasPorPregunta.map((rp, i) => {
        const pregunta = preguntasPorId.get(rp.preguntaId);
        return (
          <div key={rp.preguntaId} className="card" style={{ marginBottom: 16 }}>
            <div className="card-title" style={{ marginBottom: 8 }}>
              {i + 1}. {pregunta?.enunciado ?? rp.preguntaId}
            </div>

            <div className="muted" style={{ fontSize: 14, marginBottom: 12, whiteSpace: 'pre-wrap' }}>
              Respuesta del alumno: {JSON.stringify(rp.contenidoRespuesta)}
            </div>

            {rp.notaPorCriterio && rp.notaPorCriterio.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                {rp.notaPorCriterio.map((c) => (
                  <div key={c.criterioId} style={{ marginBottom: 8 }}>
                    <strong>
                      {c.nombre}: nivel {c.nivelSugerido}/5 — {c.notaSugerida.toFixed(2)} pts
                    </strong>
                    <div className="muted" style={{ fontSize: 14 }}>
                      {c.comentario}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {rp.correcta !== undefined && (
              <div className="muted" style={{ marginBottom: 12 }}>
                {rp.correcta ? 'Correcta' : 'Incorrecta'} (corrección automática)
              </div>
            )}

            <div className="field" style={{ maxWidth: 160, marginBottom: 0 }}>
              <label>Nota final (editable)</label>
              <input
                type="number"
                step="0.1"
                value={notasFinales[rp.preguntaId] ?? ''}
                onChange={(e) => setNotasFinales((prev) => ({ ...prev, [rp.preguntaId]: e.target.value }))}
              />
            </div>
          </div>
        );
      })}

      <div className="field">
        <label htmlFor="feedback">Feedback general para el alumno (editable)</label>
        <textarea id="feedback" value={feedbackFinal} onChange={(e) => setFeedbackFinal(e.target.value)} style={{ minHeight: 160 }} />
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={handleAceptar} disabled={loading}>
          {loading ? 'Guardando…' : 'Aceptar sugerencia de la IA tal cual'}
        </button>
        <button className="btn btn-secondary" onClick={handleGuardarEdicion} disabled={loading}>
          Guardar mi edición
        </button>
        <button className="btn btn-secondary" onClick={handleRecorregir} disabled={recorrigiendo}>
          {recorrigiendo ? 'Re-corrigiendo…' : 'Volver a correr la IA'}
        </button>
      </div>
    </div>
  );
}
