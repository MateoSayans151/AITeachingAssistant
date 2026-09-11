'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Examen, RespuestaExamen, bulkAceptarRespuestas, getExamen, listRespuestasPorExamen } from '@/lib/api';

const ESTADO_REVISION_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  aceptada: 'Aceptada',
  editada: 'Editada',
};

function exportarCsv(examen: Examen, respuestas: RespuestaExamen[]) {
  const filas = [
    ['Alumno', 'Email', 'Nota sugerida', 'Nota final', 'Estado revisión'],
    ...respuestas.map((r) => [
      r.alumno?.nombre ?? '',
      r.alumno?.email ?? '',
      r.notaTotalSugerida ?? '',
      r.notaTotalFinal ?? '',
      ESTADO_REVISION_LABEL[r.estadoRevision] ?? r.estadoRevision,
    ]),
  ];
  const csv = filas.map((fila) => fila.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${examen.titulo.replace(/\s+/g, '_')}_respuestas.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function RespuestasExamenPage() {
  const params = useParams<{ id: string }>();
  const [examen, setExamen] = useState<Examen | null>(null);
  const [respuestas, setRespuestas] = useState<RespuestaExamen[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cargar() {
    Promise.all([getExamen(params.id), listRespuestasPorExamen(params.id)])
      .then(([e, r]) => {
        setExamen(e);
        setRespuestas(r);
      })
      .catch((e) => setError(e.message));
  }

  useEffect(cargar, [params.id]);

  async function handleBulkAceptar() {
    setLoading(true);
    setError(null);
    try {
      await bulkAceptarRespuestas(params.id);
      cargar();
    } catch (err) {
      setError('No se pudo aceptar en bloque. Intentá de nuevo.');
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

  const hayPendientes = respuestas.some((r) => r.estadoRevision === 'pendiente');

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">{examen.titulo}</div>
        <h1>Respuestas ({respuestas.length})</h1>
      </header>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={handleBulkAceptar} disabled={loading || !hayPendientes}>
          {loading ? 'Aceptando…' : 'Aceptar todas las sugerencias de la IA'}
        </button>
        <button className="btn btn-secondary" onClick={() => exportarCsv(examen, respuestas)} disabled={respuestas.length === 0}>
          Exportar CSV
        </button>
      </div>

      {respuestas.length === 0 && <div className="empty-state">Todavía no hay respuestas para este examen.</div>}

      {respuestas.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Alumno</th>
                <th>Nota sugerida</th>
                <th>Nota final</th>
                <th>Revisión</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {respuestas.map((r) => (
                <tr key={r.id}>
                  <td>{r.alumno?.nombre}</td>
                  <td>{r.notaTotalSugerida ?? '—'}</td>
                  <td>{r.notaTotalFinal ?? '—'}</td>
                  <td>
                    <span className={`badge badge-${r.estadoRevision === 'pendiente' ? 'pendiente' : r.estadoRevision === 'aceptada' ? 'revisado' : 'corregido'}`}>
                      {ESTADO_REVISION_LABEL[r.estadoRevision]}
                    </span>
                  </td>
                  <td>
                    <Link href={`/examenes/${examen.id}/respuestas/${r.id}`} className="btn btn-secondary">
                      Ver detalle
                    </Link>
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
