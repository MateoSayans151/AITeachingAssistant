'use client';

// PasoDatos: el paso 1 del wizard. Curso, título, consigna, modalidad, escala, feedback, señales de integridad y el bloque
// plegable "Opciones avanzadas" (escala de niveles de desempeño y distribución esperada de aprobados).
//
// Contrato:
//   PasoDatos({ datos, onChange, cursos, avanzadoAbierto, onToggleAvanzado })
//     datos             DatosForm completo (el estado vive en el padre).
//     onChange(patch)   se llama con los campos que cambiaron (Partial<DatosForm>); el padre los mezcla con `datos`.
//     cursos            cursos del docente, o null mientras se cargan (el select queda deshabilitado).
//     avanzadoAbierto   si "Opciones avanzadas" está desplegado (estado del padre: un error de validación lo vuelve a abrir).
//     onToggleAvanzado  el docente apretó el botón de "Opciones avanzadas".
//   Opcionales (solo si el padre quiere conservar el estado al volver al paso; si no se pasan, se guarda acá adentro):
//     personalizarNiveles / onPersonalizarNiveles(abierto)  editor de nombres y porcentajes de los niveles abierto o cerrado.

import { Fragment, useState } from 'react';
import type { Curso, FeedbackModo, ModalidadExamen } from '@/lib/api';
import { PRESETS_NIVELES, aplicarPreset, esNumero, formatearPuntos, presetDe, puntosDeEjemplo, resumenNiveles, validarDistribucion, validarNiveles } from '@/lib/examen-form';
import type { DatosForm, NivelForm } from '@/lib/examen-form';

export interface PasoDatosProps {
  datos: DatosForm;
  onChange: (patch: Partial<DatosForm>) => void;
  cursos: Curso[] | null;
  avanzadoAbierto: boolean;
  onToggleAvanzado: () => void;
  personalizarNiveles?: boolean;
  onPersonalizarNiveles?: (abierto: boolean) => void;
}

export function PasoDatos({ datos, onChange, cursos, avanzadoAbierto, onToggleAvanzado, personalizarNiveles, onPersonalizarNiveles }: PasoDatosProps) {
  const [personalizarLocal, setPersonalizarLocal] = useState(false); // muestra el editor de nombres y porcentajes
  const nivelesPersonalizar = personalizarNiveles ?? personalizarLocal;
  const setNivelesPersonalizar = (abierto: boolean) => (onPersonalizarNiveles ? onPersonalizarNiveles(abierto) : setPersonalizarLocal(abierto));

  const { niveles } = datos;

  function actualizarNivel(i: number, campo: keyof NivelForm, valor: string) {
    onChange({ niveles: niveles.map((n, idx) => (idx === i ? { ...n, [campo]: valor } : n)) });
  }

  /** Cambia el reparto de porcentajes a uno de los presets (conserva los nombres que el docente haya puesto). */
  function elegirPreset(id: string) {
    onChange({ niveles: aplicarPreset(niveles, id) });
  }

  // Escala de niveles (opciones avanzadas): preset activo, ejemplo en vivo y errores de las reglas.
  const presetActual = presetDe(niveles);
  const nivelEjemplo = niveles[2];
  const puntosEjemplo = nivelEjemplo ? puntosDeEjemplo(nivelEjemplo.porcentaje) : null;
  const erroresNiveles = validarNiveles(niveles);
  const avanzadoConError = erroresNiveles.length > 0 || validarDistribucion(datos).length > 0;

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
      <div className="card" style={{ marginBottom: 16 }}>
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
              En cada criterio de una pregunta abierta, la IA elige uno de 5 niveles de desempeño, y cada nivel da un porcentaje del
              puntaje de ese criterio. Los valores estándar sirven para la mayoría de los casos.
            </p>

            <div className="segmented" role="group" aria-label="Reparto del puntaje entre los niveles">
              {PRESETS_NIVELES.map((preset) => (
                <button key={preset.id} type="button" aria-pressed={presetActual === preset.id} onClick={() => elegirPreset(preset.id)}>
                  {preset.nombre}
                </button>
              ))}
              <button type="button" aria-pressed={presetActual === 'personalizado'} onClick={() => setNivelesPersonalizar(true)}>
                Personalizado
              </button>
            </div>

            <div className="niveles-barra" role="list" aria-label="Escala de niveles de desempeño">
              {niveles.map((n) => (
                <div key={n.orden} className="nivel-seg" role="listitem" style={{ borderTopColor: n.colorHex }}>
                  <span className="nivel-seg-nombre">{n.nombre.trim() || 'Sin nombre'}</span>
                  <span className="nivel-seg-pct">{n.porcentaje.trim() === '' ? '—' : `${n.porcentaje} %`}</span>
                </div>
              ))}
            </div>
            {nivelEjemplo && puntosEjemplo !== null && (
              <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>
                Ejemplo: en un criterio de 2 pts, «{nivelEjemplo.nombre.trim() || `nivel ${nivelEjemplo.orden}`}» otorga {formatearPuntos(puntosEjemplo)}{' '}
                {puntosEjemplo === 1 ? 'pt' : 'pts'}.
              </p>
            )}

            <button type="button" className="btn btn-ghost" onClick={() => setNivelesPersonalizar(!nivelesPersonalizar)} aria-expanded={nivelesPersonalizar}>
              {nivelesPersonalizar ? 'Ocultar nombres y porcentajes' : 'Personalizar nombres y porcentajes'}
            </button>

            {nivelesPersonalizar && (
              <div className="niveles-editor">
                <span className="col-titulo">Nivel</span>
                <span className="col-titulo">Nombre</span>
                <span className="col-titulo">% del puntaje</span>
                {niveles.map((n, i) => {
                  const pct = Number(n.porcentaje);
                  const pctInvalido = n.porcentaje.trim() === '' || !Number.isFinite(pct) || pct < 0 || pct > 100;
                  return (
                    <Fragment key={n.orden}>
                      <span className="nivel-orden">{n.orden}</span>
                      <div className="field">
                        <input
                          aria-label={`Nombre del nivel ${n.orden}`}
                          aria-invalid={!n.nombre.trim() || undefined}
                          value={n.nombre}
                          onChange={(e) => actualizarNivel(i, 'nombre', e.target.value)}
                        />
                      </div>
                      <div className="field">
                        <div className="input-sufijo">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            aria-label={`Porcentaje del puntaje del nivel ${n.orden}`}
                            aria-invalid={pctInvalido || undefined}
                            value={n.porcentaje}
                            onChange={(e) => actualizarNivel(i, 'porcentaje', e.target.value)}
                          />
                          <span aria-hidden="true">%</span>
                        </div>
                      </div>
                    </Fragment>
                  );
                })}
              </div>
            )}
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
