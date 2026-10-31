'use client';

import { Cargando } from '@/app/components/Cargando';
import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useConfirmar } from '@/app/components/Confirmar';
import { plural } from '@/lib/texto';
import { caracteresLegibles, problemaDelArchivo, tamanoLegible } from '@/lib/material';
import { useDocente } from '@/lib/auth';
import {
  Comision,
  Curso,
  EquipoDelCurso,
  MaterialCurso,
  ApiError,
  agregarDocenteCurso,
  createMaterialCurso,
  eliminarMaterialCurso,
  getComision,
  getCurso,
  getEquipoCurso,
  quitarDocenteCurso,
  quitarInvitacionCurso,
  subirArchivoMaterialCurso,
} from '@/lib/api';

const ESTADO_LABELS: Record<string, string> = {
  borrador: 'Borrador',
  publicado: 'Publicado',
  cerrado: 'Cerrado',
};

export default function CursoDetallePage() {
  const params = useParams<{ id: string }>();
  const [curso, setCurso] = useState<Curso | null>(null);
  const [tab, setTab] = useState<'examenes' | 'material' | 'comisiones' | 'docentes'>('examenes');
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
        <Cargando variante="pagina" />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <Link href="/" className="volver">
          ← Tus cursos
        </Link>
        <div className="eyebrow">{curso.materia ?? 'Curso'}</div>
        <h1>{curso.nombre}</h1>
      </header>

      <div className="tabs">
        <button className={`tab ${tab === 'material' ? 'tab-active' : ''}`} onClick={() => setTab('material')}>
          Material ({curso.materiales?.length ?? 0})
        </button>
        <button className={`tab ${tab === 'examenes' ? 'tab-active' : ''}`} onClick={() => setTab('examenes')}>
          Exámenes ({curso.examenes?.length ?? 0})
        </button>
        <button className={`tab ${tab === 'comisiones' ? 'tab-active' : ''}`} onClick={() => setTab('comisiones')}>
          Comisiones ({curso.comisiones?.length ?? 0})
        </button>
        <button className={`tab ${tab === 'docentes' ? 'tab-active' : ''}`} onClick={() => setTab('docentes')}>
          Docentes
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
            <div key={examen.id} className="card examen-fila">
              <Link href={`/examenes/${examen.id}`} className="examen-fila-info">
              <div className="card-title">{examen.titulo}</div>
              <div className="card-meta">
                {ESTADO_LABELS[examen.estado] ?? examen.estado}
                {examen.creadoPor && ` · armado por ${examen.creadoPor.nombre}`}
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
              {examen.resumenRespuestas && examen.resumenRespuestas.entregadas > 0 && (
                <Link href={`/examenes/${examen.id}/respuestas`} className={`btn ${examen.resumenRespuestas.porRevisar > 0 ? 'btn-primary' : 'btn-secondary'}`}>
                  {examen.resumenRespuestas.porRevisar > 0 ? `Revisar (${examen.resumenRespuestas.porRevisar})` : 'Ver respuestas'}
                </Link>
              )}
            </div>
          ))}
        </>
      )}

      {tab === 'material' && <MaterialTab curso={curso} onChange={recargar} />}

      {tab === 'docentes' && <EquipoTab cursoId={curso.id} />}

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

/** Mensaje en castellano para un fallo al tocar el equipo (nunca el JSON crudo del servidor). */
function mensajeErrorEquipo(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 400) return 'Revisá el email: no parece válido.';
    if (err.status === 409) return 'El curso tiene que quedar con al menos un docente.';
    if (err.status === 404) return 'Ese docente o ese curso ya no está disponible. Actualizá la página.';
    if (err.status === 429) return 'Hiciste demasiados cambios seguidos. Esperá un minuto y probá de nuevo.';
    if (err.status === 401) return 'Tu sesión venció. Volvé a iniciar sesión y probá de nuevo.';
    return 'No pudimos hacer el cambio por un problema del servidor. Probá de nuevo en un momento.';
  }
  return 'No pudimos conectarnos con el servidor. Revisá tu conexión y probá de nuevo.';
}

/**
 * Los docentes del curso. Todos tienen los mismos permisos (ver el curso, armar y corregir exámenes, cargar material, manejar
 * comisiones y sumar o sacar docentes), así que no hay roles que explicar: se ve quién está, se suma por email y se saca.
 * Si el email no tiene cuenta todavía queda como invitación y el curso aparece apenas se registre con ese email.
 */
