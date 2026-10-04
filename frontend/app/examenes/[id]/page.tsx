'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Comision, Examen, getExamen, listComisionesPorCurso, publicarExamenAComision } from '@/lib/api';
import { fechaLocalAIso } from '@/lib/fechas';

export default function ExamenDetallePage() {
  const params = useParams<{ id: string }>();
  const [examen, setExamen] = useState<Examen | null>(null);
  const [comisiones, setComisiones] = useState<Comision[]>([]);
  const [comisionSeleccionada, setComisionSeleccionada] = useState('');
  const [linkGenerado, setLinkGenerado] = useState<string | null>(null);
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cargar() {
    getExamen(params.id)
      .then((e) => {
        setExamen(e);
        listComisionesPorCurso(e.cursoId).then(setComisiones).catch(() => setComisiones([]));
      })
      .catch((e) => setError(e.message));
  }

  useEffect(cargar, [params.id]);

  if (error) {
    return (
      <div className="page">
        <div className="error-box">{error}</div>
      </div>
    );
  }

  if (!examen) {
    return (
      <div className="page">
        <p className="muted">Cargando…</p>
      </div>
    );
  }

  const comisionesYaPublicadas = new Set((examen.comisiones ?? []).map((ec) => ec.comisionId));
  const comisionesDisponibles = comisiones.filter((c) => !comisionesYaPublicadas.has(c.id));

  async function handlePublicar() {
    if (!comisionSeleccionada) return;
    setLoading(true);
    setError(null);
    try {
      const resultado = await publicarExamenAComision(examen!.id, {
        comisionId: comisionSeleccionada,
        fechaInicio: fechaLocalAIso(fechaInicio),
        fechaFin: fechaLocalAIso(fechaFin),
      });
      setLinkGenerado(resultado.urlAcceso ?? null);
      setComisionSeleccionada('');
      setFechaInicio('');
      setFechaFin('');
      cargar();
    } catch (err) {
      setError('No se pudo publicar el examen a esa comisión.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">Examen</div>
        <h1>{examen.titulo}</h1>
        <p>{examen.consigna}</p>
        {examen.antiCheat && (
          <p className="muted">
            Señales de integridad activas:{' '}
            {[examen.antiCheat.pantallaCompleta && 'pantalla completa', examen.antiCheat.cambioPestana && 'cambio de pestaña', examen.antiCheat.pegado && 'pegado']
              .filter(Boolean)
              .join(', ')}
            .
          </p>
        )}
      </header>

      {error && <div className="error-box">{error}</div>}

      <div style={{ display: 'flex', gap: 12, marginBottom: 32, flexWrap: 'wrap' }}>
        <Link href={`/examenes/${examen.id}/respuestas`} className="btn btn-primary">
          Ver respuestas
        </Link>
        <Link href={`/examenes/${examen.id}/vara`} className="btn btn-secondary">
          Ajustar vara
        </Link>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-title" style={{ marginBottom: 12 }}>
          Preguntas ({examen.preguntas?.length ?? 0})
        </div>
        {examen.preguntas?.map((p, i) => (
          <div key={p.id} style={{ marginBottom: 8 }}>
            <strong>
              {i + 1}. {p.enunciado}
            </strong>{' '}
            <span className="muted">— {p.puntajeMaximo} pts</span>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-title" style={{ marginBottom: 12 }}>
          Comisiones publicadas
        </div>

        {(examen.comisiones ?? []).length === 0 && <div className="muted">Todavía no publicaste este examen a ninguna comisión.</div>}

        {examen.comisiones?.map((ec) => (
          <div key={ec.id} style={{ marginBottom: 12 }}>
            <strong>{ec.comision?.nombre}</strong>
            <div className="muted" style={{ fontSize: 13, wordBreak: 'break-all' }}>
              {typeof window !== 'undefined' ? `${window.location.origin}/rendir/${ec.slugAcceso}` : ec.slugAcceso}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {ec.fechaInicio ? `Se habilita ${new Date(ec.fechaInicio).toLocaleString('es-AR')}` : 'Habilitado desde ya'}
              {' · '}
              {ec.fechaFin ? `cierra ${new Date(ec.fechaFin).toLocaleString('es-AR')}` : 'sin fecha de cierre'}
            </div>
          </div>
        ))}

        {linkGenerado && (
          <div className="error-box" style={{ background: 'var(--color-success-soft)', border: 'none', color: 'var(--color-success)' }}>
            Link generado: {linkGenerado}
          </div>
        )}

        {comisionesDisponibles.length > 0 && (
          <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <select value={comisionSeleccionada} onChange={(e) => setComisionSeleccionada(e.target.value)}>
              <option value="">Elegí una comisión…</option>
              {comisionesDisponibles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
            <input type="datetime-local" aria-label="Se habilita (opcional)" title="Se habilita (opcional)" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
            <input type="datetime-local" aria-label="Cierra (opcional)" title="Cierra (opcional)" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
            <button className="btn btn-primary" onClick={handlePublicar} disabled={loading || !comisionSeleccionada}>
              {loading ? 'Publicando…' : 'Publicar / generar link'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
