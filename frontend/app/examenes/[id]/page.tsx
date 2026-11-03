'use client';

import { TabsExamen } from '@/app/components/TabsExamen';
import { TituloEditable } from '@/app/components/TituloEditable';
import { Cargando } from '@/app/components/Cargando';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ConfirmarBorrado } from '@/app/components/ConfirmarBorrado';
import { CambiarFechasModal, CerrarExamenModal, EditarExamenModal, ReabrirExamenModal } from '@/app/components/ControlExamen';
import { CopiarLinkButton } from '@/app/components/CopiarLinkButton';
import { InvitarPorMail } from '@/app/examenes/nuevo/PasoPublicar';
import {
  Comision,
  Examen,
  ExamenComision,
  Pregunta,
  TIPOS_AUTOCORREGIBLES,
  deleteExamen,
  getAlumnosQueRindieron,
  getExamen,
  listComisionesPorCurso,
  publicarExamenAComision,
  renombrarExamen,
} from '@/lib/api';
import { fechaLocalAIso } from '@/lib/fechas';
import { mensajeDeError } from '@/lib/errores';
import { plural } from '@/lib/texto';

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
  // Por defecto el link lo puede abrir cualquier alumno; marcado, entran solo los de la lista de la comisión.
  const [soloLista, setSoloLista] = useState(false);
  const [verificarEmail, setVerificarEmail] = useState(false);
  const [dominioPermitido, setDominioPermitido] = useState('');
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [programar, setProgramar] = useState(false); // «Programar cuándo se abre y cuándo cierra»: apagado, las fechas no se piden
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Qué diálogo está abierto: cerrar, reabrir, editar, eliminar o cambiar las fechas de un link.
  const [dialogo, setDialogo] = useState<'cerrar' | 'reabrir' | 'editar' | 'eliminar' | null>(null);
  const [fechasDe, setFechasDe] = useState<ExamenComision | null>(null);
  // Cuántos alumnos empezaron o entregaron (se pide al abrir editar o eliminar: decide qué se puede cambiar y qué se pierde).
  const [rindieron, setRindieron] = useState<{ intentos: number; respuestas: number; empezaron: number } | null>(null);
  // Aviso de lo que acaba de pasar ("Examen cerrado…"): aparte de `error`, que reemplaza toda la pantalla.
  const [aviso, setAviso] = useState<string | null>(null);

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
        <Cargando variante="pagina" />
      </div>
    );
  }

  const comisionesYaPublicadas = new Set((examen.comisiones ?? []).map((ec) => ec.comisionId));
  const comisionesDisponibles = comisiones.filter((c) => !comisionesYaPublicadas.has(c.id));
  const empezaron = Math.max(examen._count?.respuestas ?? 0, examen._count?.intentos ?? 0);
  const cerrado = examen.estado === 'cerrado';
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
        accesoAbierto: !soloLista,
        verificarEmail,
        dominioPermitido: dominioPermitido.trim() || undefined,
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

  async function abrirDialogo(cual: 'editar' | 'eliminar') {
    // Se pide el número justo antes de mostrar el diálogo: lo que se pierde al borrar tiene que ser lo de ahora, no lo de cuando se cargó la página.
    setRindieron(null);
    setAviso(null);
    try {
      setRindieron(await getAlumnosQueRindieron(examen!.id));
    } catch {
      setRindieron({ intentos: examen!._count?.intentos ?? 0, respuestas: examen!._count?.respuestas ?? 0, empezaron });
    }
    setDialogo(cual);
  }

  async function eliminar(confirmacion: string) {
    try {
      await deleteExamen(examen!.id, confirmacion);
    } catch (err) {
      throw new Error(mensajeDeError(err, 'No se pudo eliminar el examen.'));
    }
    router.push(`/cursos/${examen!.cursoId}`);
  }

  function listo(mensaje: string) {
    setDialogo(null);
    setAviso(mensaje);
    cargar();
  }

  const origen = typeof window !== 'undefined' ? window.location.origin : '';
  const hayPublicadas = (examen.comisiones ?? []).length > 0;

  return (
    <div className="page page-examen">
      <header className="page-header">
        <Link href={`/cursos/${examen.cursoId}`} className="volver">
          ← Volver al curso
        </Link>
        <div className="eyebrow">
          Examen
          {cerrado && (
            <span className="badge badge-cerrado" style={{ marginLeft: 8 }}>
              Cerrado
            </span>
          )}
        </div>
        <TituloEditable valor={examen.titulo} onCambiar={(titulo) => setExamen((e) => (e ? { ...e, titulo } : e))} onConfirmar={(titulo) => renombrarExamen(examen.id, titulo)} />
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

      <div className="examen-barra" data-guia="examen-pestanas">
        <TabsExamen examenId={examen.id} activa="examen" cantidadRespuestas={examen._count?.respuestas ?? 0} />
        <div className="examen-barra-acciones" data-guia="examen-acciones">
          <button type="button" className="btn btn-secondary" onClick={() => abrirDialogo('editar')}>
            Editar
          </button>
          <Link href={`/examenes/nuevo?desde=${examen.id}`} className="btn btn-secondary">
            Duplicar y editar
          </Link>
          {cerrado ? (
            <button type="button" className="btn btn-secondary" onClick={() => setDialogo('reabrir')}>
              Volver a abrir
            </button>
          ) : (
            hayPublicadas && (
              <button type="button" className="btn btn-secondary" onClick={() => setDialogo('cerrar')} title="Impide que empiecen alumnos nuevos">
                Cerrar examen
              </button>
            )
          )}
          <button type="button" className="btn btn-ghost btn-peligro" onClick={() => abrirDialogo('eliminar')} title="Borra el examen y todo lo que tiene">
            Eliminar examen
          </button>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}
      {aviso && (
        <div className="aviso-ok" role="status">
          {aviso}
        </div>
      )}
      {cerrado && (
        <p className="muted" role="status">
          El examen está cerrado: los links no aceptan alumnos nuevos. Podés volver a abrirlo con «Volver a abrir».
        </p>
      )}

      {dialogo === 'cerrar' && <CerrarExamenModal examenId={examen.id} onListo={listo} onCancelar={() => setDialogo(null)} />}
      {dialogo === 'reabrir' && <ReabrirExamenModal examenId={examen.id} onListo={listo} onCancelar={() => setDialogo(null)} />}
      {dialogo === 'editar' && rindieron && (
        <EditarExamenModal
          examen={examen}
          empezaron={rindieron.empezaron}
          onListo={(titulo, consigna, feedbackModo) => {
            setExamen((e) => (e ? { ...e, titulo, consigna, feedbackModo } : e));
            setDialogo(null);
            setAviso('Cambios guardados.');
          }}
          onCancelar={() => setDialogo(null)}
        />
      )}
      {dialogo === 'eliminar' && rindieron && (
        <ConfirmarBorrado
          titulo="¿Eliminar el examen?"
          nombre={examen.titulo}
          etiquetaNombre="examen"
          perdida={[
            `Sus ${plural(examen.preguntas?.length ?? 0, 'pregunta', 'preguntas')} y rúbricas`,
            ...(rindieron.respuestas > 0 ? [`${plural(rindieron.respuestas, 'respuesta de alumno', 'respuestas de alumnos')}, con sus notas y devoluciones`] : []),
            ...(rindieron.intentos > rindieron.respuestas ? [`${plural(rindieron.intentos - rindieron.respuestas, 'alumno rindiendo', 'alumnos rindiendo')} ahora mismo, que pierden lo que escribieron`] : []),
            ...(hayPublicadas ? [`${plural(examen.comisiones!.length, 'link publicado', 'links publicados')}: dejan de funcionar`] : []),
            'Las capturas de pantalla guardadas',
          ]}
          textoConfirmar="Eliminar examen"
          onConfirmar={() => eliminar(examen.titulo)}
          onCancelar={() => setDialogo(null)}
        />
      )}
      {fechasDe && (
        <CambiarFechasModal
          examenId={examen.id}
          publicacion={fechasDe}
          onListo={() => {
            setFechasDe(null);
            setAviso('Fechas actualizadas.');
            cargar();
          }}
          onCancelar={() => setFechasDe(null)}
        />
      )}

      <div className="examen-columnas">
        <section className="card" aria-labelledby="titulo-preguntas">
          <h2 id="titulo-preguntas" className="card-title" style={{ marginBottom: 'var(--space-4)' }}>
            Preguntas ({examen.preguntas?.length ?? 0})
          </h2>
          <ol className="lista-preguntas">
            {examen.preguntas?.map((p) => (
              <li key={p.id}>
                <span>{p.enunciado}</span>
                <span className="muted lista-preguntas-pts">{fmtPts(puntajeEfectivo(p))} pts</span>
              </li>
            ))}
          </ol>
          <div className="lista-preguntas-total">
            Total: {fmtPts(puntajeTotal)} de {fmtPts(Number(examen.escalaMax))} pts
          </div>
        </section>

        <section className="card" aria-labelledby="titulo-publicacion">
          <h2 id="titulo-publicacion" className="card-title" style={{ marginBottom: 'var(--space-4)' }}>
            Publicación
          </h2>

          {!hayPublicadas && <p className="muted">Todavía no publicaste este examen a ninguna comisión: elegí una abajo para generar el link.</p>}

          {examen.comisiones?.map((ec) => {
            const url = `${origen}/rendir/${ec.slugAcceso}`;
            return (
              <div key={ec.id} className="publicacion">
                <strong>{ec.comision?.nombre}</strong>
                <div className="link-publico">{origen ? url : ec.slugAcceso}</div>
                <div className="muted publicacion-detalle">
                  {ec.fechaInicio ? `Se habilita ${new Date(ec.fechaInicio).toLocaleString('es-AR')}` : 'Habilitado desde ya'}
                  {' · '}
                  {ec.fechaFin ? `cierra ${new Date(ec.fechaFin).toLocaleString('es-AR')}` : 'sin fecha de cierre'}
                  {' · '}
                  {ec.accesoAbierto ? 'entra cualquiera con el link' : 'entran solo los de la lista'}
                  {ec.verificarEmail ? ` · con código por mail${ec.dominioPermitido ? ` (solo @${ec.dominioPermitido})` : ''}` : ''}
                </div>
                <div style={{ marginTop: 8 }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setFechasDe(ec)}>
                    Cambiar fechas
                  </button>
                </div>
                <InvitarPorMail
                  examenId={examen.id}
                  examenComisionId={ec.id}
                  cantidadAlumnos={ec.comision?._count?.alumnos ?? null}
                  acciones={origen ? <CopiarLinkButton url={url} /> : undefined}
                />
              </div>
            );
          })}

          {linkGenerado && (
            <div className="error-box" style={{ background: 'var(--color-success-soft)', border: 'none', color: 'var(--color-success)' }}>
              Link generado: {linkGenerado}
            </div>
          )}

          {comisionesDisponibles.length > 0 && (
            <div className="form-publicar">
              <h3>{hayPublicadas ? 'Publicar en otra comisión' : 'Publicar en una comisión'}</h3>

              <div className="field">
                <label htmlFor="pub-comision">Comisión</label>
                <select id="pub-comision" value={comisionSeleccionada} onChange={(e) => setComisionSeleccionada(e.target.value)}>
                  <option value="">Elegí una comisión…</option>
                  {comisionesDisponibles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
                <p className="ayuda-campo">El grupo de alumnos que va a rendir con este link.</p>
              </div>

              <label className="switch-fila">
                <span>
                  <strong>Programar cuándo se abre y cuándo cierra</strong>
                  <span className="ayuda-campo">{programar ? 'Elegí las fechas; podés dejar una vacía.' : 'Si no, se habilita ahora y no tiene fecha de cierre.'}</span>
                </span>
                <span className="switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={programar}
                    onChange={(e) => {
                      setProgramar(e.target.checked);
                      if (!e.target.checked) {
                        setFechaInicio('');
                        setFechaFin('');
                      }
                    }}
                    aria-label="Programar cuándo se abre y cuándo cierra"
                  />
                  <span className="switch-pista" aria-hidden="true" />
                </span>
              </label>

              {programar && (
                <div className="fila-campos">
                  <div className="field">
                    <label htmlFor="pub-inicio">Se habilita</label>
                    <input id="pub-inicio" type="datetime-local" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="pub-fin">Cierra</label>
                    <input id="pub-fin" type="datetime-local" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
                  </div>
                </div>
              )}

              <div className="opciones-tarjetas">
                <label className="opcion-tarjeta">
                  <span>
                    <strong>Solo los alumnos de mi lista</strong>
                    <span className="ayuda-campo">{soloLista ? 'Entran únicamente los mails que cargaste.' : 'Hoy puede entrar cualquiera que tenga el link.'}</span>
                  </span>
                  <input type="checkbox" checked={soloLista} onChange={(e) => setSoloLista(e.target.checked)} />
                </label>
                <label className="opcion-tarjeta">
                  <span>
                    <strong>Pedir código por mail</strong>
                    <span className="ayuda-campo">Cada alumno recibe un código de 6 dígitos: comprueba que el mail es suyo.</span>
                  </span>
                  <input type="checkbox" checked={verificarEmail} onChange={(e) => setVerificarEmail(e.target.checked)} />
                </label>
              </div>

              {verificarEmail && !soloLista && (
                <div className="field">
                  <label htmlFor="pub-dominio">Dominio permitido (opcional)</label>
                  <input id="pub-dominio" placeholder="alumnos.edu.ar" value={dominioPermitido} onChange={(e) => setDominioPermitido(e.target.value)} maxLength={100} />
                  <p className="ayuda-campo">Si lo completás, solo entran mails de ese dominio.</p>
                </div>
              )}

              <button className="btn btn-primary" onClick={handlePublicar} disabled={loading || !comisionSeleccionada}>
                {loading ? 'Publicando…' : 'Publicar y generar link'}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
