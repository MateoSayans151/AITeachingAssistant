'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Curso, MaterialCurso, createMaterialCurso, eliminarMaterialCurso, getCurso } from '@/lib/api';

const ESTADO_LABELS: Record<string, string> = {
  borrador: 'Borrador',
  publicado: 'Publicado',
  cerrado: 'Cerrado',
};

export default function CursoDetallePage() {
  const params = useParams<{ id: string }>();
  const [curso, setCurso] = useState<Curso | null>(null);
  const [tab, setTab] = useState<'examenes' | 'material' | 'comisiones'>('examenes');
  const [error, setError] = useState<string | null>(null);

  function recargar() {
    getCurso(params.id)
      .then(setCurso)
      .catch((e) => setError(e.message));
  }

  useEffect(recargar, [params.id]);

  if (error) {
    return (
      <div className="page">
        <div className="error-box">{error}</div>
      </div>
    );
  }

  if (!curso) {
    return (
      <div className="page">
        <p className="muted">Cargando…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">{curso.materia ?? 'Curso'}</div>
        <h1>{curso.nombre}</h1>
      </header>

      <div className="tabs">
        <button className={`tab ${tab === 'examenes' ? 'tab-active' : ''}`} onClick={() => setTab('examenes')}>
          Exámenes ({curso.examenes?.length ?? 0})
        </button>
        <button className={`tab ${tab === 'material' ? 'tab-active' : ''}`} onClick={() => setTab('material')}>
          Material ({curso.materiales?.length ?? 0})
        </button>
        <button className={`tab ${tab === 'comisiones' ? 'tab-active' : ''}`} onClick={() => setTab('comisiones')}>
          Comisiones ({curso.comisiones?.length ?? 0})
        </button>
      </div>

      {tab === 'examenes' && (
        <>
          <div style={{ marginBottom: 20 }}>
            <Link href={`/examenes/nuevo?cursoId=${curso.id}`} className="btn btn-primary">
              + Nuevo examen
            </Link>
          </div>

          {(curso.examenes?.length ?? 0) === 0 && (
            <div className="empty-state">Todavía no cargaste ningún examen para este curso.</div>
          )}

          {curso.examenes?.map((examen) => (
            <Link key={examen.id} href={`/examenes/${examen.id}`} className="card card-link">
              <div className="card-title">{examen.titulo}</div>
              <div className="card-meta">{ESTADO_LABELS[examen.estado] ?? examen.estado}</div>
            </Link>
          ))}
        </>
      )}

      {tab === 'material' && <MaterialTab curso={curso} onChange={recargar} />}

      {tab === 'comisiones' && (
        <>
          <div style={{ marginBottom: 20 }}>
            <Link href={`/cursos/${curso.id}/comisiones/nueva`} className="btn btn-primary">
              + Nueva comisión
            </Link>
          </div>

          {(curso.comisiones?.length ?? 0) === 0 && (
            <div className="empty-state">Todavía no cargaste ninguna comisión para este curso.</div>
          )}

          {curso.comisiones?.map((comision) => (
            <div key={comision.id} className="card">
              <div className="card-title">{comision.nombre}</div>
              <div className="card-meta">{comision._count?.alumnos ?? 0} alumnos</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/**
 * Material de cátedra: apuntes/bibliografía en texto plano que la IA usa como referencia
 * extra al corregir preguntas abiertas de los exámenes de este curso (ver AiService,
 * bloque <material_curso>). Texto plano a propósito, mismo criterio que el resto del MVP.
 */
function MaterialTab({ curso, onChange }: { curso: Curso; onChange: () => void }) {
  const [mostrarForm, setMostrarForm] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [unidad, setUnidad] = useState('');
  const [contenido, setContenido] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await createMaterialCurso(curso.id, { titulo, unidad: unidad || undefined, contenido });
      setTitulo('');
      setUnidad('');
      setContenido('');
      setMostrarForm(false);
      onChange();
    } catch {
      setError('No se pudo guardar el material. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  async function handleQuitar(m: MaterialCurso) {
    if (!window.confirm(`¿Quitar "${m.titulo}"? La IA deja de usarlo como referencia.`)) return;
    await eliminarMaterialCurso(m.id);
    onChange();
  }

  return (
    <>
      <p className="muted" style={{ maxWidth: '62ch', marginBottom: 20 }}>
        La IA usa este material como fuente de referencia al corregir preguntas abiertas de los exámenes de
        este curso: lo cita para fundamentar el criterio, pero la rúbrica sigue mandando sobre la nota.
      </p>

      <div style={{ marginBottom: 20 }}>
        <button className="btn btn-primary" onClick={() => setMostrarForm((v) => !v)}>
          {mostrarForm ? 'Cancelar' : '+ Subir material'}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      {mostrarForm && (
        <form onSubmit={handleSubmit} className="card" style={{ marginBottom: 20 }}>
          <div className="field">
            <label htmlFor="mTitulo">Título</label>
            <input id="mTitulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="mUnidad">Unidad (opcional)</label>
            <input
              id="mUnidad"
              value={unidad}
              onChange={(e) => setUnidad(e.target.value)}
              placeholder="Ej: U3 Espacios vectoriales"
            />
          </div>
          <div className="field">
            <label htmlFor="mContenido">Contenido</label>
            <textarea
              id="mContenido"
              value={contenido}
              onChange={(e) => setContenido(e.target.value)}
              placeholder="Pegá acá el texto del apunte o la bibliografía (sin imágenes ni PDF escaneado en esta versión)."
              style={{ minHeight: 220 }}
              required
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Guardando…' : 'Guardar material'}
          </button>
        </form>
      )}

      {(curso.materiales?.length ?? 0) === 0 && !mostrarForm && (
        <div className="empty-state">Todavía no cargaste material para este curso.</div>
      )}

      {(curso.materiales?.length ?? 0) > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Título</th>
                <th>Unidad</th>
                <th>Cargado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {curso.materiales?.map((m) => (
                <tr key={m.id}>
                  <td>{m.titulo}</td>
                  <td>{m.unidad ?? <span className="muted">—</span>}</td>
                  <td className="muted">{new Date(m.createdAt).toLocaleDateString('es-AR')}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-ghost" onClick={() => handleQuitar(m)}>
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