function EquipoTab({ cursoId }: { cursoId: string }) {
  const router = useRouter();
  const yo = useDocente();
  const confirmar = useConfirmar();
  const [equipo, setEquipo] = useState<EquipoDelCurso | null>(null);
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function recargar() {
    getEquipoCurso(cursoId)
      .then(setEquipo)
      .catch((e) => setError(mensajeErrorEquipo(e)));
  }

  useEffect(recargar, [cursoId]);

  async function agregar(e: FormEvent) {
    e.preventDefault();
    const limpio = email.trim();
    if (!limpio || enviando) return;
    setEnviando(true);
    setError(null);
    setAviso(null);
    try {
      const r = await agregarDocenteCurso(cursoId, limpio);
      setAviso(
        r.estado === 'agregado'
          ? `${r.docente.nombre} ya forma parte del curso y puede verlo y trabajar en él.`
          : `${r.email} todavía no tiene cuenta: va a ver el curso apenas se registre con ese email.`,
      );
      setEmail('');
      recargar();
    } catch (err) {
      setError(mensajeErrorEquipo(err));
    } finally {
      setEnviando(false);
    }
  }

  async function quitar(docenteId: string, nombre: string, esUno: boolean) {
    const ok = await confirmar(
      esUno
        ? { titulo: '¿Salir del curso?', mensaje: 'Vas a dejar de ver este curso y sus exámenes. Cualquiera de los docentes que quedan puede volver a sumarte.', textoConfirmar: 'Salir del curso', peligrosa: true }
        : { titulo: `¿Sacar a ${nombre}?`, mensaje: `${nombre} va a dejar de ver este curso. Los exámenes que armó se quedan en el curso.`, textoConfirmar: 'Sacar', peligrosa: true },
    );
    if (!ok) return;
    setError(null);
    setAviso(null);
    try {
      await quitarDocenteCurso(cursoId, docenteId);
      if (esUno) {
        router.push('/cursos');
        return;
      }
      recargar();
    } catch (err) {
      setError(mensajeErrorEquipo(err));
    }
  }

  async function cancelarInvitacion(id: string) {
    setError(null);
    try {
      await quitarInvitacionCurso(cursoId, id);
      recargar();
    } catch (err) {
      setError(mensajeErrorEquipo(err));
    }
  }

  return (
    <div>
      <p className="muted" style={{ marginBottom: 16, maxWidth: '62ch' }}>
        Los docentes del curso pueden ver y hacer lo mismo: armar y corregir exámenes, cargar material, manejar comisiones y sumar o sacar a otros
        docentes.
      </p>

      <form onSubmit={agregar} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
        <label className="field" style={{ flex: '1 1 280px', margin: 0 }}>
          <span>Email del docente</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="docente@universidad.edu.ar" maxLength={200} autoComplete="off" />
        </label>
        <button type="submit" className="btn btn-primary" disabled={enviando || !email.trim()}>
          {enviando ? 'Agregando…' : 'Agregar docente'}
        </button>
      </form>

      <div aria-live="polite">
        {aviso && <div className="muted" style={{ marginBottom: 12 }}>{aviso}</div>}
        {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}
      </div>

      {equipo === null && !error && <Cargando />}

      {equipo?.docentes.map((d) => {
        const esUno = d.id === yo?.id;
        return (
          <div key={d.id} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div>
              <div className="card-title">
                {d.nombre}
                {esUno && <span className="badge badge-revisado" style={{ marginLeft: 8 }}>Vos</span>}
              </div>
              <div className="card-meta">{d.email}</div>
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => quitar(d.id, d.nombre, esUno)} disabled={equipo.docentes.length <= 1} title={equipo.docentes.length <= 1 ? 'El curso tiene que quedar con al menos un docente' : undefined}>
              {esUno ? 'Salir del curso' : 'Sacar'}
            </button>
          </div>
        );
      })}

      {equipo && equipo.invitaciones.length > 0 && (
        <>
          <div className="eyebrow" style={{ margin: '20px 0 8px' }}>Invitaciones pendientes</div>
          {equipo.invitaciones.map((i) => (
            <div key={i.id} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div>
                <div className="card-title">{i.email}</div>
                <div className="card-meta">Todavía no tiene cuenta: entra al curso apenas se registre con este email.</div>
              </div>
              <button type="button" className="btn btn-secondary" onClick={() => cancelarInvitacion(i.id)}>
                Cancelar invitación
              </button>
            </div>
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
            <p className="muted" id="mArchivoAyuda" style={{ marginTop: 8, fontSize: 13 }}>
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
