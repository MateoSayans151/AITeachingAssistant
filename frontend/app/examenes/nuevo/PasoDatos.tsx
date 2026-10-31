'use client';

// PasoDatos: los datos y ajustes del examen. Se dibuja en partes (`parte`): el ENCABEZADO (el curso, que ya viene elegido: el examen se crea
// desde la página de un curso y no se cambia acá), la INTEGRIDAD y los AJUSTES (instrucciones para los alumnos y dos bloques plegables, porque casi
// siempre alcanzan los valores por defecto): "Cómo se rinde" (modalidad y duración, liberación del feedback, señales de integridad)
// y "Cómo corrige la IA" (escala de niveles de desempeño, nota mínima y distribución esperada de aprobados). Cuánto vale el examen
// NO se pide acá: vive en la barra de puntos del paso de preguntas. Cada bloque muestra un resumen de lo configurado y un error de
// validación lo vuelve a abrir.
//
// La escala de niveles es SIEMPRE el editor personalizado: de 3 a 7 niveles (5 por defecto), con nombre y porcentaje editables,
// "Quitar" por fila, "+ Agregar nivel", "Cantidad de niveles" y "Repartir porcentajes en partes iguales". El color de cada nivel
// no se elige: se calcula por posición (de claro a oscuro, `colorDeNivel`). Las operaciones sobre la escala son funciones puras de
// `@/lib/examen-form` (agregarNivel, quitarNivel, repartirPorcentajes, cambiarCantidadNiveles).
//
// Contrato:
//   PasoDatos({ datos, onChange, cursos, ajustesAbierto, onToggleAjustes, avanzadoAbierto, onToggleAvanzado })
//     datos             DatosForm completo (el estado vive en el padre).
//     onChange(patch)   se llama con los campos que cambiaron (Partial<DatosForm>); el padre los mezcla con `datos`. Cuando
//                       cambia la escala avisa con `onChange({ niveles })` (el arreglo completo, ya normalizado: orden 1..N y
//                       colores por posición): el padre se apoya en eso para reconciliar los niveles de cada criterio
//                       (`reconciliarNiveles`). Cada acción del docente hace UN solo `onChange`.
//     cursos            cursos del docente, o null mientras se cargan (el select queda deshabilitado).
//     ajustesAbierto    si "Cómo se rinde" está desplegado (estado del padre: un error de validación lo vuelve a abrir).
//     onToggleAjustes   el docente apretó el botón de "Cómo se rinde".
//     avanzadoAbierto   si "Cómo corrige la IA" está desplegado (estado del padre: un error de validación lo vuelve a abrir).
//     onToggleAvanzado  el docente apretó el botón de "Cómo corrige la IA".

