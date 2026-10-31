'use client';

// RubricaEditor: los criterios de UNA pregunta abierta (desarrollo, resolución de problema, demostración, análisis de caso y
// respuesta corta). Son OPCIONALES: la sección arranca plegada y de bajo perfil («Criterios de corrección · opcional»); sin
// criterios la IA evalúa la respuesta en conjunto contra el enunciado (el servidor le pone un único criterio general). Desplegada
// tiene "Sugerir con IA", el selector de matrices, una fila por criterio con el detalle de cada nivel de desempeño en un acordeón
// plegado, y al pie: guardar los criterios como matriz y (si el padre lo pide) copiar la rúbrica a las demás preguntas abiertas. Los datos viven en la pregunta que le pasan; el estado propio es solo
// de interfaz (qué acordeones están abiertos, el pedido a la IA, el mini formulario de la matriz).
//
// Contrato:
//   RubricaEditor({ pregunta, onChange, niveles, matrices, onMatrizCreada?, onAplicarATodas?, errores? })
//     pregunta   PreguntaForm (abierta). Los puntos de la pregunta están en `pregunta.puntajeMaximo` y se reparten entre los
//                criterios según su `peso` (`puntosPorCriterio`): acá solo se MUESTRA lo que le toca a cada uno.
//     onChange   se llama con la pregunta completa ya modificada (criterios nuevos, quitados, editados, matriz o sugerencia aplicada).
//     niveles    escala de niveles del examen (`datos.niveles`): se usa para armar un criterio nuevo y para decidir si el detalle
//                de una matriz o de la IA se puede usar (tiene que traer tantas descripciones como niveles tiene la escala).
//     matrices   matrices de rúbrica del docente (puede ser []: el selector se muestra igual, deshabilitado y con una pista).
//     onMatrizCreada?  NUEVO, opcional. El docente guardó los criterios como matriz: se llama con la matriz creada para que el
//                padre la sume a su lista (así aparece en el selector de todas las preguntas).
//     onAplicarATodas? NUEVO, opcional. Si viene, aparece "Usar esta rúbrica en todas las preguntas abiertas" y se llama sin
//                argumentos al apretarlo: el reparto a las demás preguntas lo hace el padre (la rúbrica de ESTA pregunta es la que
//                recibió en `pregunta`). Sin esta prop el botón no se muestra.
//     errores?   NUEVO, opcional. Los errores de validación vigentes del formulario (el mismo array que el padre muestra):
//                cada vez que llega uno nuevo y no vacío, los criterios con el detalle por nivel a medias se abren solos. Sin
//                esta prop siguen plegados, pero su resumen se ve en rojo ("3 de 5 niveles descritos").

import { useEffect, useId, useRef, useState } from 'react';
import AutoTextarea from '@/app/components/AutoTextarea';
import { useConfirmar } from '@/app/components/Confirmar';
import type { MatrizRubrica } from '@/lib/api';
import { createMatrizRubrica, sugerirCriterios } from '@/lib/api';
import {
  aplicarMatriz,
  criterioVacio,
  criteriosDeSugerencia,
  criteriosParaMatriz,
  estadoDetalle,
  formatearPuntos,
  mensajeErrorMatriz,
  mensajeErrorSugerencia,
  pesoValidoDe,
  puntajeEfectivoDe,
  puntosPorCriterio,
  resumenDetalle,
  tieneCriteriosCargados,
} from '@/lib/examen-form';
import type { CriterioForm, NivelForm, PreguntaForm } from '@/lib/examen-form';
import styles from './RubricaEditor.module.css';

export interface RubricaEditorProps {
  pregunta: PreguntaForm;
  onChange: (p: PreguntaForm) => void;
  niveles: NivelForm[];
  matrices: MatrizRubrica[];
  onMatrizCreada?: (m: MatrizRubrica) => void;
  onAplicarATodas?: () => void;
  errores?: readonly string[];
}

/** Valor de la última opción del selector ("+ Crear una matriz nueva"): no es una matriz, abre otra pestaña. */
const VALOR_MATRIZ_NUEVA = '__matriz_nueva__';

type EstadoIA =
  | { estado: 'libre' | 'pensando' }
  | { estado: 'borrador'; detalleOmitido: boolean } // detalleOmitido: la IA mandó el detalle por nivel pero no coincide con la escala del examen
  | { estado: 'error'; mensaje: string };

