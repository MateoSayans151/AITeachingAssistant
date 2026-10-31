'use client';

// PanelSugerirPreguntas: "Sugerir preguntas con IA", arriba de la lista del paso 2. El docente tilda de qué temas del material del
// curso quiere preguntas, de qué tipos, cuántas y con qué dificultad; la IA propone BORRADORES que se ven en tarjetas aparte y que no
// forman parte del examen hasta que el docente toca «Agregar». Cada tarjeta muestra la clave de respuesta, por qué es la correcta y
// de qué parte del material sale; en las que se corrigen solas hay que tildar «Verifiqué la respuesta correcta» antes de poder
// agregarla (una clave equivocada en una pregunta autocorregible le baja la nota a un alumno sin que nadie lo note). Las preguntas
// abiertas se agregan sin criterios (son opcionales: la IA evalúa la respuesta en conjunto) y, si el docente quiere, «Agregar con
// criterios» pide además una rúbrica (la misma IA de «Sugerir criterios»). La IA nunca decide: propone, el docente decide.
//
// Contrato:
//   PanelSugerirPreguntas({ cursoId, preguntas, niveles, onAgregar, onEditar })
//     cursoId        curso elegido en el encabezado del examen ('' o 'nuevo' = todavía no hay curso con material: el panel avisa y no pide nada).
//     preguntas      las preguntas que el examen ya tiene (sus enunciados se mandan para que la IA no las repita).
//     niveles        escala de niveles del examen: los criterios de la rúbrica sugerida se arman con esa cantidad de niveles.
//     onAgregar(p)   agrega la pregunta al examen y devuelve el índice (base 0) en que quedó. Tiene que leer la lista MÁS RECIENTE:
//                    agregar una abierta espera la rúbrica de la IA y mientras tanto el docente pudo seguir editando.
//     onEditar(i)    despliega la pregunta `i` en la lista y lleva el foco ahí.

import { useEffect, useId, useRef, useState } from 'react';
import { listMaterialesPorCurso, sugerirCriterios, sugerirPreguntas } from '@/lib/api';
import type { CriterioSugerido, DificultadPregunta, PreguntaSugerida, TipoPregunta } from '@/lib/api';
import type { NivelForm, PreguntaForm } from '@/lib/examen-form';
import { esPreguntaEnBlanco } from '@/lib/sugerir-preguntas';
import { esSugerenciaCerrada, mensajeErrorSugerirPreguntas, preguntaDeSugerencia, temasDelMaterial, textoFuente } from '@/lib/sugerir-preguntas';
import type { TemaMaterial } from '@/lib/sugerir-preguntas';
import { TIPOS_GRUPOS, TIPOS_LABEL } from './PreguntaCard';
import { SubirMaterial } from './SubirMaterial';
import s from './PanelSugerirPreguntas.module.css';

export interface PanelSugerirPreguntasProps {
  cursoId: string;
  preguntas: PreguntaForm[];
  niveles: NivelForm[];
  onAgregar: (pregunta: PreguntaForm) => number;
  onEditar: (indice: number) => void;
}

interface Item {
  id: number;
  sug: PreguntaSugerida;
  /** El docente tildó «Verifiqué la respuesta correcta» (solo se exige en las que se corrigen solas). */
  verificada: boolean;
  estado: 'pendiente' | 'ocupada' | 'agregada';
  /** Dónde quedó en la lista del examen y con qué enunciado (si el docente la mueve o la edita, el botón «Ver en la lista» se oculta). */
  agregada?: { indice: number; enunciado: string; sinRubrica: boolean };
}

const CANTIDADES = [1, 2, 3, 4, 5, 6, 7, 8];
const DIFICULTADES: { valor: DificultadPregunta; etiqueta: string }[] = [
  { valor: 'facil', etiqueta: 'Fácil' },
  { valor: 'media', etiqueta: 'Media' },
  { valor: 'dificil', etiqueta: 'Difícil' },
];

const hayCursoReal = (cursoId: string) => cursoId !== '' && cursoId !== 'nuevo';

const IconoIA = () => (
  <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M6 0.5l1.3 3.7 3.7 1.3-3.7 1.3L6 10.5 4.7 6.8 1 5.5l3.7-1.3L6 0.5z" />
  </svg>
);

