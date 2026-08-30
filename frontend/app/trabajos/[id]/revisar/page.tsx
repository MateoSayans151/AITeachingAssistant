'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Entrega, TrabajoPractico, getEntrega, recorregirEntrega, revisarCorreccion } from '@/lib/api';
import { EstadoBadge } from '@/app/components/EstadoBadge';

type EntregaConTp = Entrega & { trabajoPractico: TrabajoPractico };

export default function RevisarCorreccionPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const entregaId = searchParams.get('entrega');

  const [entrega, setEntrega] = useState<EntregaConTp | null>(null);
  const [notaFinal, setNotaFinal] = useState('');
  const [feedbackFinal, setFeedbackFinal] = useState('');
  const [mostrarTrabajo, setMostrarTrabajo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recorrigiendo, setRecorrigiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entregaId) return;
    getEntrega(entregaId).then((e) => {
      setEntrega(e);
      if (e.correccion) {
        setNotaFinal(String(e.correccion.notaTotalFinal ?? e.correccion.notaTotalSugerida));
        setFeedbackFinal(e.correccion.feedbackFinal ?? e.correccion.feedbackSugerido);
      }
    });
  }, [entregaId]);

  if (!entregaId) {
    return (
      <div className="page">
        <p className="muted">Falta indicar qué entrega revisar. Volvé al listado del trabajo práctico.</p>
      </div>
    );
  }

  if (!entrega) {
    return (
      <div className="page">
        <p className="muted">Cargando…</p>
      </div>
    );
  }

  const correccion = entrega.correccion;

  async function handleAceptar() {
    setLoading(true);
    setError(null);
    try {
      await revisarCorreccion(entregaId!, { estadoRevision: 'aceptada' });
      router.push(`/trabajos/${params.id}`);
    } catch {
      setError('No se pudo confirmar la corrección. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  async function handleGuardarEdicion() {
    setLoading(true);
    setError(null);
    try {
      await revisarCorreccion(entregaId!, {
        estadoRevision: 'editada',
        notaTotalFinal: Number(notaFinal),
        feedbackFinal,
      });
      router.push(`/trabajos/${params.id}`);
    } catch {
      setError('No se pudo guardar la edición. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRecorregir() {
    if (!entregaId) return;
    setRecorrigiendo(true);
    setError(null);
    try {
      const actualizada = await recorregirEntrega(entregaId);
      setEntrega((prev) => (prev ? { ...prev, ...actualizada } : prev));
      if (actualizada.correccion) {
        setNotaFinal(String(actualizada.correccion.notaTotalSugerida));
        setFeedbackFinal(actualizada.correccion.feedbackSugerido);
      }
    } catch {
      setError('Falló la re-corrección con IA. Puede ser un problema temporal del proveedor del modelo.');
    } finally {
      setRecorrigiendo(false);
    }
  }

  if (!correccion) {
    return (
      <div className="page">
        <header className="page-header">
          <div className="eyebrow">{entrega.alumnoNombre}</div>
          <h1>Todavía no hay corrección</h1>
          <p>La corrección automática no se generó (o falló). Podés reintentarla ahora.</p>
        </header>
        {error && <div className="error-box">{error}</div>}
        <button className="btn btn-primary" onClick={handleRecorregir} disabled={recorrigiendo}>
          {recorrigiendo ? 'Corrigiendo…' : 'Corregir con IA'}
        </button>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">{entrega.trabajoPractico.titulo}</div>
        <h1>{entrega.alumnoNombre}</h1>
        <div style={{ marginTop: 8 }}>
          <EstadoBadge estado={entrega.estado} />
        </div>
      </header>

      {error && <div className="error-box">{error}</div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setMostrarTrabajo((v) => !v)}
          style={{ marginBottom: mostrarTrabajo ? 16 : 0 }}
        >
          {mostrarTrabajo ? 'Ocultar' : 'Ver'} el trabajo original del alumno
        </button>
        {mostrarTrabajo && (
          <div className="muted" style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>
            {entrega.textoTrabajo}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title" style={{ marginBottom: 12 }}>
          Nota por criterio (sugerida por IA — {correccion.modeloIa})
        </div>
        {correccion.notaPorCriterio.map((n) => (
          <div key={n.criterioId} style={{ marginBottom: 12 }}>
            <strong>
              {n.nombre}: {n.notaSugerida} pts
            </strong>
            <div className="muted" style={{ fontSize: 14 }}>
              {n.comentario}
            </div>
          </div>
        ))}
        <div className="top-rule" style={{ marginTop: 16, marginBottom: 12 }} />
        <strong>Nota total sugerida: {correccion.notaTotalSugerida}</strong>
      </div>

      <div className="field">
        <label htmlFor="notaFinal">Nota final (editable)</label>
        <input
          id="notaFinal"
          type="number"
          step="0.5"
          value={notaFinal}
          onChange={(e) => setNotaFinal(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="feedbackFinal">Feedback para el alumno (editable)</label>
        <textarea
          id="feedbackFinal"
          value={feedbackFinal}
          onChange={(e) => setFeedbackFinal(e.target.value)}
          style={{ minHeight: 180 }}
        />
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
