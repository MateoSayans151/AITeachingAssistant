'use client';

// PasoPublicar: el último paso del wizard (el examen ya está creado, como borrador). Es AUTOCONTENIDO: maneja su propio estado y
// sus propias llamadas a la API. Carga las comisiones del curso; el docente pega la lista de alumnos (o elige una comisión que ya
// tiene), revisa los alumnos reconocidos (puede quitar a alguno o corregir un email con el dominio mal escrito), pone las fechas
// (opcionales) y publica: genera el link de acceso. Al terminar muestra el link con "Copiar link", el envío del link por mail a los
// alumnos (con el avance) y los accesos a las respuestas, al examen y al curso. Muestra sus propios errores.
//
// Contrato:
//   PasoPublicar({ examenId, cursoId, tituloExamen, duracionMinutos?, onPublicado? })
//     examenId         id del examen recién creado (se publica a una comisión con `publicarExamenAComision`).
//     cursoId          id del curso del examen (de ahí salen las comisiones; la comisión nueva se crea en este curso).
//     tituloExamen     título del examen. Queda en el contrato pero ya no se usa: el nombre del grupo es el de la comisión
//                      (se sugiere "Comisión A", o la próxima letra libre), no el del examen.
//     duracionMinutos? duración del examen por alumno, para el resumen ("60 min por alumno"); null/undefined = sin duración.
//     onPublicado?     se llama una vez cuando el link quedó generado, con el link y la cantidad de alumnos (null si no se sabe).

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createComision, getEstadoInvitaciones, invitarAlumnos, listComisionesPorCurso, publicarExamenAComision } from '@/lib/api';
import type { Comision, EstadoInvitaciones } from '@/lib/api';
import { resumenPublicacion, siguienteNombreComision, sugerirCorreccionDominio, validarFechasPublicacion } from '@/lib/alumnos';
import { fechaLocalAIso } from '@/lib/fechas';
import { mensajesDelServidor, parsearAlumnos } from '@/lib/examen-form';
import styles from './PasoPublicar.module.css';

export interface PasoPublicarProps {
  examenId: string;
  cursoId: string;
  tituloExamen: string;
  duracionMinutos?: number | null;
  onPublicado?: (info: { link: string | null; cantidadAlumnos: number | null }) => void;
}

/** Un alumno reconocido de la lista pegada, ya con su corrección aplicada (si el docente la aceptó). */
interface AlumnoFila {
  nombre: string;
  email: string;
  /** Email tal como lo reconoció el parser: es la clave para quitarlo o corregirlo. */
  original: string;
  /** Email sugerido si el dominio parece mal escrito (null si está bien). */
  sugerencia: string | null;
}

interface Publicacion {
  link: string | null;
  /** Id de la publicación del examen en la comisión (lo necesita el envío de invitaciones). */
  examenComisionId: string;
  cantidadAlumnos: number | null;
}

// Mientras hay un envío de mails corriendo se consulta el avance cada tanto; con tope, por si el servidor se reinicia a mitad de camino.
const INTERVALO_ESTADO_MS = 4000;
const TOPE_ESTADO_MS = 3 * 60 * 1000;

const plural = (n: number, singular: string, pluralForma: string) => `${n} ${n === 1 ? singular : pluralForma}`;

const cantidadDe = (c: Comision | undefined): number | null => c?._count?.alumnos ?? c?.alumnos?.length ?? null;

