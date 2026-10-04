'use client';

import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { fechaLocalAIso } from '@/lib/fechas';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ApiError,
  Comision,
  Curso,
  MatrizRubrica,
  ModalidadExamen,
  FeedbackModo,
  TipoPregunta,
  TIPOS_AUTOCORREGIBLES,
  createComision,
  createCurso,
  createExamen,
  getExamen,
  listComisionesPorCurso,
  listCursos,
  listMatricesRubrica,
  publicarExamenAComision,
} from '@/lib/api';
import { useSesion } from '@/lib/auth';
import {
  NivelForm,
  PRESETS_NIVELES,
  PreguntaForm,
  aplicarPreset,
  construirOpciones,
  criterioVacio,
  examenAFormulario,
  formatearPuntos,
  nivelesPorDefecto,
  preguntaVacia,
  presetDe,
  puntajeDeCriterios,
  puntosDeEjemplo,
  redondearPuntos,
  resumenNiveles,
  totalCoincideConEscala,
  totalDelExamen,
  validarNiveles,
} from '@/lib/examen-form';

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

// La escala de niveles y la distribución esperada ya no son pasos: viven en "Opciones avanzadas" del primer paso, porque
// los valores por defecto sirven para la mayoría de los casos y no tiene sentido obligar a pasar por ahí.
const PASOS = ['Datos', 'Preguntas', 'Publicar'];
const PASO_PREGUNTAS = 1;
const PASO_PUBLICAR = 2;

const esNumero = (v: string) => v.trim() !== '' && Number.isFinite(Number(v));

/** "Nombre, email" por línea (o solo el email); acepta lo pegado desde una planilla (tabs, comas o punto y coma). */
function parsearAlumnos(texto: string): { alumnos: { nombre: string; email: string }[]; errores: string[] } {
  const alumnos: { nombre: string; email: string }[] = [];
  const errores: string[] = [];
  const vistos = new Set<string>();
  texto.split(/\r?\n/).forEach((linea, i) => {
    if (!linea.trim()) return;
    const partes = linea.split(/[\t,;]+/).map((x) => x.trim()).filter(Boolean);
    const email = (partes.find((x) => x.includes('@')) ?? '').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errores.push(`Línea ${i + 1}: no encontré un email válido ("${linea.trim().slice(0, 40)}").`);
      return;
    }
    if (vistos.has(email)) {
      errores.push(`Línea ${i + 1}: el email ${email} está repetido.`);
      return;
    }
    vistos.add(email);
    const nombre = partes.filter((x) => !x.includes('@')).join(' ') || email.split('@')[0];
    alumnos.push({ nombre, email });
  });
  return { alumnos, errores };
}

