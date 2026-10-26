'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useConfirmar } from '@/app/components/Confirmar';
import { Comision, Curso, MaterialCurso, ApiError, createMaterialCurso, eliminarMaterialCurso, getComision, getCurso, subirArchivoMaterialCurso } from '@/lib/api';

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
            <ComisionCard key={comision.id} comision={comision} />
          ))}
        </>
      )}
    </div>
  );
}

/** Comisión con su listado de alumnos (entran a rendir con su email). */
function ComisionCard({ comision }: { comision: Comision }) {
  const [detalle, setDetalle] = useState<Comision | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (!abierto && !detalle) {
      try {
        setDetalle(await getComision(comision.id));
      } catch {
        setError('No se pudo cargar el listado.');
        return;
      }
    }
    setAbierto(!abierto);
  }

  return (
    <div className="card">
      <div className="card-title">{comision.nombre}</div>
      <div className="card-meta">{comision._count?.alumnos ?? 0} alumnos</div>
      <button type="button" className="btn btn-secondary" style={{ marginTop: 12 }} onClick={toggle}>
        {abierto ? 'Ocultar alumnos' : 'Ver alumnos'}
      </button>
      {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}
      {abierto && detalle && (
        <table className="table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Alumno</th>
              <th>Email</th>
            </tr>
          </thead>
          <tbody>
            {detalle.alumnos?.map((a) => (
              <tr key={a.id}>
                <td>{a.nombre}</td>
                <td>{a.email}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * Material de cátedra: apuntes/bibliografía (archivo pdf/docx/pptx/md/txt o texto pegado) que la IA usa como referencia
 * extra al corregir preguntas abiertas de los exámenes de este curso (ver AiService,
 * bloque <material_curso>). El servidor extrae el texto del archivo; no hay OCR de PDF escaneado.
 */
/** El backend responde 400 con un mensaje apto para el docente (formato, tamaño, PDF sin texto...). */
function mensajeDeError(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 400) return null;
  try {
    const m = JSON.parse(err.body).message;
    return Array.isArray(m) ? m.join(' ') : typeof m === 'string' ? m : null;
  } catch {
    return null;
  }
}

function MaterialTab({ curso, onChange }: { curso: Curso; onChange: () => void }) {
  const confirmar = useConfirmar();
  const [mostrarForm, setMostrarForm] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [unidad, setUnidad] = useState('');
  const [contenido, setContenido] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (archivo) {
        await subirArchivoMaterialCurso(curso.id, archivo, { titulo: titulo || undefined, unidad: unidad || undefined });
      } else {
        await createMaterialCurso(curso.id, { titulo, unidad: unidad || undefined, contenido });
      }
      setTitulo('');
      setUnidad('');
      setContenido('');
      setArchivo(null);
      setMostrarForm(false);
      onChange();
    } catch (err) {
      setError(mensajeDeError(err) ?? 'No se pudo guardar el material. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  async function handleQuitar(m: MaterialCurso) {
    const confirmado = await confirmar({
      titulo: `¿Quitar "${m.titulo}"?`,
      mensaje: 'La IA deja de usarlo como referencia al corregir.',
      textoConfirmar: 'Quitar',
      peligrosa: true,
    });
    if (!confirmado) return;
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
            <input
              id="mTitulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder={archivo ? 'Si lo dejás vacío se usa el nombre del archivo' : undefined}
              required={!archivo}
            />
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
            <label htmlFor="mArchivo">Archivo (PDF, Word, PowerPoint, Markdown o texto)</label>
            <input
              id="mArchivo"
              type="file"
              accept=".pdf,.docx,.pptx,.md,.txt"
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
            />
            <p className="muted" style={{ marginTop: 6 }}>
              Hasta 4 MB. Se lee el texto del archivo; los PDF escaneados (imágenes) todavía no se pueden leer.
            </p>
          </div>
          {!archivo && (
            <div className="field">
              <label htmlFor="mContenido">…o pegá el texto</label>
              <textarea
                id="mContenido"
                value={contenido}
                onChange={(e) => setContenido(e.target.value)}
                placeholder="Pegá acá el texto del apunte o la bibliografía."
                style={{ minHeight: 220 }}
                required
              />
            </div>
          )}
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? (archivo ? 'Leyendo e indexando…' : 'Guardando…') : 'Guardar material'}
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