export function PasoPublicar({ examenId, cursoId, duracionMinutos, onPublicado }: PasoPublicarProps) {
  const [errores, setErrores] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [comisiones, setComisiones] = useState<Comision[] | null>(null);
  const [modoPublicar, setModoPublicar] = useState<'nueva' | 'existente'>('nueva');
  const [comisionSeleccionada, setComisionSeleccionada] = useState('');
  // null = el docente todavía no tocó el nombre: se muestra el sugerido, que depende de las comisiones que ya existen.
  const [nombreEscrito, setNombreEscrito] = useState<string | null>(null);
  const [textoAlumnos, setTextoAlumnos] = useState('');
  // Alumnos quitados de la lista y emails corregidos, por el email que reconoció el parser (el texto pegado no se toca).
  const [ignorados, setIgnorados] = useState<Set<string>>(new Set());
  const [correcciones, setCorrecciones] = useState<Record<string, string>>({});
  const [anuncio, setAnuncio] = useState('');
  const [publicado, setPublicado] = useState<Publicacion | null>(null);
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');

  const erroresRef = useRef<HTMLDivElement>(null);
  const tablaRef = useRef<HTMLDivElement>(null);
  // Posición de la fila que acaba de cambiar (quitar/corregir) para devolverle el foco al teclado cuando el botón desaparece.
  const focoEnFila = useRef<number | null>(null);

  const nombreSugerido = useMemo(() => siguienteNombreComision((comisiones ?? []).map((c) => c.nombre)), [comisiones]);
  const nombreComision = nombreEscrito ?? nombreSugerido;

  const parseados = useMemo(() => parsearAlumnos(textoAlumnos), [textoAlumnos]);
  const { filas, quitados, repetidosPorCorreccion } = useMemo(() => {
    const filas: AlumnoFila[] = [];
    const repetidosPorCorreccion: string[] = [];
    const vistos = new Set<string>();
    let quitados = 0;
    for (const a of parseados.alumnos) {
      if (ignorados.has(a.email)) {
        quitados++;
        continue;
      }
      const email = correcciones[a.email] ?? a.email;
      if (vistos.has(email)) {
        repetidosPorCorreccion.push(`El email ${email} quedó repetido después de corregir uno: se ignora una de las dos líneas.`);
        continue;
      }
      vistos.add(email);
      filas.push({ nombre: a.nombre, email, original: a.email, sugerencia: sugerirCorreccionDominio(email) });
    }
    return { filas, quitados, repetidosPorCorreccion };
  }, [parseados, ignorados, correcciones]);
  const problemas = [...parseados.errores, ...repetidosPorCorreccion];
  const conSugerencia = filas.filter((f) => f.sugerencia).length;

  const errorFechas = validarFechasPublicacion(fechaInicio, fechaFin);
  const cantidadAlumnos = modoPublicar === 'nueva' ? filas.length : cantidadDe((comisiones ?? []).find((c) => c.id === comisionSeleccionada));
  const resumen = resumenPublicacion({ alumnos: cantidadAlumnos, inicio: fechaInicio, fin: fechaFin, duracionMinutos });

  useEffect(() => {
    if (!cursoId) return;
    listComisionesPorCurso(cursoId)
      .then((cs) => {
        setComisiones(cs);
        setModoPublicar(cs.length > 0 ? 'existente' : 'nueva');
      })
      .catch(() => setComisiones([]));
  }, [cursoId]);

  // Los errores se muestran arriba del paso, pero el botón está abajo: se los acerca a la vista.
  useEffect(() => {
    if (errores.length > 0) erroresRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [errores]);

  // Tras quitar o corregir un alumno, el botón que tenía el foco ya no está: el foco pasa a la fila que ocupa ese lugar.
  useEffect(() => {
    if (focoEnFila.current === null) return;
    const posicion = focoEnFila.current;
    focoEnFila.current = null;
    const botones = tablaRef.current?.querySelectorAll<HTMLButtonElement>('button[data-quitar]');
    const destino = botones && botones.length > 0 ? botones[Math.min(posicion, botones.length - 1)] : document.getElementById('alumnos');
    destino?.focus();
  }, [filas]);

  function quitar(fila: AlumnoFila, posicion: number) {
    focoEnFila.current = posicion;
    setIgnorados((prev) => new Set(prev).add(fila.original));
    setAnuncio(`Quitaste a ${fila.nombre} de la lista.`);
  }

  function corregir(fila: AlumnoFila, posicion: number) {
    if (!fila.sugerencia) return;
    focoEnFila.current = posicion;
    setCorrecciones((prev) => ({ ...prev, [fila.original]: fila.sugerencia as string }));
    setAnuncio(`Corregiste el email de ${fila.nombre}: ahora es ${fila.sugerencia}.`);
  }

  function volverAIncluir() {
    setIgnorados(new Set());
    setAnuncio('Volviste a incluir a todos los alumnos.');
  }

  async function handlePublicar() {
    setErrores([]);
    let comisionId = comisionSeleccionada;
    if (modoPublicar === 'nueva') {
      if (!nombreComision.trim()) return setErrores(['Poné un nombre para el grupo de alumnos (por ejemplo, "Comisión A").']);
      if (filas.length === 0) {
        if (quitados > 0) return setErrores(['No queda ningún alumno: quitaste a todos. Volvé a incluirlos o pegá otra lista.']);
        if (problemas.length > 0) return setErrores(['No quedó ningún alumno válido en la lista: revisá las líneas con problemas.']);
        return setErrores(['Pegá la lista de alumnos: uno por línea, con su email.']);
      }
    } else if (!comisionId) {
      return setErrores(['Elegí una comisión.']);
    }
    // El mensaje ya está a la vista, junto a los campos: acá solo se lleva el foco al cierre.
    if (validarFechasPublicacion(fechaInicio, fechaFin)) return document.getElementById('fechaFin')?.focus();

    setLoading(true);
    try {
      let cantidad: number | null = null;
      if (modoPublicar === 'nueva') {
        cantidad = filas.length;
        const creada = await createComision(cursoId, {
          nombre: nombreComision.trim(),
          alumnos: filas.map(({ nombre, email }) => ({ nombre, email })),
        });
        comisionId = creada.id;
        // Si publicar falla, un reintento usa esta misma comisión en vez de crear otra.
        setComisiones((prev) => [...(prev ?? []), creada]);
        setComisionSeleccionada(creada.id);
        setModoPublicar('existente');
      }
      const resultado = await publicarExamenAComision(examenId, {
        comisionId,
        fechaInicio: fechaLocalAIso(fechaInicio),
        fechaFin: fechaLocalAIso(fechaFin),
      });
      if (cantidad === null) cantidad = cantidadDe((comisiones ?? []).find((c) => c.id === comisionId));
      setPublicado({ link: resultado.urlAcceso ?? null, examenComisionId: resultado.id, cantidadAlumnos: cantidad });
      onPublicado?.({ link: resultado.urlAcceso ?? null, cantidadAlumnos: cantidad });
    } catch (err) {
      const detalle = mensajesDelServidor(err);
      setErrores(['No se pudo publicar el examen.', ...detalle.slice(0, 3)]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {!publicado && (
        <div className={styles.aviso}>
          <p>Tu examen quedó guardado como borrador. Falta publicarlo para que los alumnos puedan rendirlo.</p>
          <Link href={`/examenes/${examenId}`} className="btn btn-secondary">
            Publicar más tarde
          </Link>
        </div>
      )}

      {errores.length > 0 && (
        <div className="error-box" role="alert" ref={erroresRef}>
          {errores.length === 1 ? (
            errores[0]
          ) : (
            <>
              {errores[0]}
              <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                {errores.slice(1).map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {!publicado && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: 6 }}>
            ¿Quiénes lo rinden?
          </div>
          <p className="muted" style={{ marginBottom: 14 }}>
            Cada alumno entra al link con el email con el que figura en la lista, y su nota le llega por mail a esa misma dirección: un
            email mal cargado pierde la nota de ese alumno. Cargalos tal cual los usan (no distingue mayúsculas).
          </p>

          {comisiones && comisiones.length > 0 && (
            <fieldset className={styles.modos}>
              <legend className={styles.srOnly}>Cómo cargás a los alumnos</legend>
              <label>
                <input type="radio" name="modoPublicar" checked={modoPublicar === 'nueva'} onChange={() => setModoPublicar('nueva')} />
                Pegar una lista de alumnos
              </label>
              <label>
                <input type="radio" name="modoPublicar" checked={modoPublicar === 'existente'} onChange={() => setModoPublicar('existente')} />
                Usar una comisión que ya tengo
              </label>
            </fieldset>
          )}

          {modoPublicar === 'existente' ? (
            <div className="field">
              <label htmlFor="comision">Comisión</label>
              <select id="comision" value={comisionSeleccionada} onChange={(e) => setComisionSeleccionada(e.target.value)}>
                <option value="">Elegí una comisión…</option>
                {(comisiones ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                    {c._count ? ` (${c._count.alumnos} alumnos)` : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="nombreComision">Nombre del grupo (la comisión)</label>
                <input id="nombreComision" value={nombreComision} onChange={(e) => setNombreEscrito(e.target.value)} placeholder="Ej: Comisión A" />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="alumnos">Alumnos</label>
                <textarea
                  id="alumnos"
                  value={textoAlumnos}
                  onChange={(e) => setTextoAlumnos(e.target.value)}
                  aria-describedby="alumnosConteo"
                  style={{ minHeight: 140 }}
                  placeholder={'Uno por línea. Con el email alcanza; si querés, el nombre antes:\nAna Pérez, ana@mail.com\nluis@mail.com'}
                />
                <div id="alumnosConteo" className="muted" style={{ fontSize: 13, marginTop: 4 }} aria-live="polite">
                  {textoAlumnos.trim() ? (
                    <>
                      {plural(filas.length, 'alumno reconocido', 'alumnos reconocidos')}
                      {problemas.length > 0 && (
                        <>
                          {' · '}
                          <strong style={{ color: 'var(--color-accent-800)' }}>
                            {problemas.length === 1 ? 'Se ignora 1 línea con problemas' : `Se ignoran ${problemas.length} líneas con problemas`}
                          </strong>
                        </>
                      )}
                    </>
                  ) : (
                    'Podés pegar directamente desde una planilla.'
                  )}
                </div>
              </div>

              {problemas.length > 0 && (
                <div className={styles.nota}>
                  <strong>Estas líneas no se publican</strong> (no impiden publicar; corregilas en el cuadro de arriba si querés incluirlas):
                  <ul>
                    {problemas.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}

              {(filas.length > 0 || quitados > 0) && (
                <div className={styles.reconocidos}>
                  <div className={styles.reconocidosTitulo}>
                    <strong id="tituloReconocidos" style={{ color: 'var(--color-text)' }}>
                      Alumnos reconocidos ({filas.length})
                    </strong>
                    <span>Quitar a alguien no borra su línea del texto: solo no se publica.</span>
                  </div>

                  {conSugerencia > 0 && (
                    <p className={styles.nota} style={{ marginTop: 0, marginBottom: 8 }}>
                      Revisá {plural(conSugerencia, 'email', 'emails')}: el dominio parece mal escrito.
                    </p>
                  )}

                  {filas.length > 0 && (
                    <div ref={tablaRef} className={styles.tablaScroll} role="region" aria-labelledby="tituloReconocidos" tabIndex={0}>
                      <table className={`table ${styles.tabla}`} role="table">
                        <caption className={styles.srOnly}>Alumnos reconocidos: nombre y email, con un botón para quitar a cada uno</caption>
                        <thead>
                          <tr role="row">
                            <th scope="col" role="columnheader">
                              Nombre
                            </th>
                            <th scope="col" role="columnheader">
                              Email
                            </th>
                            <th scope="col" role="columnheader">
                              <span className={styles.srOnly}>Acciones</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filas.map((f, i) => (
                            <tr key={f.original} role="row">
                              <td role="cell">{f.nombre}</td>
                              <td role="cell">
                                {f.email}
                                {f.sugerencia && (
                                  <div className={styles.sugerencia}>
                                    <span>
                                      ¿Quisiste decir <strong>{f.sugerencia}</strong>?
                                    </span>
                                    <button
                                      type="button"
                                      className={`btn btn-secondary ${styles.btnChico}`}
                                      onClick={() => corregir(f, i)}
                                      aria-label={`Corregir el email de ${f.nombre} a ${f.sugerencia}`}
                                    >
                                      Corregir
                                    </button>
                                  </div>
                                )}
                              </td>
                              <td role="cell">
                                <button
                                  type="button"
                                  data-quitar
                                  className={`btn btn-secondary ${styles.btnChico} ${styles.quitar}`}
                                  onClick={() => quitar(f, i)}
                                  aria-label={`Quitar a ${f.nombre} (${f.email})`}
                                >
                                  Quitar
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {quitados > 0 && (
                    <div className={styles.quitados}>
                      <span>{quitados === 1 ? 'Quitaste a 1 alumno de la lista.' : `Quitaste a ${quitados} alumnos de la lista.`}</span>
                      <button type="button" className={`btn btn-ghost ${styles.btnChico}`} onClick={volverAIncluir}>
                        Volver a incluirlos
                      </button>
                    </div>
                  )}
                </div>
              )}
              <div className={styles.srOnly} aria-live="polite">
                {anuncio}
              </div>
            </>
          )}

          <div className={styles.seccion}>
            <h3 style={{ marginBottom: 10 }}>¿Cuándo?</h3>
            <div className={styles.fechas}>
              <div className="field">
                <label htmlFor="fechaInicio">Se habilita (opcional)</label>
                <input id="fechaInicio" type="datetime-local" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="fechaFin">Cierra (opcional)</label>
                <input
                  id="fechaFin"
                  type="datetime-local"
                  value={fechaFin}
                  onChange={(e) => setFechaFin(e.target.value)}
                  aria-invalid={errorFechas ? true : undefined}
                  aria-describedby={errorFechas ? 'fechasError' : undefined}
                />
              </div>
            </div>
            {errorFechas && (
              <p id="fechasError" className={styles.errorCampo} role="alert">
                {errorFechas}
              </p>
            )}
          </div>

          <p className={styles.resumen}>
            <b>Se publica así</b>
            {resumen}
          </p>
          <button className="btn btn-primary" onClick={handlePublicar} disabled={loading}>
            {loading ? 'Publicando…' : 'Publicar y generar link'}
          </button>
        </div>
      )}

      {publicado && <Publicado examenId={examenId} cursoId={cursoId} publicado={publicado} />}
    </div>
  );
}

// ---------------------------------------------------------------- pantalla final: el examen ya está publicado

function Publicado({ examenId, cursoId, publicado }: { examenId: string; cursoId: string; publicado: Publicacion }) {
  const { link, cantidadAlumnos } = publicado;
  const [copiado, setCopiado] = useState(false);
  const [errorCopia, setErrorCopia] = useState(false);

  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 2000);
    return () => clearTimeout(t);
  }, [copiado]);

  async function copiar() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setErrorCopia(false);
      setCopiado(true);
    } catch {
      setErrorCopia(true);
    }
  }

  return (
    <div className="card">
      <div className="card-title" style={{ marginBottom: 6 }}>
        Listo: el examen está publicado
      </div>
      <p className="muted">
        {cantidadAlumnos === 1
          ? 'El alumno de la lista entra'
          : cantidadAlumnos !== null
            ? `Los ${cantidadAlumnos} alumnos de la lista entran`
            : 'Los alumnos de la lista entran'}{' '}
        al link con su email.
      </p>

      <div className={styles.seccion}>
        <h3>Mandá este link a tus alumnos</h3>
        {link ? (
          <>
            <p className={styles.linkBox} style={{ marginTop: 10 }}>
              {link}
            </p>
            <div className={styles.fila}>
              <button type="button" className={`btn btn-primary ${styles.btnGrande}`} onClick={copiar}>
                {copiado ? '¡Copiado!' : 'Copiar link'}
              </button>
              <span className={styles.srOnly} aria-live="polite">
                {copiado ? 'Link copiado' : ''}
              </span>
            </div>
            {errorCopia && (
              <p className="muted" style={{ marginTop: 8, fontSize: 13 }} role="alert">
                No se pudo copiar automáticamente: seleccioná el link y copialo a mano.
              </p>
            )}
          </>
        ) : (
          <p className="muted" style={{ marginTop: 6 }}>
            El examen quedó publicado, pero el servidor no devolvió el link. Entrá al examen para verlo.
          </p>
        )}

        <InvitarPorMail examenId={examenId} examenComisionId={publicado.examenComisionId} cantidadAlumnos={cantidadAlumnos} />
      </div>

      <div className={styles.seccion}>
        <p className="muted" style={{ marginBottom: 14 }}>
          Las notas se envían por mail a cada alumno cuando las publiques desde Respuestas.
        </p>
        <div className={styles.fila}>
          <Link href={`/examenes/${examenId}/respuestas`} className="btn btn-secondary">
            Ver respuestas
          </Link>
          <Link href={`/examenes/${examenId}`} className="btn btn-secondary">
            Ir al examen
          </Link>
          {cursoId && (
            <Link href={`/cursos/${cursoId}`} className="btn btn-secondary">
              Volver al curso
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- enviar el link por mail a los alumnos

function InvitarPorMail({ examenId, examenComisionId, cantidadAlumnos }: { examenId: string; examenComisionId: string; cantidadAlumnos: number | null }) {
  const [estado, setEstado] = useState<EstadoInvitaciones | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sondeando, setSondeando] = useState(false);
  // Se dejó de consultar solo porque pasó el tope de tiempo (el docente puede actualizar a mano).
  const [cortado, setCortado] = useState(false);

  async function refrescar() {
    try {
      const e = await getEstadoInvitaciones(examenId);
      setEstado(e);
      if (e.enCurso) {
        setCortado(false);
        setSondeando(true);
      }
    } catch {
      /* sin conexión o un servidor sin este endpoint: queda lo que ya se sabía */
    }
  }

  // Al abrir: si el servidor tiene el envío configurado, en qué modo está y si ya hay un lote corriendo.
  useEffect(() => {
    let cancelado = false;
    getEstadoInvitaciones(examenId)
      .then((e) => {
        if (cancelado) return;
        setEstado(e);
        if (e.enCurso) setSondeando(true);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [examenId]);

  // Mientras hay un lote en curso, consulta el avance cada ~4 s (hasta el tope) y limpia el intervalo al desmontar.
  useEffect(() => {
    if (!sondeando) return;
    let cancelado = false;
    const desde = Date.now();
    const id = setInterval(async () => {
      try {
        const e = await getEstadoInvitaciones(examenId);
        if (cancelado) return;
        setEstado(e);
        if (!e.enCurso) return setSondeando(false);
      } catch {
        /* se reintenta en la próxima vuelta */
      }
      if (!cancelado && Date.now() - desde > TOPE_ESTADO_MS) {
        setSondeando(false);
        setCortado(true);
      }
    }, INTERVALO_ESTADO_MS);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [sondeando, examenId]);

  async function enviar() {
    const cuantos = cantidadAlumnos !== null ? plural(cantidadAlumnos, 'mail', 'mails') : 'un mail por alumno';
    const modoPrueba = estado?.modoPrueba
      ? `El servidor está en modo prueba: todos los mails van a ${estado.modoPrueba} y no llegan a los alumnos.`
      : 'Si el servidor está en modo prueba, todos los mails van a una sola casilla y no llegan a los alumnos.';
    const confirmado = window.confirm(
      `Se van a mandar ${cuantos} (uno a cada alumno de la lista) con el link para rendir.\n\n` +
        `El plan gratuito de Resend permite 100 mails por día: si te pasás, el resto no sale.\n\n${modoPrueba}\n\n¿Los mando?`,
    );
    if (!confirmado) return;

    setError(null);
    setCortado(false);
    setEnviando(true);
    try {
      const { aEnviar } = await invitarAlumnos(examenId, examenComisionId);
      setEstado((prev) => ({ configurado: true, modoPrueba: prev?.modoPrueba ?? null, total: aEnviar, enviados: 0, conError: 0, enCurso: true, ultimoError: null }));
      setSondeando(true);
    } catch (err) {
      // El servidor explica el motivo en `message` (no hay configuración, ya hay un envío en curso, no hay a quién mandarle…).
      setError(mensajesDelServidor(err)[0] ?? 'No se pudieron mandar los mails. Probá de nuevo en un rato.');
      void refrescar();
    } finally {
      setEnviando(false);
    }
  }

  const enCurso = enviando || estado?.enCurso === true;
  const sinConfigurar = estado !== null && !estado.configurado;
  const hayAvance = estado !== null && (estado.total > 0 || estado.enCurso);

  return (
    <div style={{ marginTop: 18 }}>
      {estado?.modoPrueba && (
        <p className={styles.nota} style={{ marginTop: 0, marginBottom: 10 }}>
          Modo prueba: los mails llegan a <strong>{estado.modoPrueba}</strong>, no a los alumnos.
        </p>
      )}
      <div className={styles.fila}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={enviar}
          disabled={enCurso || sinConfigurar}
          aria-describedby={sinConfigurar ? 'sinMailAyuda' : undefined}
        >
          {enCurso ? 'Enviando…' : 'Enviar el link por mail a los alumnos'}
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          Cada alumno lo recibe en el email con el que figura en la lista.
        </span>
      </div>
      {sinConfigurar && (
        <p id="sinMailAyuda" className="muted" style={{ marginTop: 8, fontSize: 13 }}>
          Falta configurar el envío de mails en el servidor.
        </p>
      )}

      {error && (
        <p className={styles.errorEnvio} role="alert">
          {error}
        </p>
      )}

      <div className={styles.estadoEnvio} aria-live="polite">
        {hayAvance && estado && (
          <p>
            {estado.enCurso ? 'Enviando: ' : ''}
            {plural(estado.enviados, 'enviado', 'enviados')} · {estado.conError} con error
            {estado.total > 0 ? ` (de ${estado.total})` : ''}
          </p>
        )}
        {estado?.ultimoError && (
          <p className={styles.errorEnvio} style={{ marginTop: 6 }}>
            Último error: {estado.ultimoError}
          </p>
        )}
        {cortado && (
          <p className="muted">
            Dejamos de actualizar el avance solos.{' '}
            <button type="button" className={`btn btn-ghost ${styles.btnChico}`} onClick={refrescar}>
              Actualizar
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
