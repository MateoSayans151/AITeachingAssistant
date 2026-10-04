'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ApiError,
  Comision,
  Examen,
  Pregunta,
  TIPOS_AUTOCORREGIBLES,
  deleteExamen,
  getExamen,
  listComisionesPorCurso,
  publicarExamenAComision,
} from '@/lib/api';
import { fechaLocalAIso } from '@/lib/fechas';

/** El backend responde los errores como JSON `{ message }` (el 409 de borrar trae el motivo): se muestra eso, no el body crudo. */
function mensajeDeError(err: unknown, porDefecto: string) {
  if (err instanceof ApiError) {
    try {
      const m = JSON.parse(err.body).message;
      if (Array.isArray(m)) return m.join(' · ');
      if (typeof m === 'string' && m) return m;
    } catch {
      /* el cuerpo no era JSON: sale el mensaje por defecto */
    }
  }
  return porDefecto;
}

/** Cuánto puede sacar un alumno en la pregunta: cerradas → su puntaje; abiertas → la suma de los puntos de sus criterios. */
function puntajeEfectivo(p: Pregunta) {
  if (TIPOS_AUTOCORREGIBLES.includes(p.tipo)) return Number(p.puntajeMaximo);
  return (p.criterios ?? []).reduce((acc, c) => acc + Number(c.puntajeMaximo), 0);
}

const fmtPts = (n: number) => (Math.round((n + Number.EPSILON) * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 });

export default function ExamenDetallePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [examen, setExamen] = useState<Examen | null>(null);
  const [comisiones, setComisiones] = useState<Comision[]>([]);
  const [comisionSeleccionada, setComisionSeleccionada] = useState('');
  const [linkGenerado, setLinkGenerado] = useState<string | null>(null);
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [loading, setLoading] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Aparte de `error` (que reemplaza toda la pantalla): si borrar falla, el docente tiene que seguir viendo el examen.
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null);

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
  // Con alumnos que empezaron o entregaron el examen no se puede borrar (se perderían sus respuestas).
  const conAlumnos = (examen._count?.respuestas ?? 0) > 0 || (examen._count?.intentos ?? 0) > 0;
  const puntajeTotal = (examen.preguntas ?? []).reduce((acc, p) => acc + puntajeEfectivo(p), 0);

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

  async function handleEliminar() {
    if (
      !window.confirm(
        `¿Eliminar el examen "${examen!.titulo}"?\n\nSe borra con todas sus preguntas, y los links que ya publicaste a las comisiones dejan de funcionar. No se puede deshacer.`,
      )
    ) {
      return;
    }
    setEliminando(true);
    setErrorEliminar(null);
    try {
      await deleteExamen(examen!.id);
      router.push(`/cursos/${examen!.cursoId}`);
    } catch (err) {
      setErrorEliminar(mensajeDeError(err, 'No se pudo eliminar el examen.'));
      setEliminando(false);
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

      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link href={`/examenes/${examen.id}/respuestas`} className="btn btn-primary">
            Ver respuestas
          </Link>
          <Link href={`/examenes/${examen.id}/vara`} className="btn btn-secondary">
            Ajustar vara
          </Link>
          <Link href={`/examenes/nuevo?desde=${examen.id}`} className="btn btn-secondary">
            Duplicar y editar
          </Link>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ color: 'var(--color-error)', borderColor: 'color-mix(in srgb, var(--color-error) 55%, transparent)' }}
            onClick={handleEliminar}
            disabled={conAlumnos || eliminando}
            title={conAlumnos ? 'Ya hay alumnos que empezaron o entregaron' : undefined}
          >
            {eliminando ? 'Eliminando…' : 'Eliminar examen'}
          </button>
        </div>
        {conAlumnos && (
          <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>
            No se puede borrar: ya hay alumnos que empezaron o entregaron.
          </p>
        )}
        {errorEliminar && (
          <div className="error-box" style={{ marginTop: 12, marginBottom: 0 }}>
            {errorEliminar}
          </div>
        )}
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
            <span className="muted">— {fmtPts(puntajeEfectivo(p))} pts</span>
          </div>
        ))}
        <div style={{ marginTop: 12 }}>
          <strong>
            Total: {fmtPts(puntajeTotal)} de {fmtPts(Number(examen.escalaMax))} pts
          </strong>
        </div>
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