export function PanelSugerirPreguntas({ cursoId, preguntas, niveles, onAgregar, onEditar, }: PanelSugerirPreguntasProps) {
  const idBase = useId();
  const montado = useRef(true);
  const pedido = useRef(0); // número del último pedido de generación: una respuesta vieja (de otro curso o de un pedido anterior) se descarta
  const siguienteId = useRef(1);

  // Abierto mientras no hay preguntas (es una de las formas de empezar); apenas hay una se pliega, para que el examen quede a la vista.
  const [abierto, setAbierto] = useState(() => preguntas.every(esPreguntaEnBlanco));
  const [temasDisponibles, setTemasDisponibles] = useState<TemaMaterial[] | null>(null); // null = cargando
  const [temasElegidos, setTemasElegidos] = useState<string[]>([]);
  const [foco, setFoco] = useState('');
  const [tipos, setTipos] = useState<TipoPregunta[]>(['opcion_multiple', 'desarrollo']);
  const [cantidad, setCantidad] = useState(3);
  const [dificultad, setDificultad] = useState<DificultadPregunta>('media');

  const [pensando, setPensando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sinMaterial, setSinMaterial] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [anuncio, setAnuncio] = useState('');
  const [subidaAbierta, setSubidaAbierta] = useState(false); // «Subir más material» en un curso que ya tiene (y mientras se sube, para que no desaparezca)

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  // Otro curso: las sugerencias y los temas tildados eran del anterior (y una respuesta en camino también).
  useEffect(() => {
    pedido.current++;
    setSubidaAbierta(false);
    setItems([]);
    setError(null);
    setPensando(false);
    setTemasElegidos([]);
    setTemasDisponibles(null);
  }, [cursoId]);

  // Los temas salen del material del curso: se piden al abrir el panel (una vez por curso, plegarlo y abrirlo de nuevo no vuelve a pedirlos).
  useEffect(() => {
    if (!hayCursoReal(cursoId) || !abierto || temasDisponibles !== null) return;
    let vigente = true;
    listMaterialesPorCurso(cursoId)
      .then((ms) => vigente && setTemasDisponibles(temasDelMaterial(ms)))
      .catch(() => vigente && setTemasDisponibles([]));
    return () => {
      vigente = false;
    };
  }, [cursoId, abierto, temasDisponibles]);

  function alternarTema(valor: string) {
    setTemasElegidos((prev) => (prev.includes(valor) ? prev.filter((t) => t !== valor) : [...prev, valor]));
  }

  function alternarTipo(tipo: TipoPregunta) {
    setTipos((prev) => (prev.includes(tipo) ? prev.filter((t) => t !== tipo) : [...prev, tipo]));
  }

  /** Enunciados que la IA no tiene que repetir: los del examen y los de las sugerencias que siguen a la vista. */
  function enunciadosExistentes(extra: Item[] = items): string[] {
    return [...preguntas.map((p) => p.enunciado.trim()), ...extra.filter((i) => i.estado !== 'agregada').map((i) => i.sug.enunciado)].filter(Boolean).slice(-40);
  }

  async function generar() {
    if (pensando || tipos.length === 0 || !hayCursoReal(cursoId)) return;
    const numero = ++pedido.current;
    setPensando(true);
    setError(null);
    try {
      const r = await sugerirPreguntas({
        cursoId,
        tipos,
        cantidad,
        dificultad,
        temas: temasElegidos.length > 0 ? temasElegidos : undefined,
        foco: foco.trim() || undefined,
        existentes: enunciadosExistentes([]),
      });
      if (!montado.current || numero !== pedido.current) return;
      setSinMaterial(r.sinMaterial);
      setItems(r.preguntas.map((sug) => ({ id: siguienteId.current++, sug, verificada: false, estado: 'pendiente' })));
      const faltan = cantidad - r.preguntas.length;
      setAnuncio(
        `La IA propuso ${r.preguntas.length} ${r.preguntas.length === 1 ? 'pregunta' : 'preguntas'}.${faltan > 0 ? ` Descartamos ${faltan} por no cumplir los controles (clave dudosa o repetida).` : ''}`,
      );
    } catch (err) {
      if (montado.current && numero === pedido.current) setError(mensajeErrorSugerirPreguntas(err));
    } finally {
      if (montado.current && numero === pedido.current) setPensando(false);
    }
  }

  function cambiarItem(id: number, cambio: Partial<Item>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...cambio } : i)));
  }

  async function agregar(item: Item, conCriterios = false) {
    if (item.estado !== 'pendiente') return;
    cambiarItem(item.id, { estado: 'ocupada' });
    let criterios: CriterioSugerido[] | undefined;
    let sinRubrica = false;
    if (conCriterios && !esSugerenciaCerrada(item.sug)) {
      // Con criterios: la rúbrica se pide ANTES de agregarla, así llega completa de una vez (y no se pisa nada que el docente
      // edite mientras tanto). Si la IA falla, se agrega sin criterios y se avisa.
      try {
        const cantidadNiveles = niveles.length >= 3 && niveles.length <= 7 ? niveles.length : undefined;
        criterios = (await sugerirCriterios({ enunciado: item.sug.enunciado, tipo: item.sug.tipo, cantidadNiveles })).criterios;
      } catch {
        sinRubrica = true;
      }
      if (!montado.current) return;
    }
    const indice = onAgregar(preguntaDeSugerencia(item.sug, niveles, criterios));
    cambiarItem(item.id, { estado: 'agregada', agregada: { indice, enunciado: item.sug.enunciado, sinRubrica: conCriterios && (sinRubrica || !criterios?.length) } });
    setAnuncio(`Pregunta agregada al examen como la número ${indice + 1}.`);
  }

  async function otraParecida(item: Item) {
    if (item.estado !== 'pendiente') return;
    cambiarItem(item.id, { estado: 'ocupada' });
    try {
      const r = await sugerirPreguntas({
        cursoId,
        tipos: [item.sug.tipo],
        cantidad: 1,
        dificultad,
        temas: temasElegidos.length > 0 ? temasElegidos : undefined,
        foco: `Una pregunta DISTINTA que evalúe el mismo concepto que esta: «${item.sug.enunciado.slice(0, 300)}»`,
        existentes: [...enunciadosExistentes(), item.sug.enunciado],
      });
      if (!montado.current) return;
      setItems((prev) => prev.map((i) => (i.id === item.id ? { id: i.id, sug: r.preguntas[0], verificada: false, estado: 'pendiente' } : i)));
      setAnuncio('La IA propuso otra pregunta parecida.');
    } catch (err) {
      if (!montado.current) return;
      setError(mensajeErrorSugerirPreguntas(err));
      cambiarItem(item.id, { estado: 'pendiente' });
    }
  }

  function descartar(id: number) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setAnuncio('Sugerencia descartada.');
  }

  // Progreso mientras la IA trabaja: mensajes por etapa según cuánto lleva esperando (así no es un "Pensando…" mudo).
  const [segundos, setSegundos] = useState(0);
  useEffect(() => {
    if (!pensando) {
      setSegundos(0);
      return;
    }
    const t = setInterval(() => setSegundos((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [pensando]);
  const etapa = segundos < 4 ? 'Leyendo el material del curso…' : segundos < 12 ? 'Armando las preguntas…' : 'Revisando las respuestas y las rúbricas…';

  const habiaPreguntas = useRef(preguntas.some((q) => !esPreguntaEnBlanco(q)));
  useEffect(() => {
    const hay = preguntas.some((q) => !esPreguntaEnBlanco(q));
    if (hay && !habiaPreguntas.current && !pensando && items.every((i) => i.estado === 'agregada')) setAbierto(false);
    habiaPreguntas.current = hay;
  }, [preguntas, pensando, items]);

  const conCurso = hayCursoReal(cursoId);
  // Un curso sin material (la lista ya cargó y vino vacía): ahí se sugiere subir apuntes y, si no, escribir el tema.
  const sinMaterialCurso = conCurso && temasDisponibles !== null && temasDisponibles.length === 0;
  const idCuerpo = `${idBase}-cuerpo`;
  const pendientes = items.filter((i) => i.estado !== 'agregada').length;

  return (
    <section className={`card ${s.panel}`} aria-label="Sugerir preguntas con IA">
      <button type="button" className={s.cabecera} aria-expanded={abierto} aria-controls={idCuerpo} onClick={() => setAbierto((v) => !v)}>
        <span>
          <span className={s.titulo}>
            <IconoIA /> Sugerir preguntas con IA
          </span>
          <span className={s.subtitulo} style={{ display: 'block' }}>
            La IA arma borradores a partir del material de tu curso. Vos revisás cada una y decidís cuáles agregar.
          </span>
        </span>
        <span aria-hidden="true">{abierto ? '▾' : '▸'}</span>
      </button>

      <div className={s.soloLectores} role="status" aria-live="polite">
        {anuncio}
      </div>

      {abierto && (
        <div id={idCuerpo} className={s.cuerpo}>
          {conCurso && (sinMaterialCurso || subidaAbierta) && (
            <SubirMaterial
              cursoId={cursoId}
              onOcupado={(ocupado) => ocupado && setSubidaAbierta(true)}
              onTerminado={(n) => {
                setTemasDisponibles(null); // se vuelve a pedir el material: aparecen los temas nuevos
                setAnuncio(`Se guardaron ${n} ${n === 1 ? 'archivo' : 'archivos'} de material.`);
              }}
              intro={
                sinMaterialCurso ? (
                  <>
                    <strong>Este curso todavía no tiene material.</strong> Subí tus apuntes, presentaciones o bibliografía (varios archivos a la vez) y la IA
                    arma las preguntas a partir de ellos, no de la nada.
                  </>
                ) : (
                  'Sumá más archivos al material del curso: la IA los usa desde ahora.'
                )
              }
            />
          )}

          {!conCurso ? (
            <div className={s.avisoAtencion}>Para sugerir preguntas hace falta un curso: abrí el examen desde la página de su curso.</div>
          ) : (
            <>
              <fieldset className={s.grupo}>
                <legend className={s.grupoTitulo}>Temas del material</legend>
                {sinMaterialCurso ? (
                  <span className={s.ayuda}>
                    Sin material, escribí abajo el tema y la IA arma las preguntas solo con eso (conviene revisarlas con más cuidado).
                  </span>
                ) : temasDisponibles === null ? (
                  <span className={s.ayuda}>Cargando el material del curso…</span>
                ) : (
                  <>
                    <div className={s.chips}>
                      {temasDisponibles.map((t) => (
                        <label key={t.valor} className={s.chip}>
                          <input type="checkbox" checked={temasElegidos.includes(t.valor)} onChange={() => alternarTema(t.valor)} />
                          {t.valor}
                        </label>
                      ))}
                    </div>
                    <span className={s.ayuda}>
                      Sin ninguno tildado, la IA usa todo el material del curso.
                      {!subidaAbierta && (
                        <>
                          {' '}
                          <button type="button" className={s.enlace} onClick={() => setSubidaAbierta(true)}>
                            Subir más material
                          </button>
                        </>
                      )}
                    </span>
                  </>
                )}
              </fieldset>

              <div className={s.campoAncho}>
                <label htmlFor={`${idBase}-foco`} className={s.grupoTitulo}>
                  {sinMaterialCurso ? 'Tema' : 'Foco o indicación'} <span style={{ fontWeight: 400 }}>(opcional)</span>
                </label>
                <input
                  id={`${idBase}-foco`}
                  className={s.input}
                  type="text"
                  value={foco}
                  maxLength={500}
                  placeholder={
                    sinMaterialCurso ? 'Ej.: Design Thinking y experiencia de usuario' : 'Ej.: que pidan justificar, no repetir definiciones'
                  }
                  onChange={(e) => setFoco(e.target.value)}
                />
              </div>

              {TIPOS_GRUPOS.map((g) => (
                <fieldset key={g.id} className={s.grupo}>
                  <legend className={s.grupoTitulo}>{g.titulo}</legend>
                  <div className={s.chips}>
                    {g.tipos.map(({ tipo }) => (
                      <label key={tipo} className={s.chip}>
                        <input type="checkbox" checked={tipos.includes(tipo)} onChange={() => alternarTipo(tipo)} />
                        {TIPOS_LABEL[tipo]}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}

              <div className={s.fila}>
                <div className={s.campo}>
                  <label htmlFor={`${idBase}-cantidad`} className={s.grupoTitulo}>
                    Cantidad
                  </label>
                  <select id={`${idBase}-cantidad`} className={s.input} value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))}>
                    {CANTIDADES.map((n) => (
                      <option key={n} value={n}>
                        {n} {n === 1 ? 'pregunta' : 'preguntas'}
                      </option>
                    ))}
                  </select>
                </div>
                <fieldset className={s.grupo}>
                  <legend className={s.grupoTitulo}>Dificultad</legend>
                  <div className={s.segmentos}>
                    {DIFICULTADES.map((d) => (
                      <label key={d.valor} className={s.segmento}>
                        <input type="radio" name={`${idBase}-dificultad`} checked={dificultad === d.valor} onChange={() => setDificultad(d.valor)} />
                        {d.etiqueta}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>

              <div className={s.acciones}>
                <button type="button" className="btn btn-secondary" onClick={generar} disabled={pensando || tipos.length === 0}>
                  {pensando ? 'Generando…' : items.length > 0 ? 'Generar otras' : 'Generar sugerencias'}
                </button>
                {tipos.length === 0 && <span className={s.ayuda}>Elegí al menos un tipo de pregunta.</span>}
                {pensando && (
                  <span className={s.ayuda} role="status">
                    {etapa} Puede tardar hasta medio minuto.
                  </span>
                )}
              </div>
              {pensando && (
                <div className="skeleton-pila" aria-hidden="true" style={{ marginTop: 'var(--space-3)' }}>
                  {Array.from({ length: Math.min(cantidad, 3) }, (_, i) => (
                    <div key={i} className="card skeleton-tarjeta">
                      <span className="skeleton" style={{ width: '30%', height: 12 }} />
                      <span className="skeleton" style={{ width: '90%', height: 14 }} />
                      <span className="skeleton" style={{ width: '60%', height: 14 }} />
                    </div>
                  ))}
                </div>
              )}

              {error && (
                <div className={s.avisoError} role="alert">
                  {error}
                </div>
              )}

              {items.length > 0 && sinMaterial && (
                <div className={s.avisoAtencion}>
                  Estas preguntas salen solo del tema que indicaste, sin material de cátedra detrás: revisalas con más cuidado antes de agregarlas.
                </div>
              )}

              {items.length > 0 && (
                <ul className={s.lista} aria-label="Preguntas sugeridas">
                  {items.map((item) => (
                    <TarjetaSugerencia
                      key={item.id}
                      item={item}
                      numeroEnLista={item.agregada && preguntas[item.agregada.indice]?.enunciado.trim() === item.agregada.enunciado ? item.agregada.indice + 1 : null}
                      faltanPuntos={item.agregada ? !(Number(preguntas[item.agregada.indice]?.puntajeMaximo) > 0) : false}
                      onVerificar={(v) => cambiarItem(item.id, { verificada: v })}
                      onAgregar={(conCriterios) => agregar(item, conCriterios)}
                      onOtra={() => otraParecida(item)}
                      onDescartar={() => descartar(item.id)}
                      onEditar={() => item.agregada && onEditar(item.agregada.indice)}
                    />
                  ))}
                </ul>
              )}
              {items.length > 0 && pendientes === 0 && <span className={s.ayuda}>Agregaste todas. Podés pedir más con «Generar otras».</span>}
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- una sugerencia

function TarjetaSugerencia({
  item,
  numeroEnLista,
  faltanPuntos,
  onVerificar,
  onAgregar,
  onOtra,
  onDescartar,
  onEditar,
}: {
  item: Item;
  /** Posición actual (base 1) de la pregunta ya agregada, o null si el docente la movió o la editó y ya no se puede ubicar. */
  numeroEnLista: number | null;
  /** La pregunta ya agregada todavía no tiene puntos (el aviso se va solo cuando el docente los carga). */
  faltanPuntos: boolean;
  onVerificar: (v: boolean) => void;
  onAgregar: (conCriterios: boolean) => void;
  onOtra: () => void;
  onDescartar: () => void;
  onEditar: () => void;
}) {
  const idVerificar = useId();
  const { sug } = item;
  const cerrada = esSugerenciaCerrada(sug);
  const ocupada = item.estado === 'ocupada';

  if (item.estado === 'agregada' && item.agregada) {
    return (
      <li className={s.sugAgregada}>
        <div className={s.resumenAgregada}>
          <span>
            <strong>✓ Agregada al examen</strong>
            {numeroEnLista !== null ? ` como la pregunta ${numeroEnLista}` : ''}: {sug.enunciado.length > 90 ? `${sug.enunciado.slice(0, 90)}…` : sug.enunciado}
            <span className={s.ayuda} style={{ display: 'block' }}>
              {faltanPuntos && 'Le falta asignar los puntos (usá «Repartir en partes iguales» arriba).'}
              {item.agregada.sinRubrica && ' La IA no pudo armar los criterios: se agregó sin ellos (la IA evalúa la respuesta en conjunto). Si querés, sumalos desde la pregunta.'}
            </span>
          </span>
          {numeroEnLista !== null && (
            <button type="button" className="btn btn-secondary" onClick={onEditar}>
              Ver en la lista
            </button>
          )}
        </div>
      </li>
    );
  }

  const fuente = textoFuente(sug.fuente);
  return (
    <li className={s.sug} aria-busy={ocupada}>
      <div className={s.sugCabecera}>
        <span className="badge badge-corregido">{TIPOS_LABEL[sug.tipo]}</span>
        <span className={s.fuente}>{cerrada ? 'Se corrige sola' : 'La corrige la IA con rúbrica'}</span>
        {fuente ? <span className={s.fuente}>· 📎 Basada en: {fuente}</span> : <span className={s.sinFuente}>· Sin fuente en el material: verificala con más cuidado</span>}
      </div>

      <p className={s.enunciado}>{sug.enunciado}</p>

      <ClaveDeRespuesta sug={sug} />

      {sug.explicacion && (
        <details className={s.explicacion}>
          <summary>{cerrada ? 'Por qué es la respuesta correcta' : 'Qué debería tener una buena respuesta'}</summary>
          <p style={{ margin: '8px 0 0' }}>{sug.explicacion}</p>
        </details>
      )}

      {cerrada && (
        <label className={s.verificar} htmlFor={idVerificar}>
          <input id={idVerificar} type="checkbox" checked={item.verificada} disabled={ocupada} onChange={(e) => onVerificar(e.target.checked)} />
          <span>Verifiqué que la respuesta marcada es la correcta (si la clave está mal, un alumno pierde puntos sin que nadie lo note).</span>
        </label>
      )}

      <div className={s.botones}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onAgregar(false)}
          disabled={ocupada || (cerrada && !item.verificada)}
          title={cerrada && !item.verificada ? 'Tildá primero que verificaste la respuesta correcta' : 'Agrega la pregunta al examen; después la podés editar'}
        >
          {ocupada ? 'Agregando…' : 'Agregar al examen'}
        </button>
        {!cerrada && (
          <button type="button" className="btn btn-secondary" onClick={() => onAgregar(true)} disabled={ocupada} title="La IA también propone los criterios de corrección (opcionales)">
            Agregar con criterios
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={onOtra} disabled={ocupada}>
          Otra parecida
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDescartar} disabled={ocupada}>
          Descartar
        </button>
      </div>
    </li>
  );
}

/** La clave de la pregunta cerrada, bien a la vista para que el docente la verifique (opciones con la correcta marcada, V/F, número o pares). */
function ClaveDeRespuesta({ sug }: { sug: PreguntaSugerida }) {
  const o = sug.opciones;
  const esObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

  if ((sug.tipo === 'opcion_multiple' || sug.tipo === 'casillas') && Array.isArray(o)) {
    return (
      <ul className={s.clave} aria-label="Opciones">
        {o.filter(esObj).map((op, i) => {
          const correcta = op.correcta === true;
          return (
            <li key={i} className={correcta ? s.opcionCorrecta : s.opcion}>
              <span className={s.marca} aria-hidden="true">
                {correcta ? '✓' : String(op.id ?? '').toUpperCase()}
              </span>
              <span>
                {String(op.texto ?? '')}
                {correcta && <span className={s.soloLectores}> (correcta)</span>}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }
  if (sug.tipo === 'verdadero_falso' && esObj(o)) {
    return (
      <p className={s.explicacion} style={{ margin: 0 }}>
        Respuesta correcta: <strong>{o.correcta === true ? 'Verdadero' : 'Falso'}</strong>
      </p>
    );
  }
  if (sug.tipo === 'numerica' && esObj(o)) {
    return (
      <p className={s.explicacion} style={{ margin: 0 }}>
        Respuesta correcta: <strong>{String(o.respuestaCorrecta)}</strong> (tolerancia: {String(o.tolerancia ?? 0)})
      </p>
    );
  }
  if (sug.tipo === 'relacionar_pares' && esObj(o) && Array.isArray(o.paresCorrectos)) {
    return (
      <ul className={s.clave} aria-label="Pares correctos">
        {o.paresCorrectos.map((par, i) => (
          <li key={i} className={s.opcion}>
            <span className={s.marca} aria-hidden="true">
              ↔
            </span>
            <span>
              {Array.isArray(par) ? `${String(par[0])}  →  ${String(par[1])}` : ''}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return null;
}
