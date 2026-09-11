'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Examen, RespuestaExamen, aplicarVara, getExamen, listRespuestasPorExamen } from '@/lib/api';

function clamp(valor: number, min: number, max: number) {
  return Math.min(Math.max(valor, min), max);
}

export default function AjustarVaraPage() {
  const params = useParams<{ id: string }>();
  const [examen, setExamen] = useState<Examen | null>(null);
  const [respuestas, setRespuestas] = useState<RespuestaExamen[] | null>(null);
  const [varaPorcentaje, setVaraPorcentaje] = useState('0');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cargar() {
    Promise.all([getExamen(params.id), listRespuestasPorExamen(params.id)])
      .then(([e, r]) => {
        setExamen(e);
        setRespuestas(r);
        setVaraPorcentaje(e.varaPorcentaje);
      })
      .catch((e) => setError(e.message));
  }

  useEffect(cargar, [params.id]);

  const preview = useMemo(() => {
    if (!examen || !respuestas) return [];
    const min = Number(examen.escalaMin);
    const max = Number(examen.escalaMax);
    const pct = Number(varaPorcentaje) || 0;
    return respuestas
      .filter((r) => r.estadoRevision === 'pendiente' && r.notaTotalSugerida !== null)
      .map((r) => {
        const original = Number(r.notaTotalSugerida);
        const conVara = clamp(original * (1 + pct / 100), min, max);
        return { respuesta: r, original, conVara };
      });
  }, [examen, respuestas, varaPorcentaje]);

  async function handleAplicar() {
    setLoading(true);
    setError(null);
    try {
      await aplicarVara(params.id, { varaPorcentaje: Number(varaPorcentaje) });
      cargar();
    } catch (err) {
      setError('No se pudo aplicar la vara.');
    } finally {
      setLoading(false);
    }
  }

  if (error) {
    return (
      <div className="page">
        <div className="error-box">{error}</div>
      </div>
    );
  }

  if (!examen || !respuestas) {
    return (
      <div className="page">
        <p className="muted">Cargando…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">{examen.titulo}</div>
        <h1>Ajustar vara</h1>
        <p>
          Desplaza la nota sugerida de todas las respuestas todavía no revisadas individualmente. Las que el
          docente ya revisó a mano no se tocan.
        </p>
      </header>

      {error && <div className="error-box">{error}</div>}

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="field" style={{ maxWidth: 240, marginBottom: 16 }}>
          <label htmlFor="vara">Ajuste (%)</label>
          <input
            id="vara"
            type="number"
            step="1"
            value={varaPorcentaje}
            onChange={(e) => setVaraPorcentaje(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" onClick={handleAplicar} disabled={loading}>
          {loading ? 'Aplicando…' : 'Aplicar vara'}
        </button>
      </div>

      {preview.length === 0 && (
        <div className="empty-state">No hay respuestas pendientes de revisión para ajustar.</div>
      )}

      {preview.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Alumno</th>
                <th>Nota sugerida original</th>
                <th>Nota con vara</th>
              </tr>
            </thead>
            <tbody>
              {preview.map(({ respuesta, original, conVara }) => (
                <tr key={respuesta.id}>
                  <td>{respuesta.alumno?.nombre}</td>
                  <td>{original.toFixed(2)}</td>
                  <td>
                    <strong>{conVara.toFixed(2)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
