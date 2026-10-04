'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Entrega, TrabajoPractico, getTrabajoPractico } from '@/lib/api';
import { useSesion } from '@/lib/auth';
import { EstadoBadge } from '@/app/components/EstadoBadge';
import { GenerarResumenButton } from '@/app/components/GenerarResumenButton';

const formatearFecha = (iso: string) => new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

/** Cómo se entrega, en una línea (la modalidad se deduce: con duración es ventana de tiempo, si no, horario fijo). */
function describirModalidad(tp: TrabajoPractico): string {
  if (tp.duracionMinutos) return `Ventana de tiempo: ${tp.duracionMinutos} min por alumno`;
  if (tp.fechaInicio && tp.fechaFin) return `Horario fijo: del ${formatearFecha(tp.fechaInicio)} al ${formatearFecha(tp.fechaFin)}`;
  return 'Sin límite de tiempo';
}

/** Señales del modo seguro de una entrega que vino por el link, o null si no corresponde mostrarlas. */
function describirSenales(e: Entrega, modoSeguro: boolean): string | null {
  if (!modoSeguro || !e.intento) return null;
  const { salidasPantalla, cambiosPestana, pegados } = e.intento;
  const partes = [
    pegados > 0 && `${pegados} ${pegados === 1 ? 'pegado de texto' : 'pegados de texto'}`,
    cambiosPestana > 0 && `${cambiosPestana} ${cambiosPestana === 1 ? 'cambio de pestaña' : 'cambios de pestaña'}`,
    salidasPantalla > 0 && `${salidasPantalla} ${salidasPantalla === 1 ? 'salida' : 'salidas'} de pantalla completa`,
  ].filter(Boolean);
  return partes.length > 0 ? `Señales de integridad: ${partes.join(' · ')}` : 'Sin señales de integridad';
}

function LinkAlumnos({ tp }: { tp: TrabajoPractico }) {
  const [copiado, setCopiado] = useState(false);
  const vencido = !!tp.fechaFin && new Date(tp.fechaFin) < new Date();

  async function copiar() {
    if (!tp.urlAcceso) return;
    try {
      await navigator.clipboard.writeText(tp.urlAcceso);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* sin permiso del portapapeles: el link está a la vista para copiarlo a mano */
    }
  }

  if (!tp.urlAcceso) {
    return (
      <p className="muted" style={{ marginBottom: 32 }}>
        Este trabajo práctico se creó antes de que existiera el link para alumnos: las entregas se cargan a mano.
      </p>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 32 }}>
      <div className="card-title" style={{ marginBottom: 8 }}>
        Link para los alumnos
      </div>
      <p style={{ wordBreak: 'break-all', marginBottom: 10 }}>{tp.urlAcceso}</p>
      <button type="button" className="btn btn-secondary" onClick={copiar} style={{ marginBottom: 14 }}>
        {copiado ? '¡Copiado!' : 'Copiar link'}
      </button>
      <div className="card-meta">
        {describirModalidad(tp)} · Modo seguro: {tp.modoSeguro ? 'sí' : 'no'}
        {vencido && ' · El link ya venció'}
      </div>
    </div>
  );
}

// Componente de cliente: el pedido a la API necesita la sesión del navegador (en el servidor de Next no existe).
export default function TrabajoPracticoPage() {
  const params = useParams<{ id: string }>();
  const { docente, cargando } = useSesion();
  const [tp, setTp] = useState<TrabajoPractico | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!docente) return;
    getTrabajoPractico(params.id)
      .then(setTp)
      .catch((e) => setError(e.message));
  }, [docente, params.id]);

  if (cargando) return <div className="page"><p className="muted">Cargando…</p></div>;
  if (!docente) return <div className="page"><p className="muted">Identificate primero desde el inicio.</p></div>;
  if (error) return <div className="page"><div className="error-box">{error}</div></div>;
  if (!tp) return <div className="page"><p className="muted">Cargando…</p></div>;

  const entregas = tp.entregas ?? [];
  const hayCorregidas = entregas.some((e) => e.correccion !== null);

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">{tp.materia ?? 'Trabajo práctico'}</div>
        <h1>{tp.titulo}</h1>
        <p>{tp.consigna}</p>
      </header>

      <LinkAlumnos tp={tp} />

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

      {entregas.map((e) => {
        const senales = describirSenales(e, tp.modoSeguro);
        return (
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
                {e.intento?.estado === 'vencido' && <div className="card-meta">Se entregó sola al vencer el tiempo.</div>}
                {senales && <div className="card-meta">{senales}</div>}
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
        );
      })}
    </div>
  );
}
