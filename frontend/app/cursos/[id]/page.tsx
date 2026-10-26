'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useConfirmar } from '@/app/components/Confirmar';
import { plural } from '@/lib/texto';
import { caracteresLegibles, problemaDelArchivo, tamanoLegible } from '@/lib/material';
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
              <div className="card-meta">
                {ESTADO_LABELS[examen.estado] ?? examen.estado}
                {examen.resumenRespuestas && examen.resumenRespuestas.entregadas > 0 ? (
                  <>
                    {' · '}
                    {plural(examen.resumenRespuestas.entregadas, 'entrega', 'entregas')}
                    {examen.resumenRespuestas.porRevisar > 0 && (
                      <>
                        {' · '}
                        <strong>{plural(examen.resumenRespuestas.porRevisar, 'para revisar', 'para revisar')}</strong>
                      </>
                    )}
                  </>
                ) : examen.estado === 'publicado' ? (
                  ' · todavía sin entregas'
                ) : null}
              </div>
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
  if (err instanceof ApiError && err.status === 413) return 'El archivo es demasiado grande: el máximo es 4 MB. Probá exportarlo más liviano o dividirlo en partes.';
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
  const [arrastrando, setArrastrando] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Confirmación de lo último que se cargó: sin esto, tras guardar el formulario simplemente desaparecía.
  const [exito, setExito] = useState<string | null>(null);

  /** Elige (o descarta) el archivo; si no se puede leer lo dice enseguida, sin esperar a que termine una subida de varios MB. */
  function elegirArchivo(f: File | null | undefined) {
    setExito(null);
    if (!f) return setArchivo(null);
    const problema = problemaDelArchivo(f);
    if (problema) {
      setArchivo(null);
      return setError(problema);
    }
    setError(null);
    setArchivo(f);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setExito(null);
    try {
      const creado = archivo
        ? await subirArchivoMaterialCurso(curso.id, archivo, { titulo: titulo || undefined, unidad: unidad || undefined })
        : await createMaterialCurso(curso.id, { titulo, unidad: unidad || undefined, contenido });
      setExito(`Listo: «${creado.titulo}» se cargó (${caracteresLegibles(creado.contenido)} de texto) y la IA ya puede usarlo al corregir.`);
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
        <button
          className="btn btn-primary"
          onClick={() => {
            setMostrarForm((v) => !v);
            setError(null);
            setExito(null);
          }}
        >
          {mostrarForm ? 'Cancelar' : '+ Subir material'}
        </button>
      </div>

      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {exito && (
        <div className="error-box" role="status" style={{ background: 'var(--color-success-soft)', border: 'none', color: 'var(--color-success)' }}>
          {exito}
        </div>
      )}

      {mostrarForm && (
        <form onSubmit={handleSubmit} className="card" style={{ marginBottom: 20 }} aria-busy={loading}>
          <div className="field">
            <span className="etiqueta-campo" id="mArchivoEtiqueta">
              Archivo (PDF, Word, PowerPoint, Markdown o texto)
            </span>
            <div
              className={`zona-archivo${arrastrando ? ' arrastrando' : ''}${archivo ? ' con-archivo' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setArrastrando(true);
              }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={(e) => {
                e.preventDefault();
                setArrastrando(false);
                if (!loading) elegirArchivo(e.dataTransfer.files?.[0]);
              }}
            >
              {archivo ? (
                <>
                  <span>
                    <strong>{archivo.name}</strong> · {tamanoLegible(archivo.size)}
                  </span>
                  <button type="button" className="btn btn-ghost" onClick={() => elegirArchivo(null)} disabled={loading}>
                    Quitar archivo
                  </button>
                </>
              ) : (
                <>
                  <span>Arrastrá un archivo hasta acá o</span>
                  <label htmlFor="mArchivo" className="btn btn-secondary">
                    Elegí un archivo
                  </label>
                </>
              )}
              <input
                id="mArchivo"
                className="archivo-oculto"
                type="file"
                accept=".pdf,.docx,.pptx,.md,.txt"
                aria-labelledby="mArchivoEtiqueta"
                aria-describedby="mArchivoAyuda"
                disabled={loading}
                onChange={(e) => {
                  elegirArchivo(e.target.files?.[0]);
                  e.target.value = ''; // permite volver a elegir el mismo archivo después de quitarlo
                }}
              />
            </div>
            <p className="muted" id="mArchivoAyuda" style={{ marginTop: 6, fontSize: 13 }}>
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
                style={{ minHeight: 160 }}
                required
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="mTitulo">Título{archivo ? ' (opcional)' : ''}</label>
            <input
              id="mTitulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder={archivo ? 'Si lo dejás vacío se usa el nombre del archivo' : 'Ej: Apunte de la unidad 3'}
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
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? (archivo ? 'Leyendo el archivo…' : 'Guardando…') : 'Guardar material'}
          </button>
          {loading && archivo && (
            <p className="muted" style={{ marginTop: 8, fontSize: 13 }} role="status">
              Se está leyendo e indexando el texto para que la IA pueda consultarlo. Puede tardar unos segundos: no cierres la página.
            </p>
          )}
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
                <th title="Cuánto texto se leyó del material: si es muy poco, el archivo no se leyó bien">Texto leído</th>
                <th>Cargado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {curso.materiales?.map((m) => (
                <tr key={m.id}>
                  <td>{m.titulo}</td>
                  <td>{m.unidad ?? <span className="muted">—</span>}</td>
                  <td className="muted">{caracteresLegibles(m.contenido)}</td>
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
