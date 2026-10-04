'use client';

// PreguntaCard: UNA pregunta del examen, plegable. Desplegada: selector de tipo (agrupado), enunciado, puntos de la pregunta
// (para todos los tipos), y el cuerpo según el tipo: opciones (opción múltiple / casillas), verdadero o falso, numérica,
// relacionar pares y, para las abiertas, la rúbrica (<RubricaEditor/>). Plegada (`pregunta.plegada`): UNA fila con el número,
// el tipo, si se corrige sola o la corrige la IA, el enunciado resumido, los puntos y "Editar"; si está incompleta, la fila
// lo marca ("Falta completar"). No tiene estado propio: edita la pregunta que le pasan y plegar/desplegar es `plegada`.
//
// Contrato:
//   PreguntaCard({ indice, pregunta, onChange, onQuitar, cantidadPreguntas, niveles, matrices, onMover, onDuplicar, esPrimera,
//                  esUltima, onMatrizCreada, onAplicarATodas, errores })
//     indice             posición de la pregunta, base 0 (se muestra como "indice + 1." y nombra el grupo de radios).
//     pregunta           PreguntaForm.
//     onChange(p)        se llama con la pregunta completa ya modificada (el padre la reemplaza en su lista), también al plegar.
//     onQuitar()         el docente apretó "Quitar pregunta".
//     cantidadPreguntas  cuántas preguntas hay en total: con una sola, "Quitar pregunta" queda deshabilitado.
//     niveles            escala de niveles del examen (`datos.niveles`): la usan las preguntas abiertas para sus criterios.
//     matrices           matrices de rúbrica del docente (se pasan a <RubricaEditor/>).
//   Opcionales:
//     onMover(delta)     "Subir" (-1) / "Bajar" (1). Sin esta prop no se muestran los botones de mover.
//     onDuplicar()       "Duplicar". Sin esta prop no se muestra el botón.
//     esPrimera/esUltima deshabilitan "Subir" / "Bajar" en los extremos (por defecto se deducen de `indice` y `cantidadPreguntas`).
//     onMatrizCreada(m)  se pasa a <RubricaEditor/>: el editor la llama cuando el docente guarda una rúbrica como matriz.
//     onAplicarATodas()  se pasa a <RubricaEditor/>: "usar esta rúbrica en todas las preguntas abiertas".
//     errores            mensajes de validación de ESTA pregunta para mostrar arriba del cuerpo (los calcula PasoPreguntas).
//
// Para que PasoPreguntas lleve el foco y el scroll, la tarjeta se identifica con `data-pregunta-indice` y sus botones con
// `data-accion` ("subir", "bajar", "duplicar", "alternar"); el enunciado con `data-campo="enunciado"`.

import { useEffect, useRef } from 'react';
import type { MatrizRubrica, TipoPregunta } from '@/lib/api';
import { TIPOS_AUTOCORREGIBLES } from '@/lib/api';
import { preguntaVacia, validarPregunta } from '@/lib/examen-form';
import type { NivelForm, PreguntaForm } from '@/lib/examen-form';
import { etiquetaPuntos, resumenEnunciado } from '@/lib/examen-preguntas';
import { RubricaEditor } from './RubricaEditor';
import s from './PreguntaCard.module.css';

export const TIPOS_LABEL: Record<TipoPregunta, string> = {
  desarrollo: 'Desarrollo',
  resolucion_problema: 'Resolución de problema / cálculo',
  demostracion: 'Demostración',
  analisis_caso: 'Análisis de caso',
  respuesta_corta: 'Respuesta corta',
  numerica: 'Numérica',
  relacionar_pares: 'Relacionar pares',
  opcion_multiple: 'Opción múltiple',
  casillas: 'Casillas (varias correctas)',
  verdadero_falso: 'Verdadero / Falso',
};

export interface TipoGrupo {
  id: 'se-corrigen-solas' | 'las-corrige-la-ia';
  titulo: string;
  tipos: { tipo: TipoPregunta; descripcion: string }[];
}

