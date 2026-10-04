'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
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
  listComisionesPorCurso,
  listCursos,
  listMatricesRubrica,
  publicarExamenAComision,
} from '@/lib/api';
import { useSesion } from '@/lib/auth';

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

// Un criterio es una fila como en los trabajos prácticos: qué se evalúa, qué se espera y cuántos puntos vale.
// Describir cada uno de los 5 niveles es opcional (se abre a pedido).
interface CriterioForm {
  matrizOrigenId?: string;
  nombre: string;
  descripcion: string;
  puntajeMaximo: string;
  detallar: boolean;
  niveles: { orden: number; nombre: string; descripcion: string }[];
}

function criterioVacio(niveles: NivelForm[]): CriterioForm {
  return {
    nombre: '',
    descripcion: '',
    puntajeMaximo: '',
    detallar: false,
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

const PASOS = ['Datos', 'Escala y niveles', 'Distribución esperada', 'Preguntas', 'Publicar'];
const PASO_PREGUNTAS = 3;
const PASO_PUBLICAR = 4;

const esNumero = (v: string) => v.trim() !== '' && Number.isFinite(Number(v));

/** Suma de puntos de los criterios completos de una pregunta abierta. */
function puntajeDeCriterios(p: PreguntaForm): number {
  return p.criterios.filter((c) => c.nombre.trim() && Number(c.puntajeMaximo) > 0).reduce((s, c) => s + Number(c.puntajeMaximo), 0);
}

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

  // Paso 3: distribución esperada (precarga la vara). Opcional.
  const [distOn, setDistOn] = useState(false);
  const [umbralAprobacion, setUmbralAprobacion] = useState('6');
  const [aprobadosPct, setAprobadosPct] = useState('60');

  // Paso 2: niveles
  const [niveles, setNiveles] = useState<NivelForm[]>(nivelesPorDefecto());

  // Paso 4: preguntas
  const [preguntas, setPreguntas] = useState<PreguntaForm[]>([preguntaVacia(nivelesPorDefecto())]);
  const [matrices, setMatrices] = useState<MatrizRubrica[]>([]);

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

  // ---------------------------------------------------------------- edición de preguntas
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

  function construirOpciones(p: PreguntaForm): unknown {
    switch (p.tipo) {
      case 'opcion_multiple':
      case 'casillas':
        return p.opcionesChoice.filter((o) => o.texto.trim()).map((o) => ({ id: o.id, texto: o.texto, correcta: o.correcta }));
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

  // ---------------------------------------------------------------- validación (paso a paso, con mensajes concretos)
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
    }
    if (p === 1) {
      niveles.forEach((n) => {
        if (!n.nombre.trim()) e.push(`El nivel ${n.orden} necesita un nombre.`);
        if (!esNumero(n.porcentaje) || Number(n.porcentaje) < 0 || Number(n.porcentaje) > 100) e.push(`El nivel ${n.orden} (${n.nombre || 'sin nombre'}) necesita un porcentaje entre 0 y 100.`);
      });
    }
    if (p === 2 && distOn) {
      if (!esNumero(umbralAprobacion) || Number(umbralAprobacion) < Number(escalaMin) || Number(umbralAprobacion) > Number(escalaMax)) {
        e.push(`La nota de aprobación tiene que estar entre ${escalaMin} y ${escalaMax} (la escala del examen).`);
      }
      if (!esNumero(aprobadosPct) || Number(aprobadosPct) < 0 || Number(aprobadosPct) > 100) e.push('El porcentaje de aprobados esperado tiene que estar entre 0 y 100.');
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
    }
    return e;
  }

  function irASiguiente() {
    const e = validarPaso(paso);
    setErrores(e);
    if (e.length === 0) setPaso(paso + 1);
  }

  function irAPaso(i: number) {
    if (examenCreadoId || i >= paso) return; // con el examen ya creado no se vuelve a editar
    setErrores([]);
    setPaso(i);
  }

  async function handleCrearExamen() {
    // Se revisa todo junto: si algo de un paso anterior quedó mal, se vuelve ahí con el motivo.
    for (const p of [0, 1, 2, PASO_PREGUNTAS]) {
      const e = validarPaso(p);
      if (e.length > 0) {
        setErrores(e);
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

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">Nuevo examen</div>
        <h1>{titulo || 'Configurar examen'}</h1>
      </header>

      <div className="stepper">
        {PASOS.map((label, i) => {
          const volverPosible = !examenCreadoId && i < paso;
          return (
            <div
              className="step"
              key={label}
              onClick={volverPosible ? () => irAPaso(i) : undefined}
              style={volverPosible ? { cursor: 'pointer' } : undefined}
              title={volverPosible ? 'Volver a este paso' : undefined}
            >
              <span className="step-num">{i + 1}</span>
              <span className="step-label" style={{ opacity: i === paso ? 1 : 0.5 }}>
                {label}
              </span>
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
        </div>
      )}

      {paso === 1 && (
        <div>
          <p className="muted" style={{ marginBottom: 16 }}>
            5 niveles de desempeño, cada uno con el % del puntaje de un criterio que representa. Se usan en todas
            las preguntas abiertas de este examen. Los valores por defecto sirven para la mayoría de los casos.
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
            ¿Qué distribución esperás? (opcional)
          </div>
          <p className="muted" style={{ marginBottom: 12 }}>
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

      {paso === PASO_PREGUNTAS && (
        <div>
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
                Cada alumno entra al link con su email y un código personal que se genera acá. Así nadie puede rendir en nombre de otro.
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
