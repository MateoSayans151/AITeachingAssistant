'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Comision,
  MatrizRubrica,
  ModalidadExamen,
  FeedbackModo,
  TipoPregunta,
  TIPOS_AUTOCORREGIBLES,
  createExamen,
  listComisionesPorCurso,
  listMatricesRubrica,
  publicarExamenAComision,
} from '@/lib/api';

const TIPOS_LABEL: Record<TipoPregunta, string> = {
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

interface NivelForm {
  orden: number;
  nombre: string;
  colorHex: string;
  porcentaje: string;
}

function nivelesPorDefecto(): NivelForm[] {
  return [
    { orden: 1, nombre: 'Insuficiente', colorHex: '#c0392b', porcentaje: '0' },
    { orden: 2, nombre: 'Básico', colorHex: '#c8511b', porcentaje: '25' },
    { orden: 3, nombre: 'Intermedio', colorHex: '#c9a227', porcentaje: '50' },
    { orden: 4, nombre: 'Avanzado', colorHex: '#3b4fb0', porcentaje: '75' },
    { orden: 5, nombre: 'Excelente', colorHex: '#1a7f4e', porcentaje: '100' },
  ];
}

interface CriterioForm {
  matrizOrigenId?: string;
  nombre: string;
  descripcion: string;
  puntajeMaximo: string;
  niveles: { orden: number; nombre: string; descripcion: string }[];
}

function criterioVacio(niveles: NivelForm[]): CriterioForm {
  return {
    nombre: '',
    descripcion: '',
    puntajeMaximo: '',
    niveles: niveles.map((n) => ({ orden: n.orden, nombre: n.nombre, descripcion: '' })),
  };
}

interface OpcionChoiceForm {
  id: string;
  texto: string;
  correcta: boolean;
}

interface PreguntaForm {
  tipo: TipoPregunta;
  enunciado: string;
  puntajeMaximo: string;
  criterios: CriterioForm[];
  opcionesChoice: OpcionChoiceForm[];
  vfCorrecta: 'true' | 'false';
  numRespuestaCorrecta: string;
  numTolerancia: string;
  paresIzquierda: string[];
  paresDerecha: string[];
}

function preguntaVacia(niveles: NivelForm[]): PreguntaForm {
  return {
    tipo: 'desarrollo',
    enunciado: '',
    puntajeMaximo: '',
    criterios: [criterioVacio(niveles)],
    opcionesChoice: [
      { id: 'a', texto: '', correcta: true },
      { id: 'b', texto: '', correcta: false },
    ],
    vfCorrecta: 'true',
    numRespuestaCorrecta: '',
    numTolerancia: '0',
    paresIzquierda: ['', ''],
    paresDerecha: ['', ''],
  };
}

const PASOS = ['Datos', 'Escala y niveles', 'Vara', 'Preguntas', 'Publicar'];

export default function NuevoExamenPage() {
  return (
    <Suspense fallback={<div className="page"><p className="muted">Cargando…</p></div>}>
      <NuevoExamenForm />
    </Suspense>
  );
}

function NuevoExamenForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cursoId = searchParams.get('cursoId') ?? '';

  const [paso, setPaso] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Paso 1: datos
  const [titulo, setTitulo] = useState('');
  const [consigna, setConsigna] = useState('');
  const [modalidad, setModalidad] = useState<ModalidadExamen>('ventana_dias');
  const [duracionMinutos, setDuracionMinutos] = useState('60');
  const [escalaMin, setEscalaMin] = useState('0');
  const [escalaMax, setEscalaMax] = useState('10');
  const [feedbackModo, setFeedbackModo] = useState<FeedbackModo>('manual');

  // Paso 2: niveles
  const [niveles, setNiveles] = useState<NivelForm[]>(nivelesPorDefecto());

  // Paso 4: preguntas
  const [preguntas, setPreguntas] = useState<PreguntaForm[]>([preguntaVacia(nivelesPorDefecto())]);
  const [matrices, setMatrices] = useState<MatrizRubrica[]>([]);

  // Paso 5: publicar (una vez creado el examen)
  const [examenCreadoId, setExamenCreadoId] = useState<string | null>(null);
  const [comisiones, setComisiones] = useState<Comision[]>([]);
  const [comisionSeleccionada, setComisionSeleccionada] = useState('');
  const [linkGenerado, setLinkGenerado] = useState<string | null>(null);

  useEffect(() => {
    listMatricesRubrica().then(setMatrices).catch(() => setMatrices([]));
  }, []);

  useEffect(() => {
    if (paso === 4 && cursoId) {
      listComisionesPorCurso(cursoId).then(setComisiones).catch(() => setComisiones([]));
    }
  }, [paso, cursoId]);

  if (!cursoId) {
    return (
      <div className="page">
        <p className="muted">Falta indicar el curso. Volvé al detalle del curso y creá el examen desde ahí.</p>
      </div>
    );
  }

  function actualizarNivel(i: number, campo: keyof NivelForm, valor: string) {
    setNiveles((prev) => prev.map((n, idx) => (idx === i ? { ...n, [campo]: valor } : n)));
  }

  function actualizarPregunta<K extends keyof PreguntaForm>(i: number, campo: K, valor: PreguntaForm[K]) {
    setPreguntas((prev) => prev.map((p, idx) => (idx === i ? { ...p, [campo]: valor } : p)));
  }

  function cambiarTipoPregunta(i: number, tipo: TipoPregunta) {
    setPreguntas((prev) => prev.map((p, idx) => (idx === i ? { ...preguntaVacia(niveles), tipo, enunciado: p.enunciado, puntajeMaximo: p.puntajeMaximo } : p)));
  }

  function agregarPregunta() {
    setPreguntas((prev) => [...prev, preguntaVacia(niveles)]);
  }

  function quitarPregunta(i: number) {
    setPreguntas((prev) => prev.filter((_, idx) => idx !== i));
  }

  function actualizarCriterio(pi: number, ci: number, campo: 'nombre' | 'descripcion' | 'puntajeMaximo', valor: string) {
    setPreguntas((prev) =>
      prev.map((p, pIdx) =>
        pIdx === pi
          ? { ...p, criterios: p.criterios.map((c, cIdx) => (cIdx === ci ? { ...c, [campo]: valor } : c)) }
          : p,
      ),
    );
  }

  function actualizarNivelCriterio(pi: number, ci: number, ni: number, descripcion: string) {
    setPreguntas((prev) =>
      prev.map((p, pIdx) =>
        pIdx === pi
          ? {
              ...p,
              criterios: p.criterios.map((c, cIdx) =>
                cIdx === ci ? { ...c, niveles: c.niveles.map((n, nIdx) => (nIdx === ni ? { ...n, descripcion } : n)) } : c,
              ),
            }
          : p,
      ),
    );
  }

  function agregarCriterio(pi: number) {
    setPreguntas((prev) => prev.map((p, idx) => (idx === pi ? { ...p, criterios: [...p.criterios, criterioVacio(niveles)] } : p)));
  }

  function quitarCriterio(pi: number, ci: number) {
    setPreguntas((prev) =>
      prev.map((p, idx) => (idx === pi ? { ...p, criterios: p.criterios.filter((_, cIdx) => cIdx !== ci) } : p)),
    );
  }

  function usarMatriz(pi: number, matrizId: string) {
    const matriz = matrices.find((m) => m.id === matrizId);
    if (!matriz) return;
    setPreguntas((prev) =>
      prev.map((p, idx) =>
        idx === pi
          ? {
              ...p,
              criterios: matriz.criterios.map((c) => ({
                matrizOrigenId: matriz.id,
                nombre: c.nombre,
                descripcion: c.descripcion,
                puntajeMaximo: String(c.puntajeMaximo),
                niveles: c.nivelesDescripcion.map((n) => ({ orden: n.orden, nombre: n.nombre, descripcion: n.descripcion })),
              })),
            }
          : p,
      ),
    );
  }

  function actualizarChoice(pi: number, oi: number, campo: 'texto' | 'correcta', valor: string | boolean) {
    setPreguntas((prev) =>
      prev.map((p, idx) =>
        idx === pi
          ? {
              ...p,
              opcionesChoice: p.opcionesChoice.map((o, oIdx) => {
                if (oIdx !== oi) {
                  // opción múltiple: una sola correcta a la vez
                  return campo === 'correcta' && valor === true && p.tipo === 'opcion_multiple' ? { ...o, correcta: false } : o;
                }
                return { ...o, [campo]: valor };
              }),
            }
          : p,
      ),
    );
  }

  function agregarChoice(pi: number) {
    setPreguntas((prev) =>
      prev.map((p, idx) =>
        idx === pi
          ? { ...p, opcionesChoice: [...p.opcionesChoice, { id: String.fromCharCode(97 + p.opcionesChoice.length), texto: '', correcta: false }] }
          : p,
      ),
    );
  }

  function actualizarPar(pi: number, lado: 'paresIzquierda' | 'paresDerecha', i: number, valor: string) {
    setPreguntas((prev) =>
      prev.map((p, idx) => (idx === pi ? { ...p, [lado]: p[lado].map((v, vi) => (vi === i ? valor : v)) } : p)),
    );
  }

  function agregarPar(pi: number) {
    setPreguntas((prev) =>
      prev.map((p, idx) =>
        idx === pi ? { ...p, paresIzquierda: [...p.paresIzquierda, ''], paresDerecha: [...p.paresDerecha, ''] } : p,
      ),
    );
  }

  function construirOpciones(p: PreguntaForm): unknown {
    switch (p.tipo) {
      case 'opcion_multiple':
      case 'casillas':
        return p.opcionesChoice.filter((o) => o.texto).map((o) => ({ id: o.id, texto: o.texto, correcta: o.correcta }));
      case 'verdadero_falso':
        return { correcta: p.vfCorrecta === 'true' };
      case 'numerica':
        return { respuestaCorrecta: Number(p.numRespuestaCorrecta), tolerancia: Number(p.numTolerancia || 0) };
      case 'relacionar_pares':
        return {
          izquierda: p.paresIzquierda,
          derecha: p.paresDerecha,
          paresCorrectos: p.paresIzquierda.map((izq, i) => [izq, p.paresDerecha[i]]),
        };
      default:
        return undefined;
    }
  }

  async function handleCrearExamen() {
    setLoading(true);
    setError(null);
    try {
      const examen = await createExamen({
        cursoId,
        titulo,
        consigna,
        modalidad,
        duracionMinutos: modalidad === 'sesion_tiempo' ? Number(duracionMinutos) : undefined,
        escalaMin: Number(escalaMin),
        escalaMax: Number(escalaMax),
        niveles: niveles.map((n) => ({ orden: n.orden, nombre: n.nombre, colorHex: n.colorHex, porcentaje: Number(n.porcentaje) })),
        feedbackModo,
        preguntas: preguntas.map((p) => ({
          tipo: p.tipo,
          enunciado: p.enunciado,
          puntajeMaximo: Number(p.puntajeMaximo),
          opciones: TIPOS_AUTOCORREGIBLES.includes(p.tipo) ? construirOpciones(p) : undefined,
          criterios: TIPOS_AUTOCORREGIBLES.includes(p.tipo)
            ? undefined
            : p.criterios
                .filter((c) => c.nombre && c.puntajeMaximo)
                .map((c) => ({
                  matrizOrigenId: c.matrizOrigenId,
                  nombre: c.nombre,
                  descripcion: c.descripcion,
                  puntajeMaximo: Number(c.puntajeMaximo),
                  nivelesDescripcion: c.niveles,
                })),
        })),
      });
      setExamenCreadoId(examen.id);
      setPaso(4);
    } catch (err) {
      setError('No se pudo crear el examen. Revisá que todas las preguntas tengan su clave o sus criterios completos.');
    } finally {
      setLoading(false);
    }
  }

  async function handlePublicar() {
    if (!examenCreadoId || !comisionSeleccionada) return;
    setLoading(true);
    setError(null);
    try {
      const resultado = await publicarExamenAComision(examenCreadoId, { comisionId: comisionSeleccionada });
      setLinkGenerado(resultado.urlAcceso ?? null);
    } catch (err) {
      setError('No se pudo publicar el examen a esa comisión.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">Nuevo examen</div>
        <h1>{titulo || 'Configurar examen'}</h1>
      </header>

      <div className="stepper">
        {PASOS.map((label, i) => (
          <div className="step" key={label}>
            <span className="step-num">{i + 1}</span>
            <span className="step-label" style={{ opacity: i === paso ? 1 : 0.5 }}>
              {label}
            </span>
          </div>
        ))}
      </div>

      {error && <div className="error-box">{error}</div>}

      {paso === 0 && (
        <div>
          <div className="field">
            <label htmlFor="titulo">Título del examen</label>
            <input id="titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="consigna">Consigna / instrucciones generales</label>
            <textarea id="consigna" value={consigna} onChange={(e) => setConsigna(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="modalidad">Modalidad</label>
            <select id="modalidad" value={modalidad} onChange={(e) => setModalidad(e.target.value as ModalidadExamen)}>
              <option value="ventana_dias">Ventana de varios días (el alumno entra cuando quiere dentro del rango)</option>
              <option value="sesion_tiempo">Sesión con tiempo límite</option>
            </select>
          </div>
          {modalidad === 'sesion_tiempo' && (
            <div className="field">
              <label htmlFor="duracion">Duración (minutos)</label>
              <input id="duracion" type="number" min="1" value={duracionMinutos} onChange={(e) => setDuracionMinutos(e.target.value)} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 16 }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="escalaMin">Escala mínima</label>
              <input id="escalaMin" type="number" value={escalaMin} onChange={(e) => setEscalaMin(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="escalaMax">Escala máxima</label>
              <input id="escalaMax" type="number" value={escalaMax} onChange={(e) => setEscalaMax(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="feedbackModo">Liberación de feedback</label>
            <select id="feedbackModo" value={feedbackModo} onChange={(e) => setFeedbackModo(e.target.value as FeedbackModo)}>
              <option value="manual">Manual (el docente libera el feedback cuando quiere)</option>
              <option value="inmediato">Inmediato (apenas el docente termina de revisar cada respuesta)</option>
            </select>
          </div>
        </div>
      )}

      {paso === 1 && (
        <div>
          <p className="muted" style={{ marginBottom: 16 }}>
            5 niveles de desempeño, cada uno con el % del puntaje de un criterio que representa. Se usan en todas
            las preguntas abiertas de este examen.
          </p>
          {niveles.map((n, i) => (
            <div key={n.orden} style={{ display: 'grid', gridTemplateColumns: '32px 1fr 90px 90px', gap: 10, marginBottom: 10, alignItems: 'center' }}>
              <span className="nivel-dot" style={{ background: n.colorHex }} />
              <input value={n.nombre} onChange={(e) => actualizarNivel(i, 'nombre', e.target.value)} />
              <input type="color" value={n.colorHex} onChange={(e) => actualizarNivel(i, 'colorHex', e.target.value)} />
              <input type="number" min="0" max="100" value={n.porcentaje} onChange={(e) => actualizarNivel(i, 'porcentaje', e.target.value)} />
            </div>
          ))}
        </div>
      )}

      {paso === 2 && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: 8 }}>
            La vara se ajusta después
          </div>
          <p className="muted">
            Una vez que tengas respuestas corregidas por la IA, vas a poder desplazar la nota sugerida de todo el
            examen en +/- % desde la pantalla del examen, sin perder las revisiones que ya hiciste a mano.
          </p>
        </div>
      )}

      {paso === 3 && (
        <div>
          {preguntas.map((p, pi) => (
            <div key={pi} className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                <select value={p.tipo} onChange={(e) => cambiarTipoPregunta(pi, e.target.value as TipoPregunta)} style={{ flex: 1 }}>
                  {Object.entries(TIPOS_LABEL).map(([tipo, label]) => (
                    <option key={tipo} value={tipo}>
                      {label}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn-secondary" onClick={() => quitarPregunta(pi)} disabled={preguntas.length === 1}>
                  Quitar pregunta
                </button>
              </div>

              <div className="field">
                <label>Enunciado</label>
                <textarea value={p.enunciado} onChange={(e) => actualizarPregunta(pi, 'enunciado', e.target.value)} />
              </div>

              <div className="field" style={{ maxWidth: 160 }}>
                <label>Puntaje máximo</label>
                <input type="number" min="0.5" step="0.5" value={p.puntajeMaximo} onChange={(e) => actualizarPregunta(pi, 'puntajeMaximo', e.target.value)} />
              </div>

              {!TIPOS_AUTOCORREGIBLES.includes(p.tipo) && (
                <div>
                  <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
                    Criterios de rúbrica (opcional: partir de una matriz existente)
                  </div>
                  {matrices.length > 0 && (
                    <select
                      defaultValue=""
                      onChange={(e) => e.target.value && usarMatriz(pi, e.target.value)}
                      style={{ marginBottom: 14 }}
                    >
                      <option value="">Usar matriz existente…</option>
                      {matrices.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.nombre}
                        </option>
                      ))}
                    </select>
                  )}

                  {p.criterios.map((c, ci) => (
                    <div key={ci} className="card" style={{ marginBottom: 10 }}>
                      <div className="criterio-row" style={{ gridTemplateColumns: '2fr 3fr 100px auto' }}>
                        <input placeholder="Criterio" value={c.nombre} onChange={(e) => actualizarCriterio(pi, ci, 'nombre', e.target.value)} />
                        <input placeholder="Descripción" value={c.descripcion} onChange={(e) => actualizarCriterio(pi, ci, 'descripcion', e.target.value)} />
                        <input type="number" min="0.5" step="0.5" placeholder="Pts" value={c.puntajeMaximo} onChange={(e) => actualizarCriterio(pi, ci, 'puntajeMaximo', e.target.value)} />
                        <button type="button" className="btn btn-secondary" onClick={() => quitarCriterio(pi, ci)} disabled={p.criterios.length === 1}>
                          Quitar
                        </button>
                      </div>
                      {c.niveles.map((n, ni) => (
                        <div key={ni} style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, marginTop: 8 }}>
                          <div className="muted" style={{ fontSize: 13, fontWeight: 700, paddingTop: 10 }}>
                            {n.orden}. {n.nombre}
                          </div>
                          <input
                            placeholder={`Qué implica el nivel "${n.nombre}" acá`}
                            value={n.descripcion}
                            onChange={(e) => actualizarNivelCriterio(pi, ci, ni, e.target.value)}
                          />
                        </div>
                      ))}
                    </div>
                  ))}
                  <button type="button" className="btn btn-secondary" onClick={() => agregarCriterio(pi)}>
                    + Agregar criterio
                  </button>
                </div>
              )}

              {(p.tipo === 'opcion_multiple' || p.tipo === 'casillas') && (
                <div>
                  {p.opcionesChoice.map((o, oi) => (
                    <div key={oi} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                      <input
                        type={p.tipo === 'opcion_multiple' ? 'radio' : 'checkbox'}
                        name={`correcta-${pi}`}
                        checked={o.correcta}
                        onChange={(e) => actualizarChoice(pi, oi, 'correcta', e.target.checked)}
                      />
                      <input placeholder={`Opción ${o.id}`} value={o.texto} onChange={(e) => actualizarChoice(pi, oi, 'texto', e.target.value)} />
                    </div>
                  ))}
                  <button type="button" className="btn btn-secondary" onClick={() => agregarChoice(pi)}>
                    + Agregar opción
                  </button>
                </div>
              )}

              {p.tipo === 'verdadero_falso' && (
                <div className="field" style={{ maxWidth: 200 }}>
                  <label>Respuesta correcta</label>
                  <select value={p.vfCorrecta} onChange={(e) => actualizarPregunta(pi, 'vfCorrecta', e.target.value as 'true' | 'false')}>
                    <option value="true">Verdadero</option>
                    <option value="false">Falso</option>
                  </select>
                </div>
              )}

              {p.tipo === 'numerica' && (
                <div style={{ display: 'flex', gap: 16 }}>
                  <div className="field" style={{ flex: 1 }}>
                    <label>Respuesta correcta</label>
                    <input type="number" value={p.numRespuestaCorrecta} onChange={(e) => actualizarPregunta(pi, 'numRespuestaCorrecta', e.target.value)} />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>Tolerancia (+/-)</label>
                    <input type="number" min="0" value={p.numTolerancia} onChange={(e) => actualizarPregunta(pi, 'numTolerancia', e.target.value)} />
                  </div>
                </div>
              )}

              {p.tipo === 'relacionar_pares' && (
                <div>
                  {p.paresIzquierda.map((izq, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
                      <input placeholder="Elemento A" value={izq} onChange={(e) => actualizarPar(pi, 'paresIzquierda', i, e.target.value)} />
                      <input placeholder="Corresponde con…" value={p.paresDerecha[i]} onChange={(e) => actualizarPar(pi, 'paresDerecha', i, e.target.value)} />
                    </div>
                  ))}
                  <button type="button" className="btn btn-secondary" onClick={() => agregarPar(pi)}>
                    + Agregar par
                  </button>
                </div>
              )}
            </div>
          ))}
          <button type="button" className="btn btn-secondary" onClick={agregarPregunta}>
            + Agregar pregunta
          </button>
        </div>
      )}

      {paso === 4 && (
        <div>
          {!examenCreadoId && (
            <div className="card">
              <p className="muted" style={{ marginBottom: 16 }}>
                Revisá los pasos anteriores y creá el examen. Después vas a poder publicarlo a una o más comisiones.
              </p>
              <button className="btn btn-primary" onClick={handleCrearExamen} disabled={loading}>
                {loading ? 'Creando…' : 'Crear examen'}
              </button>
            </div>
          )}

          {examenCreadoId && !linkGenerado && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 12 }}>
                Publicar a una comisión
              </div>
              <div className="field">
                <select value={comisionSeleccionada} onChange={(e) => setComisionSeleccionada(e.target.value)}>
                  <option value="">Elegí una comisión…</option>
                  {comisiones.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn btn-primary" onClick={handlePublicar} disabled={loading || !comisionSeleccionada}>
                {loading ? 'Publicando…' : 'Generar link de acceso'}
              </button>
            </div>
          )}

          {linkGenerado && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 8 }}>
                Link de acceso generado
              </div>
              <p style={{ wordBreak: 'break-all', marginBottom: 16 }}>{linkGenerado}</p>
              <button className="btn btn-primary" onClick={() => router.push(`/examenes/${examenCreadoId}`)}>
                Ir al examen
              </button>
            </div>
          )}
        </div>
      )}

      {paso < 4 && (
        <div style={{ marginTop: 28, display: 'flex', gap: 12 }}>
          {paso > 0 && (
            <button type="button" className="btn btn-secondary" onClick={() => setPaso(paso - 1)}>
              Atrás
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => setPaso(paso + 1)}>
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