const SIN_ENUNCIADO = 'Escribí primero el enunciado de la pregunta: la IA sugiere los criterios a partir de él.';
const SIN_CRITERIOS_LISTOS = 'Completá el nombre, qué se espera y el peso de cada criterio para poder guardarlos como matriz.';

export function RubricaEditor({ pregunta: p, onChange, niveles, matrices, onMatrizCreada, onAplicarATodas, errores }: RubricaEditorProps) {
  const confirmar = useConfirmar();
  const uid = useId();
  const puntos = puntosPorCriterio(p);
  const hayPuntos = puntajeEfectivoDe(p) > 0;
  const sumaPesos = p.criterios.reduce((acc, c) => acc + pesoValidoDe(c), 0);

  // Los pedidos asíncronos (IA, guardar matriz) terminan después de varios renders: tienen que trabajar con lo último, no con
  // la pregunta ni el onChange de cuando se apretó el botón (el padre arma la lista nueva a partir de la suya de ese render).
  const preguntaRef = useRef(p);
  const onChangeRef = useRef(onChange);
  const onMatrizCreadaRef = useRef(onMatrizCreada);
  const montado = useRef(true);
  preguntaRef.current = p;
  onChangeRef.current = onChange;
  onMatrizCreadaRef.current = onMatrizCreada;
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  // La sección entera arranca desplegada: los criterios son lo que le dice a la IA cómo corregir como corregirías vos.
  const [abierta, setAbierta] = useState(true);
  const idSeccion = `${uid}-criterios`;

  // Acordeones abiertos, por posición del criterio (todos plegados al empezar).
  const [abiertos, setAbiertos] = useState<Record<number, boolean>>({});
  const [matrizElegida, setMatrizElegida] = useState('');
  const [ia, setIa] = useState<EstadoIA>({ estado: 'libre' });
  const [formAbierto, setFormAbierto] = useState(false);
  const [nombreMatriz, setNombreMatriz] = useState('');
  const [descripcionMatriz, setDescripcionMatriz] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [errorMatriz, setErrorMatriz] = useState<string | null>(null);
  const [matrizGuardada, setMatrizGuardada] = useState<string | null>(null);

  // Si falla la validación del formulario, los detalles a medias se abren para que se vea qué falta (y la sección, si tiene algo cargado).
  useEffect(() => {
    if (!errores || errores.length === 0) return;
    if (tieneCriteriosCargados(preguntaRef.current)) setAbierta(true);
    setAbiertos((prev) => {
      const sig = { ...prev };
      preguntaRef.current.criterios.forEach((c, i) => {
        if (estadoDetalle(c).incompleto) sig[i] = true;
      });
      return sig;
    });
  }, [errores]);

  const criteriosMatriz = criteriosParaMatriz(p, niveles);
  const hayEnunciado = p.enunciado.trim() !== '';
  const pensando = ia.estado === 'pensando';

  function cambiarCriterio(ci: number, cambio: (c: CriterioForm) => CriterioForm) {
    onChange({ ...p, criterios: p.criterios.map((c, i) => (i === ci ? cambio(c) : c)) });
  }

  function actualizarCriterio(ci: number, campo: 'nombre' | 'descripcion' | 'peso', valor: string) {
    cambiarCriterio(ci, (c) => ({ ...c, [campo]: valor }));
  }

  function actualizarNivelCriterio(ci: number, ni: number, descripcion: string) {
    cambiarCriterio(ci, (c) => {
      const nuevos = c.niveles.map((n, nIdx) => (nIdx === ni ? { ...n, descripcion } : n));
      return { ...c, niveles: nuevos, detallar: nuevos.length > 0 && nuevos.every((n) => n.descripcion.trim() !== '') };
    });
  }

  function alternarDetalle(ci: number) {
    setAbiertos((prev) => ({ ...prev, [ci]: !prev[ci] }));
  }

  function agregarCriterio() {
    // Si lo único que hay son filas en blanco (el wizard arranca con una) no se suma otra: se usa esa.
    const soloBlancos = p.criterios.length > 0 && !tieneCriteriosCargados(p);
    if (soloBlancos) return;
    onChange({ ...p, criterios: [...p.criterios, criterioVacio(niveles)] });
  }

  function quitarCriterio(ci: number) {
    onChange({ ...p, criterios: p.criterios.filter((_, i) => i !== ci) });
    // Los de abajo suben una posición: su acordeón los acompaña.
    setAbiertos((prev) => {
      const sig: Record<number, boolean> = {};
      Object.entries(prev).forEach(([k, v]) => {
        const i = Number(k);
        if (i < ci) sig[i] = v;
        else if (i > ci) sig[i - 1] = v;
      });
      return sig;
    });
  }

  function elegirMatriz(valor: string) {
    if (valor === VALOR_MATRIZ_NUEVA) {
      // Se arma en otra pestaña para no perder lo cargado en el examen; la selección actual no cambia.
      window.open('/matrices/nueva', '_blank', 'noopener');
      return;
    }
    const matriz = matrices.find((m) => m.id === valor);
    setMatrizElegida(matriz ? matriz.id : '');
    if (!matriz) return;
    setAbiertos({});
    setIa({ estado: 'libre' });
    onChange(aplicarMatriz(p, matriz, niveles));
  }

  async function sugerirConIA() {
    const actual = preguntaRef.current;
    if (!actual.enunciado.trim() || pensando) return;
    if (tieneCriteriosCargados(actual) && !(await confirmar({ mensaje: 'Esto reemplaza los criterios actuales.', textoConfirmar: 'Reemplazar' }))) return;
    setIa({ estado: 'pensando' });
    try {
      // La IA describe tantos niveles como tiene la escala del examen (3 a 7), así el detalle por nivel queda utilizable.
      const cantidadNiveles = niveles.length >= 3 && niveles.length <= 7 ? niveles.length : undefined;
      const { criterios } = await sugerirCriterios({ enunciado: actual.enunciado, tipo: actual.tipo, cantidadNiveles });
      if (!montado.current) return;
      if (criterios.length === 0) throw new Error('sin criterios');
      // Si mientras esperaba cambió el tipo de pregunta, la sugerencia ya no corresponde.
      if (preguntaRef.current.tipo !== actual.tipo) {
        setIa({ estado: 'libre' });
        return;
      }
      // Los puntos de la pregunta no se tocan: sin puntos todavía, el "= X pts" aparece apenas el docente cargue P.
      const sugeridos = criteriosDeSugerencia(criterios, niveles);
      onChangeRef.current({ ...preguntaRef.current, criterios: sugeridos });
      setAbierta(true);
      setAbiertos({});
      setMatrizElegida('');
      setIa({ estado: 'borrador', detalleOmitido: sugeridos.some((c) => !c.detallar) });
    } catch (err) {
      if (montado.current) setIa({ estado: 'error', mensaje: mensajeErrorSugerencia(err) });
    }
  }

  function abrirFormMatriz() {
    setMatrizGuardada(null);
    setErrorMatriz(null);
    setFormAbierto(true);
  }

  async function guardarComoMatriz() {
    const criterios = criteriosParaMatriz(preguntaRef.current, niveles);
    if (criterios.length === 0 || !nombreMatriz.trim() || guardando) return;
    setGuardando(true);
    setErrorMatriz(null);
    try {
      const creada = await createMatrizRubrica({
        nombre: nombreMatriz.trim(),
        descripcion: descripcionMatriz.trim() || undefined,
        criterios,
      });
      onMatrizCreadaRef.current?.(creada);
      if (!montado.current) return;
      setMatrizGuardada(creada.nombre);
      setFormAbierto(false);
      setNombreMatriz('');
      setDescripcionMatriz('');
    } catch (err) {
      if (montado.current) setErrorMatriz(mensajeErrorMatriz(err));
    } finally {
      if (montado.current) setGuardando(false);
    }
  }

  const cantidadCriterios = p.criterios.filter((c) => c.nombre.trim()).length;
  const resumenSeccion = cantidadCriterios > 0 ? `${cantidadCriterios} ${cantidadCriterios === 1 ? 'criterio' : 'criterios'}` : 'Sin criterios: la IA evalúa la respuesta en conjunto';

  return (
    <div className={styles.seccion}>
      <button type="button" className={styles.encabezado} onClick={() => setAbierta((v) => !v)} aria-expanded={abierta} aria-controls={idSeccion}>
        <svg className={styles.flecha} width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-abierta={abierta}>
          <path d="M4 2l4 4-4 4" />
        </svg>
        <span className={styles.titulo}>Criterios de corrección</span>
        {!abierta && <span className={styles.resumen}>· {resumenSeccion}</span>}
      </button>

      {abierta && (
        <div id={idSeccion} className={styles.cuerpo}>
          <p className={styles.pista}>
            {cantidadCriterios === 0
              ? 'Decile a la IA qué mirar al corregir: pedile una propuesta a partir del enunciado o escribí los tuyos. Sin criterios evalúa la respuesta en conjunto, sin seguir tu forma de corregir.'
              : 'El peso dice qué tan importante es cada criterio: los puntos de la pregunta se reparten en esa proporción.'}
          </p>

          <div className={styles.barra}>
            <button
              type="button"
              className={`btn btn-secondary ${styles.accionIA}`}
              onClick={sugerirConIA}
              disabled={!hayEnunciado || pensando}
              title={hayEnunciado ? 'La IA propone criterios a partir del enunciado; después los revisás y ajustás' : SIN_ENUNCIADO}
            >
              <span className={styles.etiquetaIA} aria-hidden="true">
                <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M6 0.5l1.3 3.7 3.7 1.3-3.7 1.3L6 10.5 4.7 6.8 1 5.5l3.7-1.3L6 0.5z" />
                </svg>
                IA
              </span>
              {pensando ? 'Pensando…' : 'Sugerir criterios'}
            </button>
            {matrices.length === 0 ? (
              <select className={styles.selector} aria-label="Partir de una matriz existente" disabled value="" onChange={() => {}}>
                <option value="">Todavía no tenés matrices guardadas</option>
              </select>
            ) : (
              <select className={styles.selector} aria-label="Partir de una matriz existente" value={matrizElegida} onChange={(e) => elegirMatriz(e.target.value)}>
                <option value="">Partir de una matriz…</option>
                {matrices.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
                <option value={VALOR_MATRIZ_NUEVA}>+ Crear una matriz nueva (se abre en otra pestaña)</option>
              </select>
            )}
          </div>

          {pensando && (
            <div className={styles.avisoIA} role="status">
              La IA está leyendo el enunciado y armando los criterios. Puede tardar hasta 30 segundos: no cierres esta pregunta mientras tanto.
            </div>
          )}
          {ia.estado === 'borrador' && (
            <div className={styles.avisoIA} role="status">
              Borrador sugerido por la IA: revisalo y ajustalo antes de usarlo.
              {ia.detalleOmitido && ' No se incluyó el detalle por nivel porque no coincide con la escala de niveles de tu examen.'}
            </div>
          )}
          {ia.estado === 'error' && (
            <div className="error-box" role="alert">
              {ia.mensaje}
            </div>
          )}

      {p.criterios.map((c, ci) => {
        const idDetalle = `${uid}-detalle-${ci}`;
        const abierto = Boolean(abiertos[ci]);
        const resumen = resumenDetalle(c);
        const conPeso = hayPuntos && pesoValidoDe(c) > 0;
        const sinPuntos = conPeso && puntos[ci] <= 0; // con tan pocos puntos, este criterio se redondea a 0
        return (
          <div key={ci} style={{ marginBottom: 12 }}>
            {/* Dos líneas: arriba el nombre, el peso y lo que vale; abajo, qué se espera (el texto largo necesita todo el ancho). */}
            <div className="criterio-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) 96px auto 40px', alignItems: 'center', marginBottom: 0 }}>
              <input placeholder="Criterio (ej: Claridad del argumento)" value={c.nombre} onChange={(e) => actualizarCriterio(ci, 'nombre', e.target.value)} />
              <AutoTextarea
                style={{ gridColumn: '1 / -1', gridRow: 2 }}
                rows={1}
                placeholder="Qué se espera para cumplirlo"
                aria-label={`Qué se espera en el criterio ${ci + 1}`}
                value={c.descripcion}
                onChange={(e) => actualizarCriterio(ci, 'descripcion', e.target.value)}
              />
              <input
                type="number"
                min="0"
                step="any"
                placeholder="Peso"
                aria-label={`Peso del criterio ${ci + 1} (qué tan importante es)`}
                title="Qué tan importante es este criterio dentro de la pregunta"
                value={c.peso}
                onChange={(e) => actualizarCriterio(ci, 'peso', e.target.value)}
              />
              <span
                className={sinPuntos ? styles.ptsChicos : 'muted'}
                style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
                title={sinPuntos ? 'Con tan pocos puntos este criterio se redondea a 0: subí los puntos de la pregunta o quitá criterios.' : undefined}
              >
                {pesoValidoDe(c) > 0 && sumaPesos > 0 ? `${Math.round((pesoValidoDe(c) / sumaPesos) * 100)} %` : '—'}
                {conPeso ? ` · ${formatearPuntos(puntos[ci])} pts` : ''}
              </span>
              <button type="button" className={`btn-icon ${styles.quitar}`} onClick={() => quitarCriterio(ci)} aria-label={`Quitar el criterio ${ci + 1}`} title="Quitar criterio">
                ×
              </button>
            </div>

            <div className="accordion-bar" style={{ marginTop: 2 }}>
              <button type="button" className="accordion-toggle" onClick={() => alternarDetalle(ci)} aria-expanded={abierto} aria-controls={idDetalle}>
                <svg className="chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 2l4 4-4 4" />
                </svg>
                Detalle por nivel
                <span className={resumen.incompleto ? 'accordion-summary-error' : 'accordion-summary'}>· {resumen.texto}</span>
              </button>
            </div>
            {abierto && (
              <div id={idDetalle} style={{ marginTop: 8 }}>
                {c.niveles.map((n, ni) => (
                  <div key={ni} className="nivel-row">
                    <div className="nivel-label">
                      {n.orden}. {n.nombre}
                    </div>
                    <AutoTextarea
                      rows={1}
                      placeholder={`Qué implica el nivel "${n.nombre}" acá`}
                      aria-label={`Criterio ${ci + 1}, nivel ${n.nombre}`}
                      value={n.descripcion}
                      onChange={(e) => actualizarNivelCriterio(ci, ni, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

          <div className={styles.pie}>
            <button type="button" className={styles.accionTexto} onClick={agregarCriterio} disabled={p.criterios.length > 0 && !tieneCriteriosCargados(p)}>
              + Agregar criterio
            </button>
            {cantidadCriterios > 0 && (
              <button
                type="button"
                className={styles.accionTexto}
                onClick={abrirFormMatriz}
                disabled={criteriosMatriz.length === 0 || formAbierto}
                title={criteriosMatriz.length === 0 ? SIN_CRITERIOS_LISTOS : 'Guardar esta rúbrica para reutilizarla en otras preguntas y exámenes'}
              >
                Guardar como matriz
              </button>
            )}
            {onAplicarATodas && cantidadCriterios > 0 && (
              <button type="button" className={styles.accionTexto} onClick={onAplicarATodas} title="Se copian los criterios; los puntos de cada pregunta no cambian">
                Usar en todas las preguntas abiertas
              </button>
            )}
          </div>

      {formAbierto && (
        <div className={styles.formMatriz} role="group" aria-label="Guardar estos criterios como matriz">
          <div className={styles.formMatrizTitulo}>
            Guardar como matriz · {criteriosMatriz.length} {criteriosMatriz.length === 1 ? 'criterio' : 'criterios'}
            {criteriosMatriz[0]?.nivelesDescripcion ? ' con el detalle de cada nivel' : ''}
          </div>
          <div className={styles.formMatrizCampos}>
            <div className="field">
              <label htmlFor={`${uid}-matriz-nombre`}>Nombre de la matriz</label>
              <input
                id={`${uid}-matriz-nombre`}
                autoFocus
                value={nombreMatriz}
                onChange={(e) => setNombreMatriz(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    guardarComoMatriz();
                  }
                }}
                placeholder="ej: Rúbrica de ensayo"
              />
            </div>
            <div className="field">
              <label htmlFor={`${uid}-matriz-descripcion`}>Descripción (opcional)</label>
              <input id={`${uid}-matriz-descripcion`} value={descripcionMatriz} onChange={(e) => setDescripcionMatriz(e.target.value)} />
            </div>
          </div>
          {errorMatriz && (
            <div className="error-box" role="alert">
              {errorMatriz}
            </div>
          )}
          <div className={styles.formMatrizAcciones}>
            <button type="button" className="btn btn-primary" onClick={guardarComoMatriz} disabled={!nombreMatriz.trim() || criteriosMatriz.length === 0 || guardando}>
              {guardando ? 'Guardando…' : 'Guardar matriz'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setFormAbierto(false)} disabled={guardando}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {matrizGuardada && (
        <div className={styles.avisoOk} role="status">
          <strong>Matriz guardada</strong> · «{matrizGuardada}».{onMatrizCreada ? ' Ya podés usarla desde el selector de cualquier pregunta.' : ''}
        </div>
      )}
        </div>
      )}
    </div>
  );
}