/** Los tipos de pregunta en dos grupos, con una descripción de una línea de cada uno: los usan el menú "+ Agregar pregunta" y el selector de la tarjeta. */
export const TIPOS_GRUPOS: TipoGrupo[] = [
  {
    id: 'se-corrigen-solas',
    titulo: 'Se corrigen solas',
    tipos: [
      { tipo: 'opcion_multiple', descripcion: 'Una sola opción correcta.' },
      { tipo: 'casillas', descripcion: 'Varias opciones pueden ser correctas.' },
      { tipo: 'verdadero_falso', descripcion: 'El alumno marca verdadero o falso.' },
      { tipo: 'numerica', descripcion: 'Un número, con tolerancia opcional.' },
      { tipo: 'relacionar_pares', descripcion: 'Unir elementos de dos columnas.' },
    ],
  },
  {
    id: 'las-corrige-la-ia',
    titulo: 'Las corrige la IA',
    tipos: [
      { tipo: 'desarrollo', descripcion: 'Respuesta extensa, evaluada con rúbrica.' },
      { tipo: 'resolucion_problema', descripcion: 'Plantear y calcular, paso a paso.' },
      { tipo: 'demostracion', descripcion: 'Justificar un resultado con rigor.' },
      { tipo: 'analisis_caso', descripcion: 'Analizar una situación y fundamentar.' },
      { tipo: 'respuesta_corta', descripcion: 'Una o dos oraciones.' },
    ],
  },
];

export interface PreguntaCardProps {
  indice: number;
  pregunta: PreguntaForm;
  onChange: (p: PreguntaForm) => void;
  onQuitar: () => void;
  cantidadPreguntas: number;
  niveles: NivelForm[];
  matrices: MatrizRubrica[];
  onMover?: (delta: -1 | 1) => void;
  onDuplicar?: () => void;
  esPrimera?: boolean;
  esUltima?: boolean;
  onMatrizCreada?: (m: MatrizRubrica) => void;
  onAplicarATodas?: () => void;
  errores?: string[];
}

// Íconos de los botones (decorativos: el nombre lo da el aria-label del botón).
const iconoProps = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const;
const IconoSubir = () => (
  <svg {...iconoProps}>
    <path d="M3 10l5-5 5 5" />
  </svg>
);
const IconoBajar = () => (
  <svg {...iconoProps}>
    <path d="M3 6l5 5 5-5" />
  </svg>
);
const IconoDuplicar = () => (
  <svg {...iconoProps}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 3.5v-.5a1 1 0 0 0-1-1H3.5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" />
  </svg>
);
const IconoAlerta = () => (
  <svg {...iconoProps}>
    <path d="M8 2.2l6 10.6H2L8 2.2z" />
    <path d="M8 6.5v3M8 11.6v.1" />
  </svg>
);

