import Link from 'next/link';
import { getTrabajoPractico } from '@/lib/api';
import { EstadoBadge } from '@/app/components/EstadoBadge';
import { GenerarResumenButton } from '@/app/components/GenerarResumenButton';

export default async function TrabajoPracticoPage({ params }: { params: { id: string } }) {
  const tp = await getTrabajoPractico(params.id);
  const entregas = tp.entregas ?? [];
  const hayCorregidas = entregas.some((e) => e.correccion !== null);

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">{tp.materia ?? 'Trabajo práctico'}</div>
        <h1>{tp.titulo}</h1>
        <p>{tp.consigna}</p>
      </header>

      <div className="card" style={{ marginBottom: 32 }}>
        <div className="card-title" style={{ marginBottom: 12 }}>
          Rúbrica ({tp.criterios.length} criterios)
        </div>
        {tp.criterios.map((c) => (
          <div key={c.id} style={{ marginBottom: 10 }}>
            <strong>
              {c.nombre} — {c.puntajeMaximo} pts
            </strong>
            <div className="muted" style={{ fontSize: 14 }}>
              {c.descripcion}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 32, flexWrap: 'wrap' }}>
        <Link href={`/trabajos/${tp.id}/entregas/nueva`} className="btn btn-primary">
          + Cargar entrega de alumno
        </Link>
        {hayCorregidas && <GenerarResumenButton trabajoPracticoId={tp.id} />}
        {hayCorregidas && (
          <Link href={`/trabajos/${tp.id}/resumen`} className="btn btn-secondary">
            Ver último resumen
          </Link>
        )}
      </div>

      <div className="eyebrow" style={{ marginBottom: 12 }}>
        Entregas ({entregas.length})
      </div>

      {entregas.length === 0 && (
        <div className="empty-state">Todavía no cargaste ninguna entrega para este trabajo práctico.</div>
      )}

      {entregas.map((e) => (
        <div key={e.id} className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div className="card-title">{e.alumnoNombre}</div>
              {e.correccion && (
                <div className="card-meta">
                  Nota sugerida: {e.correccion.notaTotalSugerida}
                  {e.correccion.notaTotalFinal !== null && ` · Nota final: ${e.correccion.notaTotalFinal}`}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <EstadoBadge estado={e.estado} />
              {e.correccion && (
                <Link href={`/trabajos/${tp.id}/revisar?entrega=${e.id}`} className="btn btn-secondary">
                  Revisar
                </Link>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
