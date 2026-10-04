'use client';

// PasoDatos: el paso 1 del wizard. Lo obligatorio está siempre a la vista (curso, título, consigna) y el resto va en dos bloques
// plegables, porque casi siempre alcanza con los valores por defecto (un "modo rápido"): "Cómo se rinde" (modalidad y duración,
// escala, liberación del feedback, señales de integridad) y "Opciones avanzadas" (escala de niveles de desempeño y distribución
// esperada de aprobados). Cada bloque muestra un resumen de lo configurado y un error de validación lo vuelve a abrir.
//
// La escala de niveles es SIEMPRE el editor personalizado: de 3 a 7 niveles (5 por defecto), con nombre y porcentaje editables,
// "Quitar" por fila, "+ Agregar nivel", "Cantidad de niveles" y "Repartir porcentajes en partes iguales". El color de cada nivel
// no se elige: se calcula por posición (rojo a verde, `colorDeNivel`). Las operaciones sobre la escala son funciones puras de
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
//     avanzadoAbierto   si "Opciones avanzadas" está desplegado (estado del padre: un error de validación lo vuelve a abrir).
//     onToggleAvanzado  el docente apretó el botón de "Opciones avanzadas".

import { Fragment, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Curso, FeedbackModo, ModalidadExamen } from '@/lib/api';
import {
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
  datos: DatosForm;
  onChange: (patch: Partial<DatosForm>) => void;
  cursos: Curso[] | null;
  ajustesAbierto: boolean;
  onToggleAjustes: () => void;
  avanzadoAbierto: boolean;
  onToggleAvanzado: () => void;
}

export function PasoDatos({ datos, onChange, cursos, ajustesAbierto, onToggleAjustes, avanzadoAbierto, onToggleAvanzado }: PasoDatosProps) {
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
      <div className="field">
        <label htmlFor="curso">Curso</label>
        <select id="curso" value={datos.cursoElegido} onChange={(e) => onChange({ cursoElegido: e.target.value })} disabled={cursos === null}>
          {(cursos ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
          <option value="nuevo">+ Crear un curso nuevo…</option>
        </select>
      </div>
      {datos.cursoElegido === 'nuevo' && (
        <div className="field">
          <label htmlFor="cursoNuevo">Nombre del curso nuevo</label>
          <input id="cursoNuevo" value={datos.cursoNuevoNombre} onChange={(e) => onChange({ cursoNuevoNombre: e.target.value })} placeholder="Ej: Datos II - Lunes tarde" />
        </div>
      )}
      <div className="field">
        <label htmlFor="titulo">Título del examen</label>
        <input id="titulo" value={datos.titulo} onChange={(e) => onChange({ titulo: e.target.value })} required />
      </div>
      <div className="field">
        <label htmlFor="consigna">Consigna / instrucciones generales</label>
        <textarea id="consigna" value={datos.consigna} onChange={(e) => onChange({ consigna: e.target.value })} required />
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
            <label htmlFor="modalidad">Modalidad</label>
            <select id="modalidad" value={datos.modalidad} onChange={(e) => onChange({ modalidad: e.target.value as ModalidadExamen })}>
              <option value="ventana_dias">Ventana de varios días (el alumno entra cuando quiere dentro del rango)</option>
              <option value="sesion_tiempo">Sesión con tiempo límite</option>
            </select>
          </div>
          {datos.modalidad === 'sesion_tiempo' && (
            <div className="field">
              <label htmlFor="duracion">Duración (minutos)</label>
              <input id="duracion" type="number" min="1" value={datos.duracionMinutos} onChange={(e) => onChange({ duracionMinutos: e.target.value })} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 16 }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="escalaMin">Escala mínima</label>
              <input id="escalaMin" type="number" value={datos.escalaMin} onChange={(e) => onChange({ escalaMin: e.target.value })} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="escalaMax">Escala máxima</label>
              <input id="escalaMax" type="number" value={datos.escalaMax} onChange={(e) => onChange({ escalaMax: e.target.value })} />
            </div>
          </div>
          <p className="muted" style={{ fontSize: 13, margin: '-6px 0 16px' }}>
            El total de puntos de las preguntas tiene que sumar la escala máxima.
            {esNumero(datos.escalaMin) && Number(datos.escalaMin) !== 0 && (
              <>
                <br />
                La nota se calcula como la suma de puntos (de 0 al total): la escala mínima solo se usa para acotar el ajuste de vara.
              </>
            )}
          </p>
          <div className="field">
            <label htmlFor="feedbackModo">Liberación de feedback</label>
            <select id="feedbackModo" value={datos.feedbackModo} onChange={(e) => onChange({ feedbackModo: e.target.value as FeedbackModo })}>
              <option value="manual">Manual (el docente libera el feedback cuando quiere)</option>
              <option value="inmediato">Inmediato (apenas el docente termina de revisar cada respuesta)</option>
            </select>
          </div>
          <div style={{ marginBottom: 4 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
              <input type="checkbox" checked={datos.antiCheatOn} onChange={(e) => onChange({ antiCheatOn: e.target.checked })} />
              Registrar señales de integridad durante el examen
            </label>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              Solo se registran eventos (no se bloquea nada ni se baja la nota): vos los ves junto a cada respuesta y decidís. Antes de
              empezar, el alumno ve exactamente qué se monitorea y tiene que aceptarlo.
            </p>
            {datos.antiCheatOn && (
              <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                <label style={{ display: 'flex', gap: 8 }}>
                  <input type="checkbox" checked={datos.acPantalla} onChange={(e) => onChange({ acPantalla: e.target.checked })} />
                  Pantalla completa: registra cada vez que el alumno sale de ella
                </label>
                <label style={{ display: 'flex', gap: 8 }}>
                  <input type="checkbox" checked={datos.acPestana} onChange={(e) => onChange({ acPestana: e.target.checked })} />
                  Cambio de pestaña o ventana
                </label>
                <label style={{ display: 'flex', gap: 8 }}>
                  <input type="checkbox" checked={datos.acPegado} onChange={(e) => onChange({ acPegado: e.target.checked })} />
                  Pegado de texto en las respuestas
                </label>
                {!datos.acPantalla && !datos.acPestana && !datos.acPegado && <p className="muted">Sin ningún control marcado, el examen se rinde sin monitoreo.</p>}
                {datos.modalidad === 'ventana_dias' && (
                  <p className="muted">
                    Ojo: en una ventana de varios días el alumno rinde desde su casa, y estos controles dicen poco. Suelen tener más
                    sentido en una sesión con tiempo límite.
                  </p>
                )}
                <p className="muted">
                  En secundaria, los alumnos son menores: el aviso del examen no reemplaza el consentimiento institucional (términos de uso
                  del colegio), que conviene resolver aparte.
                </p>
              </div>
            )}
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
            Opciones avanzadas
            <span className={avanzadoConError ? 'accordion-summary-error' : 'accordion-summary'}>
              · Exigencia: {resumenNiveles(niveles)} · {datos.distOn ? `esperás ${datos.aprobadosPct} % de aprobados` : 'sin expectativa de aprobados'}
            </span>
          </button>
        </div>

        {avanzadoAbierto && (
          <div id="opciones-avanzadas" style={{ marginTop: 16 }}>
            <div className="card-title" style={{ marginBottom: 6 }}>
              Nivel de exigencia de la corrección
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
                {puntosEjemplo === 1 ? 'pt' : 'pts'}. Los colores se asignan solos, de rojo a verde.
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

            <div className="card-title" style={{ marginBottom: 6 }}>
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
          </div>
        )}
      </div>
    </div>
  );
}