/** Mensajes de validación del servidor (class-validator devuelve una lista), si los hay. */
function mensajesDelServidor(err: unknown): string[] {
  if (err instanceof ApiError) {
    try {
      const m = JSON.parse(err.body).message;
      if (Array.isArray(m)) return m.map(String);
      if (typeof m === 'string') return [m];
    } catch {
      /* cuerpo no JSON */
    }
  }
  return [];
}

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
  const cursoIdParam = searchParams.get('cursoId') ?? '';
  const desdeParam = searchParams.get('desde') ?? ''; // id de un examen para duplicar
  const { docente, cargando } = useSesion();

  const [paso, setPaso] = useState(0);
  const [errores, setErrores] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // Paso 1: datos
  const [cursos, setCursos] = useState<Curso[] | null>(null);
  const [cursoElegido, setCursoElegido] = useState(cursoIdParam); // '' | id de un curso | 'nuevo'
  const [cursoNuevoNombre, setCursoNuevoNombre] = useState('');
  const [titulo, setTitulo] = useState('');
  const [consigna, setConsigna] = useState('');
  const [modalidad, setModalidad] = useState<ModalidadExamen>('ventana_dias');
  const [duracionMinutos, setDuracionMinutos] = useState('60');
  const [escalaMin, setEscalaMin] = useState('0');
  const [escalaMax, setEscalaMax] = useState('10');
  const [feedbackModo, setFeedbackModo] = useState<FeedbackModo>('manual');
  const [antiCheatOn, setAntiCheatOn] = useState(false);
  const [acPantalla, setAcPantalla] = useState(true);
  const [acPestana, setAcPestana] = useState(true);
  const [acPegado, setAcPegado] = useState(true);

  // Paso 1, opciones avanzadas (plegadas por defecto): distribución esperada (precarga la vara, opcional) y escala de niveles.
  const [avanzadoAbierto, setAvanzadoAbierto] = useState(false);
  const [distOn, setDistOn] = useState(false);
  const [umbralAprobacion, setUmbralAprobacion] = useState('6');
  const [aprobadosPct, setAprobadosPct] = useState('60');
  const [niveles, setNiveles] = useState<NivelForm[]>(nivelesPorDefecto());
  const [nivelesPersonalizar, setNivelesPersonalizar] = useState(false); // muestra el editor de nombres y porcentajes

  // Paso 2: preguntas
  const [preguntas, setPreguntas] = useState<PreguntaForm[]>([preguntaVacia(nivelesPorDefecto())]);
  const [matrices, setMatrices] = useState<MatrizRubrica[]>([]);

  // Duplicar desde un examen existente (?desde=<examenId>): se carga una sola vez y el formulario se precarga con sus datos.
  const [cargandoDesde, setCargandoDesde] = useState(Boolean(desdeParam));
  const [duplicandoTitulo, setDuplicandoTitulo] = useState<string | null>(null);
  const [errorDesde, setErrorDesde] = useState<string | null>(null);
  const desdeIniciado = useRef(false);

  // Paso 5: publicar (el examen ya está creado)
  const [examenCreadoId, setExamenCreadoId] = useState<string | null>(null);
  const [cursoDelExamenId, setCursoDelExamenId] = useState('');
  const [comisiones, setComisiones] = useState<Comision[] | null>(null);
  const [modoPublicar, setModoPublicar] = useState<'nueva' | 'existente'>('nueva');
  const [comisionSeleccionada, setComisionSeleccionada] = useState('');
  const [nombreComision, setNombreComision] = useState('');
  const [textoAlumnos, setTextoAlumnos] = useState('');
  const [linkGenerado, setLinkGenerado] = useState<string | null>(null);
  const [cantidadAlumnos, setCantidadAlumnos] = useState<number | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');

  const alumnosParseados = useMemo(() => parsearAlumnos(textoAlumnos), [textoAlumnos]);

  useEffect(() => {
    if (!docente) return;
    listMatricesRubrica().then(setMatrices).catch(() => setMatrices([]));
    listCursos()
      .then((cs) => {
        setCursos(cs);
        // Sin curso indicado: el primero de la lista, o crear uno si todavía no hay ninguno.
        setCursoElegido((actual) => actual || (cs.length > 0 ? cs[0].id : 'nuevo'));
      })
      .catch(() => {
        setCursos([]);
        setCursoElegido((actual) => actual || 'nuevo');
      });
  }, [docente]);

  useEffect(() => {
    // Una sola vez (aunque el efecto se vuelva a disparar), y el formulario no se muestra hasta que termina:
    // así la precarga nunca pisa lo que el docente ya empezó a tipear.
    if (!docente || !desdeParam || desdeIniciado.current) return;
    desdeIniciado.current = true;
    getExamen(desdeParam)
      .then((examen) => {
        const d = examenAFormulario(examen);
        setCursoElegido(d.cursoId);
        setTitulo(d.titulo);
        setConsigna(d.consigna);
        setModalidad(d.modalidad);
        if (d.duracionMinutos !== null) setDuracionMinutos(d.duracionMinutos);
        setEscalaMin(d.escalaMin);
        setEscalaMax(d.escalaMax);
        setFeedbackModo(d.feedbackModo);
        setAntiCheatOn(d.antiCheat !== null);
        if (d.antiCheat) {
          setAcPantalla(d.antiCheat.pantallaCompleta);
          setAcPestana(d.antiCheat.cambioPestana);
          setAcPegado(d.antiCheat.pegado);
        }
        setDistOn(d.distribucion !== null);
        if (d.distribucion) {
          setUmbralAprobacion(d.distribucion.umbralAprobacion);
          setAprobadosPct(d.distribucion.aprobadosPct);
        }
        setNiveles(d.niveles);
        setPreguntas(d.preguntas);
        setDuplicandoTitulo(examen.titulo);
      })
      .catch((err) => {
        setErrorDesde(
          err instanceof ApiError && err.status === 404
            ? 'No encontramos el examen que querías duplicar (puede que ya no exista). Podés armar uno desde cero.'
            : 'No pudimos cargar el examen que querías duplicar. Podés armar uno desde cero o volver a intentarlo más tarde.',
        );
      })
      .finally(() => setCargandoDesde(false));
  }, [docente, desdeParam]);

  useEffect(() => {
    if (paso !== PASO_PUBLICAR || !cursoDelExamenId) return;
    listComisionesPorCurso(cursoDelExamenId)
      .then((cs) => {
        setComisiones(cs);
        setModoPublicar(cs.length > 0 ? 'existente' : 'nueva');
      })
      .catch(() => setComisiones([]));
  }, [paso, cursoDelExamenId]);

  if (cargando) {
    return (
      <div className="page">
        <p className="muted">Cargando…</p>
      </div>
    );
  }
  if (!docente) {
    return (
      <div className="page">
        <p className="muted">Identificate primero desde el inicio.</p>
      </div>
    );
  }
  if (cargandoDesde) {
    return (
      <div className="page">
        <p className="muted">Cargando el examen que querés duplicar…</p>
      </div>
    );
  }

  // ---------------------------------------------------------------- edición de preguntas
  function actualizarNivel(i: number, campo: keyof NivelForm, valor: string) {
    setNiveles((prev) => prev.map((n, idx) => (idx === i ? { ...n, [campo]: valor } : n)));
  }

  /** Cambia el reparto de porcentajes a uno de los presets (conserva los nombres que el docente haya puesto). */
  function elegirPreset(id: string) {
    setNiveles((prev) => aplicarPreset(prev, id));
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
        pIdx === pi ? { ...p, criterios: p.criterios.map((c, cIdx) => (cIdx === ci ? { ...c, [campo]: valor } : c)) } : p,
      ),
    );
  }

  function alternarDetalleNiveles(pi: number, ci: number) {
    setPreguntas((prev) =>
      prev.map((p, pIdx) =>
        pIdx === pi ? { ...p, criterios: p.criterios.map((c, cIdx) => (cIdx === ci ? { ...c, detallar: !c.detallar } : c)) } : p,
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
                detallar: true, // la matriz ya trae descritos los 5 niveles
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

  // ---------------------------------------------------------------- validación (paso a paso, con mensajes concretos)
  /** Errores de la distribución esperada (solo si se activó); dependen de la escala del primer paso. */
  function validarDistribucion(): string[] {
    const e: string[] = [];
    if (!distOn) return e;
    if (!esNumero(umbralAprobacion) || Number(umbralAprobacion) < Number(escalaMin) || Number(umbralAprobacion) > Number(escalaMax)) {
      e.push(`La nota de aprobación tiene que estar entre ${escalaMin} y ${escalaMax} (la escala del examen).`);
    }
    if (!esNumero(aprobadosPct) || Number(aprobadosPct) < 0 || Number(aprobadosPct) > 100) e.push('El porcentaje de aprobados esperado tiene que estar entre 0 y 100.');
    return e;
  }

  function validarPaso(p: number): string[] {
    const e: string[] = [];
    if (p === 0) {
      if (!titulo.trim()) e.push('Falta el título del examen.');
      if (!consigna.trim()) e.push('Falta la consigna o las instrucciones generales.');
      if (cursoElegido === 'nuevo' ? !cursoNuevoNombre.trim() : !cursoElegido) {
        e.push(cursoElegido === 'nuevo' ? 'Falta el nombre del curso nuevo.' : 'Elegí un curso.');
      }
      if (!esNumero(escalaMin) || !esNumero(escalaMax)) e.push('La escala necesita un mínimo y un máximo numéricos.');
      else if (Number(escalaMin) >= Number(escalaMax)) e.push('La escala mínima tiene que ser menor que la máxima.');
      if (modalidad === 'sesion_tiempo' && !(Number(duracionMinutos) >= 1)) e.push('La duración tiene que ser de al menos 1 minuto.');
      e.push(...validarNiveles(niveles), ...validarDistribucion());
    }
    if (p === PASO_PREGUNTAS) {
      preguntas.forEach((q, i) => {
        const n = `Pregunta ${i + 1}`;
        if (!q.enunciado.trim()) e.push(`${n}: falta el enunciado.`);
        if (TIPOS_AUTOCORREGIBLES.includes(q.tipo)) {
          if (!(Number(q.puntajeMaximo) > 0)) e.push(`${n}: falta el puntaje máximo.`);
          if (q.tipo === 'opcion_multiple' || q.tipo === 'casillas') {
            const llenas = q.opcionesChoice.filter((o) => o.texto.trim());
            if (llenas.length < 2) e.push(`${n}: cargá al menos 2 opciones con texto.`);
            else if (!llenas.some((o) => o.correcta)) e.push(`${n}: marcá cuál es la opción correcta${q.tipo === 'casillas' ? ' (o cuáles)' : ''}.`);
          }
          if (q.tipo === 'numerica') {
            if (!esNumero(q.numRespuestaCorrecta)) e.push(`${n}: falta la respuesta correcta (un número).`);
            if (q.numTolerancia.trim() !== '' && !(Number(q.numTolerancia) >= 0)) e.push(`${n}: la tolerancia tiene que ser 0 o más.`);
          }
          if (q.tipo === 'relacionar_pares') {
            const incompletos = q.paresIzquierda.some((izq, k) => !izq.trim() || !(q.paresDerecha[k] ?? '').trim());
            if (q.paresIzquierda.length < 2 || incompletos) e.push(`${n}: completá los dos lados de cada par (mínimo 2 pares).`);
          }
        } else {
          const filas = q.criterios;
          const completos = filas.filter((c) => c.nombre.trim() && Number(c.puntajeMaximo) > 0);
          if (completos.length === 0) e.push(`${n}: agregá al menos un criterio con su nombre y su puntaje.`);
          filas.forEach((c, k) => {
            const algo = c.nombre.trim() || c.descripcion.trim() || c.puntajeMaximo.trim();
            if (!algo) return;
            const cn = `${n}, criterio ${k + 1}`;
            if (!c.nombre.trim()) e.push(`${cn}: falta el nombre.`);
            if (!(Number(c.puntajeMaximo) > 0)) e.push(`${cn}: falta el puntaje.`);
            if (!c.descripcion.trim()) e.push(`${cn}: falta qué se espera para cumplirlo.`);
            const llenos = c.niveles.filter((nv) => nv.descripcion.trim()).length;
            if (c.detallar && llenos > 0 && llenos < c.niveles.length) e.push(`${cn}: describí los 5 niveles o dejá el detalle vacío.`);
          });
        }
      });
      // La nota es la suma de puntos y la escala no se normaliza: el total de las preguntas tiene que ser la escala máxima.
      const total = totalDelExamen(preguntas);
      if (esNumero(escalaMax) && !totalCoincideConEscala(total, Number(escalaMax))) {
        const puedeCambiarEscala = !esNumero(escalaMin) || total > Number(escalaMin);
        e.push(
          `El total de puntos de las preguntas (${formatearPuntos(total)}) tiene que ser igual a la escala máxima (${formatearPuntos(Number(escalaMax))}). ` +
            `Ajustá los puntajes de las preguntas${puedeCambiarEscala ? ` o cambiá la escala máxima a ${formatearPuntos(total)}` : ''}.`,
        );
      }
    }
    return e;
  }

  /** Un error de las opciones avanzadas no se ve si el bloque está plegado: se abre para que el motivo quede a la vista. */
  const hayErrorAvanzado = () => validarNiveles(niveles).length > 0 || validarDistribucion().length > 0;

  function irASiguiente() {
    const e = validarPaso(paso);
    setErrores(e);
    if (e.length > 0 && paso === 0 && hayErrorAvanzado()) setAvanzadoAbierto(true);
    if (e.length === 0) setPaso(paso + 1);
  }

  function irAPaso(i: number) {
    if (examenCreadoId || i >= paso) return; // con el examen ya creado no se vuelve a editar
    setErrores([]);
    setPaso(i);
  }

  async function handleCrearExamen() {
    // Se revisa todo junto: si algo de un paso anterior quedó mal, se vuelve ahí con el motivo.
    for (const p of [0, PASO_PREGUNTAS]) {
      const e = validarPaso(p);
      if (e.length > 0) {
        setErrores(e);
        if (p === 0 && hayErrorAvanzado()) setAvanzadoAbierto(true);
        setPaso(p);
        return;
      }
    }
    setErrores([]);
    setLoading(true);
    try {
      let cursoId = cursoElegido;
      if (cursoElegido === 'nuevo') {
        const nuevo = await createCurso({ nombre: cursoNuevoNombre.trim() });
        cursoId = nuevo.id;
        // Si lo que sigue falla, un reintento no tiene que crear otro curso igual.
        setCursos((prev) => [...(prev ?? []), nuevo]);
        setCursoElegido(nuevo.id);
      }
      const examen = await createExamen({
        cursoId,
        titulo: titulo.trim(),
        consigna: consigna.trim(),
        modalidad,
        duracionMinutos: modalidad === 'sesion_tiempo' ? Number(duracionMinutos) : undefined,
        escalaMin: Number(escalaMin),
        escalaMax: Number(escalaMax),
        niveles: niveles.map((n) => ({ orden: n.orden, nombre: n.nombre, colorHex: n.colorHex, porcentaje: Number(n.porcentaje) })),
        feedbackModo,
        distribucionEsperada: distOn ? { umbralAprobacion: Number(umbralAprobacion), aprobadosEsperadosPct: Number(aprobadosPct) } : undefined,
        antiCheat: antiCheatOn ? { pantallaCompleta: acPantalla, cambioPestana: acPestana, pegado: acPegado } : undefined,
        preguntas: preguntas.map((p) => {
          const cerrada = TIPOS_AUTOCORREGIBLES.includes(p.tipo);
          return {
            tipo: p.tipo,
            enunciado: p.enunciado.trim(),
            // En las abiertas el puntaje de la pregunta es la suma de sus criterios.
            puntajeMaximo: cerrada ? Number(p.puntajeMaximo) : puntajeDeCriterios(p),
            opciones: cerrada ? construirOpciones(p) : undefined,
            criterios: cerrada
              ? undefined
              : p.criterios
                  .filter((c) => c.nombre.trim() && Number(c.puntajeMaximo) > 0)
                  .map((c) => ({
                    matrizOrigenId: c.matrizOrigenId,
                    nombre: c.nombre.trim(),
                    descripcion: c.descripcion.trim(),
                    puntajeMaximo: Number(c.puntajeMaximo),
                    // Solo si el docente describió los 5 niveles.
                    nivelesDescripcion: c.niveles.every((nv) => nv.descripcion.trim()) ? c.niveles : undefined,
                  })),
          };
        }),
      });
      setExamenCreadoId(examen.id);
      setCursoDelExamenId(cursoId);
      setNombreComision(titulo.trim());
      setPaso(PASO_PUBLICAR);
    } catch (err) {
      const detalle = mensajesDelServidor(err);
      setErrores([
        'No se pudo crear el examen. Tus datos siguen acá: corregí lo que se indica y probá de nuevo.',
        ...detalle.slice(0, 5).map((d) => `Detalle: ${d}`),
      ]);
      setPaso(PASO_PREGUNTAS);
    } finally {
      setLoading(false);
    }
  }

  async function handlePublicar() {
    if (!examenCreadoId) return;
    setErrores([]);
    let comisionId = comisionSeleccionada;
    if (modoPublicar === 'nueva') {
      if (!nombreComision.trim()) return setErrores(['Poné un nombre para el grupo de alumnos (por ejemplo, "Comisión A").']);
      if (alumnosParseados.alumnos.length === 0) return setErrores(['Pegá la lista de alumnos: uno por línea, con su email.']);
      if (alumnosParseados.errores.length > 0) return setErrores(alumnosParseados.errores);
    } else if (!comisionId) {
      return setErrores(['Elegí una comisión.']);
    }

    setLoading(true);
    try {
      let cantidad: number | null = null;
      if (modoPublicar === 'nueva') {
        cantidad = alumnosParseados.alumnos.length;
        const creada = await createComision(cursoDelExamenId, { nombre: nombreComision.trim(), alumnos: alumnosParseados.alumnos });
        comisionId = creada.id;
        // Si publicar falla, un reintento usa esta misma comisión en vez de crear otra.
        setComisiones((prev) => [...(prev ?? []), creada]);
        setComisionSeleccionada(creada.id);
        setModoPublicar('existente');
      }
      const resultado = await publicarExamenAComision(examenCreadoId, {
        comisionId,
        fechaInicio: fechaLocalAIso(fechaInicio),
        fechaFin: fechaLocalAIso(fechaFin),
      });
      if (cantidad === null) cantidad = (comisiones ?? []).find((c) => c.id === comisionId)?._count?.alumnos ?? null;
      setCantidadAlumnos(cantidad);
      setLinkGenerado(resultado.urlAcceso ?? null);
    } catch (err) {
      const detalle = mensajesDelServidor(err);
      setErrores(['No se pudo publicar el examen.', ...detalle.slice(0, 3)]);
    } finally {
      setLoading(false);
    }
  }

  async function copiar(que: string, texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(que);
      setTimeout(() => setCopiado((c) => (c === que ? null : c)), 2000);
    } catch {
      setErrores(['No se pudo copiar automáticamente: seleccioná el texto y copialo a mano.']);
    }
  }

  // Escala de niveles (opciones avanzadas): preset activo, ejemplo en vivo y errores de las reglas.
  const presetActual = presetDe(niveles);
  const nivelEjemplo = niveles[2];
  const puntosEjemplo = nivelEjemplo ? puntosDeEjemplo(nivelEjemplo.porcentaje) : null;
  const erroresNiveles = validarNiveles(niveles);
  const avanzadoConError = erroresNiveles.length > 0 || validarDistribucion().length > 0;

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">Nuevo examen</div>
        <h1>{titulo || 'Configurar examen'}</h1>
      </header>

      {duplicandoTitulo !== null && (
        <div className="card" style={{ marginBottom: 20 }}>
          Estás duplicando «{duplicandoTitulo}». Revisá y ajustá lo que quieras: se crea como un examen nuevo y el original no cambia.
        </div>
      )}
      {errorDesde && (
        <div className="error-box" role="alert">
          {errorDesde}
        </div>
      )}

      <div className="stepper">
        {PASOS.map((label, i) => {
          const estado = i < paso ? 'done' : i === paso ? 'current' : 'pending';
          const volverPosible = !examenCreadoId && i < paso;
          return (
            <div
              className="step"
              key={label}
              data-state={estado}
              aria-current={estado === 'current' ? 'step' : undefined}
              role={volverPosible ? 'button' : undefined}
              tabIndex={volverPosible ? 0 : undefined}
              onClick={volverPosible ? () => irAPaso(i) : undefined}
              onKeyDown={
                volverPosible
                  ? (ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        irAPaso(i);
                      }
                    }
                  : undefined
              }
              title={volverPosible ? 'Volver a este paso' : undefined}
            >
              <span className="step-num">{estado === 'done' ? `✓ ${i + 1}` : i + 1}</span>
              <span className="step-label">{label}</span>
            </div>
          );
        })}
      </div>

      {errores.length > 0 && (
        <div className="error-box" role="alert">
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

      {paso === 0 && (
        <div>
          <div className="field">
            <label htmlFor="curso">Curso</label>
            <select id="curso" value={cursoElegido} onChange={(e) => setCursoElegido(e.target.value)} disabled={cursos === null}>
              {(cursos ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
              <option value="nuevo">+ Crear un curso nuevo…</option>
            </select>
          </div>
          {cursoElegido === 'nuevo' && (
            <div className="field">
              <label htmlFor="cursoNuevo">Nombre del curso nuevo</label>
              <input id="cursoNuevo" value={cursoNuevoNombre} onChange={(e) => setCursoNuevoNombre(e.target.value)} placeholder="Ej: Datos II - Lunes tarde" />
            </div>
          )}
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
          <p className="muted" style={{ fontSize: 13, margin: '-6px 0 16px' }}>
            El total de puntos de las preguntas tiene que sumar la escala máxima.
            {esNumero(escalaMin) && Number(escalaMin) !== 0 && (
              <>
                <br />
                La nota se calcula como la suma de puntos (de 0 al total): la escala mínima solo se usa para acotar el ajuste de vara.
              </>
            )}
          </p>
          <div className="field">
            <label htmlFor="feedbackModo">Liberación de feedback</label>
            <select id="feedbackModo" value={feedbackModo} onChange={(e) => setFeedbackModo(e.target.value as FeedbackModo)}>
              <option value="manual">Manual (el docente libera el feedback cuando quiere)</option>
              <option value="inmediato">Inmediato (apenas el docente termina de revisar cada respuesta)</option>
            </select>
          </div>
          <div className="card" style={{ marginBottom: 16 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
              <input type="checkbox" checked={antiCheatOn} onChange={(e) => setAntiCheatOn(e.target.checked)} />
              Registrar señales de integridad durante el examen
            </label>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              Solo se registran eventos (no se bloquea nada ni se baja la nota): vos los ves junto a cada respuesta y decidís. Antes de
              empezar, el alumno ve exactamente qué se monitorea y tiene que aceptarlo.
            </p>
            {antiCheatOn && (
              <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                <label style={{ display: 'flex', gap: 8 }}>
                  <input type="checkbox" checked={acPantalla} onChange={(e) => setAcPantalla(e.target.checked)} />
                  Pantalla completa: registra cada vez que el alumno sale de ella
                </label>
                <label style={{ display: 'flex', gap: 8 }}>
                  <input type="checkbox" checked={acPestana} onChange={(e) => setAcPestana(e.target.checked)} />
                  Cambio de pestaña o ventana
                </label>
                <label style={{ display: 'flex', gap: 8 }}>
                  <input type="checkbox" checked={acPegado} onChange={(e) => setAcPegado(e.target.checked)} />
                  Pegado de texto en las respuestas
                </label>
                {!acPantalla && !acPestana && !acPegado && <p className="muted">Sin ningún control marcado, el examen se rinde sin monitoreo.</p>}
                {modalidad === 'ventana_dias' && (
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
                onClick={() => setAvanzadoAbierto((v) => !v)}
                aria-expanded={avanzadoAbierto}
                aria-controls="opciones-avanzadas"
              >
                <svg className="chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 2l4 4-4 4" />
                </svg>
                Opciones avanzadas
                <span className={avanzadoConError ? 'accordion-summary-error' : 'accordion-summary'}>
                  · Exigencia: {resumenNiveles(niveles)} · {distOn ? `esperás ${aprobadosPct} % de aprobados` : 'sin expectativa de aprobados'}
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

                <button type="button" className="btn btn-ghost" onClick={() => setNivelesPersonalizar((v) => !v)} aria-expanded={nivelesPersonalizar}>
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
                  <input type="checkbox" checked={distOn} onChange={(e) => setDistOn(e.target.checked)} />
                  Definir una expectativa de aprobados
                </label>
                {distOn && (
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <div className="field" style={{ width: 220 }}>
                      <label htmlFor="umbral-aprob">Nota de aprobación</label>
                      <input id="umbral-aprob" type="number" step="any" value={umbralAprobacion} onChange={(e) => setUmbralAprobacion(e.target.value)} />
                    </div>
                    <div className="field" style={{ width: 220 }}>
                      <label htmlFor="pct-aprob">Aprobados esperados (%)</label>
                      <input id="pct-aprob" type="number" min="0" max="100" value={aprobadosPct} onChange={(e) => setAprobadosPct(e.target.value)} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {paso === PASO_PREGUNTAS && (
        <div>
          {(() => {
            // Total a la vista mientras se arman las preguntas: tiene que ser igual a la escala máxima.
            const total = totalDelExamen(preguntas);
            const max = esNumero(escalaMax) ? Number(escalaMax) : null;
            const coincide = max !== null && totalCoincideConEscala(total, max);
            const diferencia = max !== null ? redondearPuntos(max - total) : 0; // > 0: faltan puntos; < 0: sobran
            const puedeUsarComoEscala = max !== null && !coincide && (!esNumero(escalaMin) || total > Number(escalaMin));
            return (
              <div
                className="card"
                role="status"
                style={{
                  position: 'sticky',
                  top: 60, // debajo de la barra superior (que también es sticky)
                  zIndex: 25,
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  marginBottom: 16,
                  borderColor: coincide ? 'var(--color-success)' : 'var(--color-accent)',
                  color: coincide ? 'var(--color-success)' : 'var(--color-accent-800)',
                }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                  <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                    Total del examen: {formatearPuntos(total)}
                    {max !== null && ` de ${formatearPuntos(max)}`} pts
                  </strong>
                  {max !== null && (
                    <span className={`badge ${coincide ? 'badge-revisado' : 'badge-pendiente'}`}>
                      {coincide ? 'OK' : diferencia > 0 ? `Faltan ${formatearPuntos(diferencia)} pts` : `Sobran ${formatearPuntos(-diferencia)} pts`}
                    </span>
                  )}
                </div>
                {puedeUsarComoEscala && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setEscalaMax(String(redondearPuntos(total)));
                      setErrores([]);
                    }}
                  >
                    Usar {formatearPuntos(total)} como escala máxima
                  </button>
                )}
              </div>
            );
          })()}
          {preguntas.map((p, pi) => {
            const cerrada = TIPOS_AUTOCORREGIBLES.includes(p.tipo);
            return (
              <div key={pi} className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                  <strong style={{ alignSelf: 'center' }}>{pi + 1}.</strong>
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

                {cerrada && (
                  <div className="field" style={{ maxWidth: 160 }}>
                    <label>Puntaje máximo</label>
                    <input type="number" min="0.5" step="0.5" value={p.puntajeMaximo} onChange={(e) => actualizarPregunta(pi, 'puntajeMaximo', e.target.value)} />
                  </div>
                )}

                {!cerrada && (
                  <div>
                    <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
                      Rúbrica: un criterio por fila, con su puntaje. La IA evalúa la respuesta contra estos criterios y el puntaje de la
                      pregunta es la suma de ellos ({puntajeDeCriterios(p)} pts).
                    </div>
                    {matrices.length > 0 && (
                      <select defaultValue="" onChange={(e) => e.target.value && usarMatriz(pi, e.target.value)} style={{ marginBottom: 14 }}>
                        <option value="">Partir de una matriz existente…</option>
                        {matrices.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.nombre}
                          </option>
                        ))}
                      </select>
                    )}

                    {p.criterios.map((c, ci) => (
                      <div key={ci} style={{ marginBottom: 12 }}>
                        <div className="criterio-row">
                          <input placeholder="Criterio (ej: Claridad del argumento)" value={c.nombre} onChange={(e) => actualizarCriterio(pi, ci, 'nombre', e.target.value)} />
                          <input placeholder="Qué se espera para cumplirlo" value={c.descripcion} onChange={(e) => actualizarCriterio(pi, ci, 'descripcion', e.target.value)} />
                          <input type="number" min="0.5" step="0.5" placeholder="Pts" value={c.puntajeMaximo} onChange={(e) => actualizarCriterio(pi, ci, 'puntajeMaximo', e.target.value)} />
                          <button type="button" className="btn btn-secondary" onClick={() => quitarCriterio(pi, ci)} disabled={p.criterios.length === 1}>
                            Quitar
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => alternarDetalleNiveles(pi, ci)}
                          style={{ background: 'none', border: 0, padding: '4px 0', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit', fontSize: 13 }}
                        >
                          {c.detallar ? 'Ocultar el detalle por nivel' : 'Detallar qué implica cada nivel (opcional)'}
                        </button>
                        {c.detallar &&
                          c.niveles.map((n, ni) => (
                            <div key={ni} className="nivel-row" style={{ marginTop: 8, marginBottom: 0 }}>
                              <div className="nivel-label">
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
            );
          })}
          <button type="button" className="btn btn-secondary" onClick={agregarPregunta}>
            + Agregar pregunta
          </button>
        </div>
      )}

      {paso === PASO_PUBLICAR && (
        <div>
          {!linkGenerado && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 6 }}>
                ¿Quiénes lo rinden?
              </div>
              <p className="muted" style={{ marginBottom: 14 }}>
                Cada alumno entra al link con el email con el que figura en la lista: cargalos tal cual los usan (no distingue mayúsculas).
              </p>

              {comisiones && comisiones.length > 0 && (
                <div style={{ display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', gap: 6 }}>
                    <input type="radio" name="modoPublicar" checked={modoPublicar === 'nueva'} onChange={() => setModoPublicar('nueva')} />
                    Pegar una lista de alumnos
                  </label>
                  <label style={{ display: 'flex', gap: 6 }}>
                    <input type="radio" name="modoPublicar" checked={modoPublicar === 'existente'} onChange={() => setModoPublicar('existente')} />
                    Usar una comisión que ya tengo
                  </label>
                </div>
              )}

              {modoPublicar === 'existente' ? (
                <div className="field">
                  <select value={comisionSeleccionada} onChange={(e) => setComisionSeleccionada(e.target.value)}>
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
                    <label htmlFor="nombreComision">Nombre del grupo</label>
                    <input id="nombreComision" value={nombreComision} onChange={(e) => setNombreComision(e.target.value)} placeholder="Ej: Comisión A" />
                  </div>
                  <div className="field">
                    <label htmlFor="alumnos">Alumnos</label>
                    <textarea
                      id="alumnos"
                      value={textoAlumnos}
                      onChange={(e) => setTextoAlumnos(e.target.value)}
                      style={{ minHeight: 140 }}
                      placeholder={'Uno por línea. Con el email alcanza; si querés, el nombre antes:\nAna Pérez, ana@mail.com\nluis@mail.com'}
                    />
                    <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                      {textoAlumnos.trim()
                        ? `${alumnosParseados.alumnos.length} alumno${alumnosParseados.alumnos.length === 1 ? '' : 's'} listo${alumnosParseados.alumnos.length === 1 ? '' : 's'}` +
                          (alumnosParseados.errores.length ? ` · ${alumnosParseados.errores.length} línea${alumnosParseados.errores.length === 1 ? '' : 's'} con problemas` : '')
                        : 'Podés pegar directamente desde una planilla.'}
                    </div>
                    {alumnosParseados.errores.length > 0 && (
                      <ul className="muted" style={{ fontSize: 13, margin: '6px 0 0', paddingLeft: 20 }}>
                        {alumnosParseados.errores.slice(0, 5).map((m, i) => (
                          <li key={i}>{m}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}

              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div className="field" style={{ flex: 1, minWidth: 220 }}>
                  <label htmlFor="fechaInicio">Se habilita (opcional)</label>
                  <input id="fechaInicio" type="datetime-local" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 220 }}>
                  <label htmlFor="fechaFin">Cierra (opcional)</label>
                  <input id="fechaFin" type="datetime-local" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
                </div>
              </div>
              <p className="muted" style={{ marginBottom: 12 }}>
                Si el examen tiene duración, cada alumno tiene ese tiempo desde que empieza, pero nunca más allá de la fecha de cierre.
              </p>
              <button className="btn btn-primary" onClick={handlePublicar} disabled={loading}>
                {loading ? 'Publicando…' : 'Generar link de acceso'}
              </button>
            </div>
          )}

          {linkGenerado && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 8 }}>
                Listo: el examen está publicado
              </div>
              <p className="muted" style={{ marginBottom: 6 }}>Link para los alumnos:</p>
              <p style={{ wordBreak: 'break-all', marginBottom: 10 }}>{linkGenerado}</p>
              <button type="button" className="btn btn-secondary" onClick={() => copiar('link', linkGenerado)} style={{ marginBottom: 20 }}>
                {copiado === 'link' ? '¡Copiado!' : 'Copiar link'}
              </button>

              <p className="muted" style={{ marginBottom: 20 }}>
                {cantidadAlumnos !== null ? `Los ${cantidadAlumnos} alumnos del listado` : 'Los alumnos del listado'} entran con su email: no necesitan ningún código.
              </p>

              <div>
                <button className="btn btn-primary" onClick={() => router.push(`/examenes/${examenCreadoId}`)}>
                  Ir al examen
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {paso < PASO_PUBLICAR && (
        <div style={{ marginTop: 28, display: 'flex', gap: 12 }}>
          {paso > 0 && (
            <button type="button" className="btn btn-secondary" onClick={() => irAPaso(paso - 1)} disabled={loading}>
              Atrás
            </button>
          )}
          {paso < PASO_PREGUNTAS ? (
            <button type="button" className="btn btn-primary" onClick={irASiguiente}>
              Siguiente
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={handleCrearExamen} disabled={loading}>
              {loading ? 'Creando…' : 'Crear examen y continuar'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