export function PreguntaCard({
  indice,
  pregunta: p,
  onChange,
  onQuitar,
  cantidadPreguntas,
  niveles,
  matrices,
  onMover,
  onDuplicar,
  esPrimera = indice === 0,
  esUltima = indice === cantidadPreguntas - 1,
  onMatrizCreada,
  onAplicarATodas,
  errores,
}: PreguntaCardProps) {
  const cerrada = TIPOS_AUTOCORREGIBLES.includes(p.tipo);
  const numero = indice + 1;
  const raiz = useRef<HTMLDivElement>(null);
  const devolverFoco = useRef(false);

  // El botón "Editar"/"Plegar" cambia de lugar al plegar o desplegar: apenas se redibuja se le devuelve el foco al nuevo botón.
  useEffect(() => {
    if (!devolverFoco.current) return;
    devolverFoco.current = false;
    raiz.current?.querySelector<HTMLElement>('[data-accion="alternar"]')?.focus({ preventScroll: true });
  });

  function actualizar<K extends keyof PreguntaForm>(campo: K, valor: PreguntaForm[K]) {
    onChange({ ...p, [campo]: valor });
  }

  function alternarPlegada() {
    devolverFoco.current = true;
    onChange({ ...p, plegada: !p.plegada });
  }

  function cambiarTipo(tipo: TipoPregunta) {
    // Al cambiar de tipo se parte de una pregunta vacía y se conserva solo lo común: enunciado y puntos (y si está plegada).
    onChange({ ...preguntaVacia(niveles), tipo, enunciado: p.enunciado, puntajeMaximo: p.puntajeMaximo, plegada: p.plegada });
  }

  function actualizarChoice(oi: number, campo: 'texto' | 'correcta', valor: string | boolean) {
    onChange({
      ...p,
      opcionesChoice: p.opcionesChoice.map((o, oIdx) => {
        if (oIdx !== oi) {
          // opción múltiple: una sola correcta a la vez
          return campo === 'correcta' && valor === true && p.tipo === 'opcion_multiple' ? { ...o, correcta: false } : o;
        }
        return { ...o, [campo]: valor };
      }),
    });
  }

  function agregarChoice() {
    onChange({ ...p, opcionesChoice: [...p.opcionesChoice, { id: String.fromCharCode(97 + p.opcionesChoice.length), texto: '', correcta: false }] });
  }

  function actualizarPar(lado: 'paresIzquierda' | 'paresDerecha', i: number, valor: string) {
    onChange({ ...p, [lado]: p[lado].map((v, vi) => (vi === i ? valor : v)) });
  }

  function agregarPar() {
    onChange({ ...p, paresIzquierda: [...p.paresIzquierda, ''], paresDerecha: [...p.paresDerecha, ''] });
  }

  // Subir, Bajar y Duplicar: en la fila plegada son solo ícono; en la cabecera de la tarjeta desplegada llevan también el texto.
  const botonesMoverYDuplicar = (
    <>
      {onMover && (
        <>
          <button type="button" className={`btn btn-secondary ${s.btnAccion}`} data-accion="subir" onClick={() => onMover(-1)} disabled={esPrimera} aria-label={`Subir la pregunta ${numero}`} title="Subir">
            <IconoSubir />
            <span className={s.btnTexto}>Subir</span>
          </button>
          <button type="button" className={`btn btn-secondary ${s.btnAccion}`} data-accion="bajar" onClick={() => onMover(1)} disabled={esUltima} aria-label={`Bajar la pregunta ${numero}`} title="Bajar">
            <IconoBajar />
            <span className={s.btnTexto}>Bajar</span>
          </button>
        </>
      )}
      {onDuplicar && (
        <button type="button" className={`btn btn-secondary ${s.btnAccion}`} data-accion="duplicar" onClick={onDuplicar} aria-label={`Duplicar la pregunta ${numero}`} title="Duplicar">
          <IconoDuplicar />
          <span className={s.btnTexto}>Duplicar</span>
        </button>
      )}
    </>
  );

  const claseTarjeta = `card ${s.tarjeta}${errores && errores.length > 0 ? ' card-invalid' : ''}`;

  // ---------------------------------------------------------------- plegada: una sola fila
  if (p.plegada) {
    const faltan = validarPregunta(p, indice);
    const resumen = resumenEnunciado(p.enunciado);
    const puntos = etiquetaPuntos(p);
    return (
      <div ref={raiz} role="group" aria-label={`Pregunta ${numero}`} tabIndex={-1} data-pregunta-indice={indice} className={`${claseTarjeta} ${s.plegada}`}>
        <div className={s.fila}>
          <div className={s.meta}>
            <strong className={s.numero}>{numero}.</strong>
            <span className={s.tipo}>{TIPOS_LABEL[p.tipo]}</span>
            <span className={`tag ${cerrada ? 'tag-neutral' : 'tag-accent'}`}>{cerrada ? 'Se corrige sola' : 'La corrige la IA'}</span>
            {faltan.length > 0 && (
              <span className={s.falta} title={faltan.join('\n')}>
                <IconoAlerta />
                Falta completar
              </span>
            )}
          </div>
          <div className={s.resumen} title={resumen || undefined}>
            {resumen || <span className={s.sinEnunciado}>(sin enunciado)</span>}
          </div>
          <span className={`${s.puntos}${puntos === 'sin puntos' ? ` ${s.sinPuntos}` : ''}`}>{puntos}</span>
          <div className={`${s.acciones} ${s.soloIconos}`}>
            {botonesMoverYDuplicar}
            <button type="button" className={`btn btn-secondary ${s.btnAccion}`} data-accion="alternar" onClick={alternarPlegada} aria-expanded={false} aria-label={`Editar la pregunta ${numero}`}>
              Editar
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- desplegada
  return (
    <div ref={raiz} role="group" aria-label={`Pregunta ${numero}`} tabIndex={-1} data-pregunta-indice={indice} className={claseTarjeta}>
      <div className={s.cabecera}>
        <strong className={s.numero}>{numero}.</strong>
        <select className={s.tipoSelect} aria-label={`Tipo de la pregunta ${numero}`} value={p.tipo} onChange={(e) => cambiarTipo(e.target.value as TipoPregunta)}>
          {TIPOS_GRUPOS.map((g) => (
            <optgroup key={g.id} label={g.titulo}>
              {g.tipos.map(({ tipo }) => (
                <option key={tipo} value={tipo}>
                  {TIPOS_LABEL[tipo]}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <div className={s.acciones}>
          {botonesMoverYDuplicar}
          <button type="button" className={`btn btn-secondary ${s.btnAccion}`} data-accion="alternar" onClick={alternarPlegada} aria-expanded={true} aria-label={`Plegar la pregunta ${numero}`}>
            Plegar
          </button>
          <button type="button" className={`btn btn-secondary ${s.btnAccion}`} onClick={onQuitar} disabled={cantidadPreguntas === 1}>
            Quitar pregunta
          </button>
        </div>
      </div>

      {errores && errores.length > 0 && (
        <div className="error-box" role="alert">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {errores.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="field">
        <label htmlFor={`pregunta-${indice}-enunciado`}>Enunciado</label>
        <textarea id={`pregunta-${indice}-enunciado`} data-campo="enunciado" value={p.enunciado} onChange={(e) => actualizar('enunciado', e.target.value)} />
      </div>

      <div className="field" style={{ maxWidth: 160 }}>
        <label htmlFor={`pregunta-${indice}-puntaje`}>Puntaje máximo</label>
        <input id={`pregunta-${indice}-puntaje`} type="number" min="0.5" step="any" value={p.puntajeMaximo} onChange={(e) => actualizar('puntajeMaximo', e.target.value)} />
      </div>

      {!cerrada && (
        <RubricaEditor
          pregunta={p}
          onChange={onChange}
          niveles={niveles}
          matrices={matrices}
          // TODO(integración): RubricaEditor todavía no declara estas props (las agrega otro agente): se pasan con un cast mínimo
          // para que compile sin ellas. Cuando estén en `RubricaEditorProps`, pasarlas directo y borrar el cast.
          {...({ onMatrizCreada, onAplicarATodas } as object)}
        />
      )}

      {(p.tipo === 'opcion_multiple' || p.tipo === 'casillas') && (
        <div>
          {p.opcionesChoice.map((o, oi) => (
            <div key={oi} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
              <input
                type={p.tipo === 'opcion_multiple' ? 'radio' : 'checkbox'}
                name={`correcta-${indice}`}
                checked={o.correcta}
                onChange={(e) => actualizarChoice(oi, 'correcta', e.target.checked)}
              />
              <input placeholder={`Opción ${o.id}`} value={o.texto} onChange={(e) => actualizarChoice(oi, 'texto', e.target.value)} />
            </div>
          ))}
          <button type="button" className="btn btn-secondary" onClick={agregarChoice}>
            + Agregar opción
          </button>
        </div>
      )}

      {p.tipo === 'verdadero_falso' && (
        <div className="field" style={{ maxWidth: 200 }}>
          <label>Respuesta correcta</label>
          <select value={p.vfCorrecta} onChange={(e) => actualizar('vfCorrecta', e.target.value as 'true' | 'false')}>
            <option value="true">Verdadero</option>
            <option value="false">Falso</option>
          </select>
        </div>
      )}

      {p.tipo === 'numerica' && (
        <div style={{ display: 'flex', gap: 16 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Respuesta correcta</label>
            <input type="number" value={p.numRespuestaCorrecta} onChange={(e) => actualizar('numRespuestaCorrecta', e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Tolerancia (+/-)</label>
            <input type="number" min="0" value={p.numTolerancia} onChange={(e) => actualizar('numTolerancia', e.target.value)} />
          </div>
        </div>
      )}

      {p.tipo === 'relacionar_pares' && (
        <div>
          {p.paresIzquierda.map((izq, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
              <input placeholder="Elemento A" value={izq} onChange={(e) => actualizarPar('paresIzquierda', i, e.target.value)} />
              <input placeholder="Corresponde con…" value={p.paresDerecha[i]} onChange={(e) => actualizarPar('paresDerecha', i, e.target.value)} />
            </div>
          ))}
          <button type="button" className="btn btn-secondary" onClick={agregarPar}>
            + Agregar par
          </button>
        </div>
      )}
    </div>
  );
}