import { Fragment, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { Curso, FeedbackModo, ModalidadExamen } from '@/lib/api';
import {
  CONSIGNA_POR_DEFECTO,
  MAX_NIVELES,
  MIN_NIVELES,
  agregarNivel,
  cambiarCantidadNiveles,
  esNumero,
  formatearPuntos,
  hayErrorEnAjustes,
  nivelDelMedio,
  puntosDeEjemplo,
  quitarNivel,
  repartirPorcentajes,
  resumenAjustes,
  resumenNiveles,
  validarDistribucion,
  validarNiveles,
} from '@/lib/examen-form';
import type { DatosForm } from '@/lib/examen-form';
import estilos from './PasoDatos.module.css';

export interface PasoDatosProps {
  /** Qué parte dibujar: 'encabezado' (el curso), 'integridad' (el control de integridad), 'ajustes' (todo lo demás) o todas juntas. */
  parte?: 'encabezado' | 'integridad' | 'ajustes';
  datos: DatosForm;
  onChange: (patch: Partial<DatosForm>) => void;
  cursos: Curso[] | null;
  ajustesAbierto: boolean;
  onToggleAjustes: () => void;
  avanzadoAbierto: boolean;
  onToggleAvanzado: () => void;
}

export function PasoDatos({ parte, datos, onChange, cursos, ajustesAbierto, onToggleAjustes, avanzadoAbierto, onToggleAvanzado }: PasoDatosProps) {
  const verEncabezado = !parte || parte === 'encabezado';
  const verIntegridad = !parte || parte === 'integridad';
  const verAjustes = !parte || parte === 'ajustes';
  const { niveles } = datos;
  const [anuncio, setAnuncio] = useState(''); // texto de la región aria-live (cambios de cantidad y reparto)
  const enfocarNivel = useRef<number | null>(null); // fila cuyo nombre recibe el foco después de agregar o quitar

  // Después de agregar o quitar un nivel el foco pasa al nombre de la fila que corresponde (si no, se perdería con la fila quitada).
  useEffect(() => {
    if (enfocarNivel.current === null) return;
    const campo = document.getElementById(`nivel-nombre-${enfocarNivel.current}`) as HTMLInputElement | null;
    enfocarNivel.current = null;
    campo?.focus();
    campo?.select();
  }, [niveles]);

  function actualizarNivel(i: number, campo: 'nombre' | 'porcentaje', valor: string) {
    onChange({ niveles: niveles.map((n, idx) => (idx === i ? { ...n, [campo]: valor } : n)) });
  }

  function cambiarCantidad(cantidad: number) {
    const nuevos = cambiarCantidadNiveles(niveles, cantidad);
    if (nuevos === niveles) return;
    setAnuncio(`La escala tiene ahora ${nuevos.length} niveles.`);
    onChange({ niveles: nuevos });
  }

  function agregar() {
    const nuevos = agregarNivel(niveles);
    if (nuevos === niveles) return;
    enfocarNivel.current = nuevos.length - 2; // el nivel nuevo entra justo antes del último
    setAnuncio(`Se agregó un nivel: la escala tiene ahora ${nuevos.length} niveles.`);
    onChange({ niveles: nuevos });
  }

  function quitar(i: number) {
    const nuevos = quitarNivel(niveles, i);
    if (nuevos === niveles) return;
    enfocarNivel.current = Math.min(i, nuevos.length - 1);
    setAnuncio(`Se quitó el nivel «${niveles[i].nombre.trim() || i + 1}»: la escala tiene ahora ${nuevos.length} niveles.`);
    onChange({ niveles: nuevos });
  }

  function repartir() {
    setAnuncio('Los porcentajes quedaron repartidos en partes iguales.');
    onChange({ niveles: repartirPorcentajes(niveles) });
  }

  // Escala de niveles (opciones avanzadas): ejemplo en vivo (con el nivel del medio) y errores de las reglas.
  const nivelEjemplo = nivelDelMedio(niveles);
  const puntosEjemplo = nivelEjemplo ? puntosDeEjemplo(nivelEjemplo.porcentaje) : null;
  const erroresNiveles = validarNiveles(niveles);
  const avanzadoConError = erroresNiveles.length > 0 || validarDistribucion(datos).length > 0;
  const ajustesConError = hayErrorEnAjustes(datos);
  const enMinimo = niveles.length <= MIN_NIVELES;
  const enMaximo = niveles.length >= MAX_NIVELES;
  // Cantidades del select: de 3 a 7 (y la real, si un examen duplicado trajera una fuera de ese rango, para no mostrar otra).
  const cantidades = Array.from(new Set([...Array.from({ length: MAX_NIVELES - MIN_NIVELES + 1 }, (_, k) => MIN_NIVELES + k), niveles.length])).sort((a, b) => a - b);

  return (
    <div>
      {verEncabezado && (
        <div className={estilos.cursoFijo}>
          <span className={estilos.cursoFijoEtiqueta}>Curso</span>
          {datos.cursoElegido ? (
            <Link href={`/cursos/${datos.cursoElegido}`} className={estilos.cursoFijoNombre} title="Volver a la página del curso">
              {cursos === null ? 'Cargando…' : (cursos.find((c) => c.id === datos.cursoElegido)?.nombre ?? 'Curso')}
            </Link>
          ) : null}
        </div>
      )}
      {verIntegridad && (
        <section className={estilos.integridad} aria-labelledby="integridad-titulo">
          <div className={estilos.integridadCabecera}>
            <div className={estilos.integridadTexto}>
              <h2 id="integridad-titulo" className={estilos.integridadTitulo}>
                Control de integridad
              </h2>
              <p className="muted">
                Avisame si el alumno sale de la pantalla, cambia de pestaña o pega texto. Solo se registra: no bloquea nada ni baja la nota, y lo
                ves junto a cada respuesta para decidir vos.
              </p>
            </div>
            <label className="switch">
              <input type="checkbox" role="switch" checked={datos.antiCheatOn} onChange={(e) => onChange({ antiCheatOn: e.target.checked })} aria-label="Activar el control de integridad" />
              <span className="switch-pista" aria-hidden="true" />
              <span className="switch-texto">{datos.antiCheatOn ? 'Activado' : 'Desactivado'}</span>
            </label>
          </div>
          {datos.antiCheatOn && (
            <div className={estilos.integridadOpciones}>
              <p className="muted" style={{ margin: 0 }}>
                Antes de empezar, el alumno ve exactamente qué se registra y tiene que aceptarlo. Elegí qué registrar:
              </p>
              <div className={estilos.opcionesIntegridad}>
                <label className={estilos.opcionCard}>
                  <span className={estilos.opcionTexto}>
                    <span className={estilos.opcionTitulo}>Pantalla completa</span>
                    <span className={estilos.opcionDesc}>Registra cada vez que el alumno sale de ella.</span>
                  </span>
                  <input type="checkbox" checked={datos.acPantalla} onChange={(e) => onChange({ acPantalla: e.target.checked })} />
                </label>
                <label className={estilos.opcionCard}>
                  <span className={estilos.opcionTexto}>
                    <span className={estilos.opcionTitulo}>Cambio de pestaña o ventana</span>
                    <span className={estilos.opcionDesc}>Registra cuándo el alumno pasa a otra pestaña o ventana.</span>
                  </span>
                  <input type="checkbox" checked={datos.acPestana} onChange={(e) => onChange({ acPestana: e.target.checked })} />
                </label>
                <label className={estilos.opcionCard}>
                  <span className={estilos.opcionTexto}>
                    <span className={estilos.opcionTitulo}>Pegado de texto</span>
                    <span className={estilos.opcionDesc}>Registra cuando pega texto en las respuestas.</span>
                  </span>
                  <input type="checkbox" checked={datos.acPegado} onChange={(e) => onChange({ acPegado: e.target.checked })} />
                </label>
                <label className={estilos.opcionCard}>
                  <span className={estilos.opcionTexto}>
                    <span className={estilos.opcionTitulo}>
                      Capturas de pantalla <span className={estilos.opcionEtiqueta}>Más invasivo</span>
                    </span>
                    <span className={estilos.opcionDesc}>El alumno comparte la pantalla completa y se guardan capturas cada pocos minutos y cuando sale de la ventana.</span>
                  </span>
                  <input type="checkbox" checked={datos.acCaptura} onChange={(e) => onChange({ acCaptura: e.target.checked })} />
                </label>
              </div>
              {datos.acCaptura && (
                <p className="muted" style={{ margin: 0 }}>
                  Las capturas solo las ves vos, junto a cada respuesta, y se borran solas a los 7 días (podés borrarlas antes). Necesita una
                  computadora: desde un celular el alumno no puede compartir la pantalla. Es el control más invasivo: usalo para exámenes que lo
                  justifiquen y avisale a los alumnos con tiempo.
                </p>
              )}
              {!datos.acPantalla && !datos.acPestana && !datos.acPegado && !datos.acCaptura && <p className="muted" style={{ margin: 0 }}>Sin ningún control marcado, el examen se rinde sin monitoreo.</p>}
              <details className={estilos.masInfo}>
                <summary>Qué tener en cuenta</summary>
                {datos.modalidad === 'ventana_dias' && (
                  <p className="muted">
                    En una ventana de varios días el alumno rinde desde su casa y estos controles dicen poco: suelen tener más sentido en una
                    sesión con tiempo límite (se elige en «Cómo se rinde»).
                  </p>
                )}
                <p className="muted">
                  En secundaria, los alumnos son menores: el aviso del examen no reemplaza el consentimiento institucional (términos de uso del
                  colegio), que conviene resolver aparte.
                </p>
              </details>
            </div>
          )}
        </section>
      )}
      {verAjustes && (
        <>
      <div className="field">
        <label htmlFor="consigna">Instrucciones para los alumnos (opcional)</label>
        <textarea
          id="consigna"
          value={datos.consigna}
          placeholder="Ej: Podés usar calculadora. Tenés 90 minutos."
          onChange={(e) => onChange({ consigna: e.target.value })}
        />
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Si lo dejás vacío, los alumnos ven «{CONSIGNA_POR_DEFECTO}».
        </p>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="accordion-bar" style={{ marginTop: 0 }}>
          <button type="button" className="accordion-toggle" onClick={onToggleAjustes} aria-expanded={ajustesAbierto} aria-controls="como-se-rinde">
            <svg className="chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 2l4 4-4 4" />
            </svg>
            Cómo se rinde
            <span className={ajustesConError ? 'accordion-summary-error' : 'accordion-summary'}>· {resumenAjustes(datos)}</span>
          </button>
        </div>

        {ajustesAbierto && (
          <div id="como-se-rinde" style={{ marginTop: 16 }}>
          <div className="field">
            <label htmlFor="modalidad">¿Cómo lo rinden?</label>
            <select id="modalidad" value={datos.modalidad} onChange={(e) => onChange({ modalidad: e.target.value as ModalidadExamen })}>
              <option value="ventana_dias">Cuando quieran, dentro de un rango de días</option>
              <option value="sesion_tiempo">En una sola sesión, con tiempo límite</option>
            </select>
          </div>
          {datos.modalidad === 'sesion_tiempo' && (
            <div className="field">
              <label htmlFor="duracion">Cuánto tiempo tiene cada alumno (en minutos)</label>
              <input id="duracion" type="number" min="1" value={datos.duracionMinutos} onChange={(e) => onChange({ duracionMinutos: e.target.value })} />
            </div>
          )}
          <div className="field">
            <label htmlFor="feedbackModo">¿Cuándo ven su nota y sus comentarios?</label>
            <select id="feedbackModo" value={datos.feedbackModo} onChange={(e) => onChange({ feedbackModo: e.target.value as FeedbackModo })}>
              <option value="manual">Cuando yo los publique (recomendado)</option>
              <option value="inmediato">Apenas reviso cada respuesta</option>
            </select>
          </div>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="accordion-bar" style={{ marginTop: 0 }}>
          <button
            type="button"
            className="accordion-toggle"
            onClick={onToggleAvanzado}
            aria-expanded={avanzadoAbierto}
            aria-controls="opciones-avanzadas"
          >
            <svg className="chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 2l4 4-4 4" />
            </svg>
            Cómo corrige la IA
            <span className={avanzadoConError ? 'accordion-summary-error' : 'accordion-summary'}>
              · {resumenNiveles(niveles)} · {datos.distOn ? `esperás ${datos.aprobadosPct} % de aprobados` : 'sin expectativa de aprobados'}
            </span>
          </button>
        </div>

        {avanzadoAbierto && (
          <div id="opciones-avanzadas" style={{ marginTop: 16 }}>
            <div className="card-title" style={{ marginBottom: 8 }}>
              Qué tan exigente es la corrección
            </div>
            <p className="muted" style={{ marginBottom: 12, maxWidth: '68ch' }}>
              En cada criterio de una pregunta abierta, la IA elige uno de los niveles de desempeño que definas acá (de {MIN_NIVELES} a {MAX_NIVELES}); cada
              nivel da un porcentaje del puntaje de ese criterio.
            </p>

            <div className={estilos.controles}>
              <div className={`field ${estilos.cantidad}`} style={{ marginBottom: 0 }}>
                <label htmlFor="niveles-cantidad">Cantidad de niveles</label>
                <select id="niveles-cantidad" value={niveles.length} onChange={(e) => cambiarCantidad(Number(e.target.value))}>
                  {cantidades.map((c) => (
                    <option key={c} value={c}>
                      {c} niveles
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" className="btn btn-secondary" onClick={repartir}>
                Repartir porcentajes en partes iguales
              </button>
            </div>
            <p className={estilos.soloLectores} role="status" aria-live="polite">
              {anuncio}
            </p>

            <div className={estilos.barra} style={{ '--cantidad': niveles.length } as CSSProperties} role="list" aria-label="Escala de niveles de desempeño">
              {niveles.map((n) => (
                <div key={n.orden} className={estilos.segmento} role="listitem" style={{ borderTopColor: n.colorHex }}>
                  <span className={estilos.segmentoNombre}>{n.nombre.trim() || 'Sin nombre'}</span>
                  <span className={estilos.segmentoPct}>{n.porcentaje.trim() === '' ? '—' : `${n.porcentaje} %`}</span>
                </div>
              ))}
            </div>
            {nivelEjemplo && puntosEjemplo !== null && (
              <p className={`muted ${estilos.ejemplo}`}>
                Ejemplo: en un criterio de 2 pts, «{nivelEjemplo.nombre.trim() || `nivel ${nivelEjemplo.orden}`}» otorga {formatearPuntos(puntosEjemplo)}{' '}
                {puntosEjemplo === 1 ? 'pt' : 'pts'}. El color de cada nivel se asigna solo.
              </p>
            )}

            <div className={estilos.editor}>
              <span className={estilos.colTitulo} title="Número de nivel">N.º</span>
              <span className={estilos.colTitulo}>Nombre</span>
              <span className={estilos.colTitulo}>% del puntaje</span>
              <span aria-hidden="true" />
              {niveles.map((n, i) => {
                const pct = Number(n.porcentaje);
                const pctInvalido = n.porcentaje.trim() === '' || !Number.isFinite(pct) || pct < 0 || pct > 100;
                return (
                  <Fragment key={n.orden}>
                    <span className={estilos.orden}>{n.orden}</span>
                    <div className="field">
                      <input
                        id={`nivel-nombre-${i}`}
                        aria-label={`Nombre del nivel ${n.orden}`}
                        aria-invalid={!n.nombre.trim() || undefined}
                        value={n.nombre}
                        onChange={(e) => actualizarNivel(i, 'nombre', e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <div className={estilos.sufijo}>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="any"
                          aria-label={`Porcentaje del puntaje del nivel ${n.orden}`}
                          aria-invalid={pctInvalido || undefined}
                          value={n.porcentaje}
                          onChange={(e) => actualizarNivel(i, 'porcentaje', e.target.value)}
                        />
                        <span aria-hidden="true">%</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`btn btn-secondary ${estilos.quitar}`}
                      onClick={() => quitar(i)}
                      disabled={enMinimo}
                      aria-label={`Quitar el nivel ${n.orden}${n.nombre.trim() ? ` (${n.nombre.trim()})` : ''}`}
                      title={enMinimo ? `La escala necesita al menos ${MIN_NIVELES} niveles` : undefined}
                    >
                      <span className={estilos.quitarTexto}>Quitar</span>
                      <span className={estilos.quitarIcono} aria-hidden="true">
                        ✕
                      </span>
                    </button>
                  </Fragment>
                );
              })}
            </div>
            <div className={estilos.acciones}>
              <button type="button" className="btn btn-secondary" onClick={agregar} disabled={enMaximo}>
                + Agregar nivel
              </button>
              <span className="muted" style={{ fontSize: 13 }}>
                {enMaximo ? `Llegaste al máximo de ${MAX_NIVELES} niveles.` : `Entre ${MIN_NIVELES} y ${MAX_NIVELES} niveles; el último es el mejor.`}
              </span>
            </div>
            {erroresNiveles.length > 0 && (
              <div role="alert" style={{ marginTop: 12 }}>
                {erroresNiveles.map((m) => (
                  <p key={m} className="accordion-summary-error" style={{ fontSize: 13, margin: '0 0 4px' }}>
                    {m}
                  </p>
                ))}
              </div>
            )}

            <div className="hr" style={{ margin: '24px 0 16px' }} />

            <div className="card-title" style={{ marginBottom: 8 }}>
              Distribución esperada de aprobados (opcional)
            </div>
            <p className="muted" style={{ marginBottom: 12, maxWidth: '68ch' }}>
              Si ya sabés cuántos alumnos esperás que aprueben, cargalo acá. Cuando tengas respuestas corregidas por la IA, la vara
              parte de esta expectativa y te muestra qué ajuste haría falta, con vista previa y sin pisar la nota sugerida. Podés
              cambiarlo o ignorarlo después.
            </p>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <input type="checkbox" checked={datos.distOn} onChange={(e) => onChange({ distOn: e.target.checked })} />
              Definir una expectativa de aprobados
            </label>
            {datos.distOn && (
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div className="field" style={{ width: 220 }}>
                  <label htmlFor="umbral-aprob">Nota de aprobación</label>
                  <input id="umbral-aprob" type="number" step="any" value={datos.umbralAprobacion} onChange={(e) => onChange({ umbralAprobacion: e.target.value })} />
                </div>
                <div className="field" style={{ width: 220 }}>
                  <label htmlFor="pct-aprob">Aprobados esperados (%)</label>
                  <input id="pct-aprob" type="number" min="0" max="100" value={datos.aprobadosPct} onChange={(e) => onChange({ aprobadosPct: e.target.value })} />
                </div>
              </div>
            )}
            <div className="hr" style={{ margin: '24px 0 16px' }} />
            <div className="field" style={{ width: 220, marginBottom: 0 }}>
              <label htmlFor="escalaMin">Nota mínima de la escala</label>
              <input id="escalaMin" type="number" value={datos.escalaMin} onChange={(e) => onChange({ escalaMin: e.target.value })} />
              <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Casi siempre es 0. La nota se calcula como la suma de puntos: este valor solo acota el ajuste de vara.
              </p>
            </div>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}
