const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Error ${res.status} en ${path}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ---- Tipos (reflejan el schema de Prisma) ----

export interface Docente {
  id: string;
  nombre: string;
  email: string;
}

export interface CriterioRubrica {
  id: string;
  nombre: string;
  descripcion: string;
  puntajeMaximo: string; // Prisma Decimal -> string en JSON
  orden: number;
}

export interface TrabajoPractico {
  id: string;
  titulo: string;
  materia: string | null;
  consigna: string;
  createdAt: string;
  criterios: CriterioRubrica[];
  _count?: { entregas: number };
  entregas?: Entrega[];
}

export type EstadoEntrega = 'pendiente_correccion' | 'corregido' | 'revisado';
export type EstadoRevision = 'pendiente' | 'aceptada' | 'editada';

export interface NotaPorCriterio {
  criterioId: string;
  nombre: string;
  notaSugerida: number;
  comentario: string;
}

export interface Correccion {
  id: string;
  modeloIa: string;
  notaPorCriterio: NotaPorCriterio[];
  notaTotalSugerida: string;
  feedbackSugerido: string;
  notaTotalFinal: string | null;
  feedbackFinal: string | null;
  estadoRevision: EstadoRevision;
}

export interface Entrega {
  id: string;
  alumnoNombre: string;
  alumnoEmail: string | null;
  textoTrabajo: string;
  estado: EstadoEntrega;
  createdAt: string;
  correccion: Correccion | null;
}

export interface ResumenCurso {
  id: string;
  contenido: string;
  cantidadEntregasAnalizadas: number;
  modeloIa: string;
  generadoEn: string;
}

// ---- Docentes ----

export const findOrCreateDocente = (data: { nombre: string; email: string }) =>
  request<Docente>('/docentes', { method: 'POST', body: JSON.stringify(data) });

// ---- Trabajos prácticos ----

export const listTrabajosPracticos = () => request<TrabajoPractico[]>('/trabajos-practicos');

export const getTrabajoPractico = (id: string) => request<TrabajoPractico>(`/trabajos-practicos/${id}`);

export const createTrabajoPractico = (data: {
  docenteId: string;
  titulo: string;
  materia?: string;
  consigna: string;
  criterios: { nombre: string; descripcion: string; puntajeMaximo: number }[];
}) => request<TrabajoPractico>('/trabajos-practicos', { method: 'POST', body: JSON.stringify(data) });

// ---- Entregas ----

export const getEntrega = (id: string) =>
  request<Entrega & { trabajoPractico: TrabajoPractico }>(`/entregas/${id}`);

export const createEntrega = (data: {
  trabajoPracticoId: string;
  alumnoNombre: string;
  alumnoEmail?: string;
  textoTrabajo: string;
}) => request<Entrega>('/entregas', { method: 'POST', body: JSON.stringify(data) });

export const recorregirEntrega = (entregaId: string) =>
  request<Entrega>(`/entregas/${entregaId}/recorregir`, { method: 'POST' });

// ---- Correcciones ----

export const revisarCorreccion = (
  entregaId: string,
  data: { estadoRevision: 'aceptada' | 'editada'; notaTotalFinal?: number; feedbackFinal?: string },
) =>
  request<Correccion>(`/entregas/${entregaId}/correccion`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

// ---- Resumen de curso ----

export const generarResumenCurso = (trabajoPracticoId: string) =>
  request<ResumenCurso>(`/trabajos-practicos/${trabajoPracticoId}/resumen-curso`, { method: 'POST' });

export const getUltimoResumenCurso = (trabajoPracticoId: string) =>
  request<ResumenCurso | null>(`/trabajos-practicos/${trabajoPracticoId}/resumen-curso`);

// ============================================================================
// Cátedra: exámenes con preguntas tipadas, cursos/comisiones y vara.
// Feature-set nuevo, en paralelo al flujo de arriba (TrabajoPractico/Entrega).
// ============================================================================

export interface Curso {
  id: string;
  nombre: string;
  materia: string | null;
  createdAt: string;
  _count?: { comisiones: number; examenes: number };
  comisiones?: Comision[];
  examenes?: Examen[];
}

export interface Comision {
  id: string;
  cursoId: string;
  nombre: string;
  createdAt: string;
  _count?: { alumnos: number };
  alumnos?: Alumno[];
}

export interface Alumno {
  id: string;
  comisionId: string;
  nombre: string;
  email: string;
  createdAt: string;
}

export interface NivelDescripcion {
  orden: number;
  nombre: string;
  descripcion: string;
}

export interface CriterioMatriz {
  id: string;
  nombre: string;
  descripcion: string;
  puntajeMaximo: string;
  orden: number;
  nivelesDescripcion: NivelDescripcion[];
}

export interface MatrizRubrica {
  id: string;
  docenteId: string;
  nombre: string;
  descripcion: string | null;
  createdAt: string;
  criterios: CriterioMatriz[];
}

export type TipoPregunta =
  | 'desarrollo'
  | 'resolucion_problema'
  | 'demostracion'
  | 'analisis_caso'
  | 'respuesta_corta'
  | 'numerica'
  | 'relacionar_pares'
  | 'opcion_multiple'
  | 'casillas'
  | 'verdadero_falso';

export const TIPOS_AUTOCORREGIBLES: TipoPregunta[] = [
  'numerica',
  'relacionar_pares',
  'opcion_multiple',
  'casillas',
  'verdadero_falso',
];

export type ModalidadExamen = 'sesion_tiempo' | 'ventana_dias';
export type FeedbackModo = 'inmediato' | 'manual';
export type EstadoExamen = 'borrador' | 'publicado' | 'cerrado';

export interface NivelEscala {
  orden: number;
  nombre: string;
  colorHex: string;
  porcentaje: number;
}

export interface CriterioPregunta {
  id: string;
  nombre: string;
  descripcion: string;
  puntajeMaximo: string;
  orden: number;
  matrizOrigenId: string | null;
  nivelesDescripcion: NivelDescripcion[];
}

export interface Pregunta {
  id: string;
  tipo: TipoPregunta;
  enunciado: string;
  orden: number;
  puntajeMaximo: string;
  opciones: unknown;
  criterios?: CriterioPregunta[];
}

export interface ExamenComision {
  id: string;
  examenId: string;
  comisionId: string;
  slugAcceso: string;
  fechaInicio: string | null;
  fechaFin: string | null;
  createdAt: string;
  comision?: Comision;
  urlAcceso?: string;
}

export interface Examen {
  id: string;
  cursoId: string;
  titulo: string;
  consigna: string;
  modalidad: ModalidadExamen;
  duracionMinutos: number | null;
  escalaMin: string;
  escalaMax: string;
  niveles: NivelEscala[];
  varaPorcentaje: string;
  feedbackModo: FeedbackModo;
  feedbackLiberadoEn: string | null;
  estado: EstadoExamen;
  createdAt: string;
  preguntas?: Pregunta[];
  comisiones?: ExamenComision[];
  _count?: { preguntas: number; respuestas: number };
}

export interface NotaPorCriterioPregunta {
  criterioId: string;
  nombre: string;
  nivelSugerido: number;
  notaSugerida: number;
  comentario: string;
}

export interface RespuestaPorPreguntaItem {
  preguntaId: string;
  contenidoRespuesta: unknown;
  notaSugerida: number;
  notaFinal: number | null;
  correcta?: boolean;
  notaPorCriterio?: NotaPorCriterioPregunta[];
}

export interface RespuestaExamen {
  id: string;
  examenId: string;
  alumnoId: string;
  modeloIa: string | null;
  respuestasPorPregunta: RespuestaPorPreguntaItem[];
  notaTotalSugerida: string | null;
  feedbackGeneralSugerido: string | null;
  notaTotalFinal: string | null;
  feedbackGeneralFinal: string | null;
  estado: EstadoEntrega;
  estadoRevision: EstadoRevision;
  revisadoEn: string | null;
  createdAt: string;
  alumno?: Alumno;
  examen?: Examen;
}

// ---- Cursos ----

export const createCurso = (data: { docenteId: string; nombre: string; materia?: string }) =>
  request<Curso>('/cursos', { method: 'POST', body: JSON.stringify(data) });

export const listCursos = () => request<Curso[]>('/cursos');

export const getCurso = (id: string) => request<Curso>(`/cursos/${id}`);

// ---- Comisiones y alumnos ----

export const createComision = (
  cursoId: string,
  data: { nombre: string; alumnos?: { nombre: string; email: string }[] },
) => request<Comision>(`/cursos/${cursoId}/comisiones`, { method: 'POST', body: JSON.stringify(data) });

export const listComisionesPorCurso = (cursoId: string) =>
  request<Comision[]>(`/cursos/${cursoId}/comisiones`);

export const getComision = (id: string) => request<Comision>(`/comisiones/${id}`);

export const agregarAlumno = (comisionId: string, data: { nombre: string; email: string }) =>
  request<Alumno>(`/comisiones/${comisionId}/alumnos`, { method: 'POST', body: JSON.stringify(data) });

// ---- Matrices de rúbrica reutilizables ----

export const createMatrizRubrica = (data: {
  docenteId: string;
  nombre: string;
  descripcion?: string;
  criterios: {
    nombre: string;
    descripcion: string;
    puntajeMaximo: number;
    nivelesDescripcion: NivelDescripcion[];
  }[];
}) => request<MatrizRubrica>('/matrices-rubrica', { method: 'POST', body: JSON.stringify(data) });

export const listMatricesRubrica = () => request<MatrizRubrica[]>('/matrices-rubrica');

export const getMatrizRubrica = (id: string) => request<MatrizRubrica>(`/matrices-rubrica/${id}`);

// ---- Exámenes ----

export const createExamen = (data: {
  cursoId: string;
  titulo: string;
  consigna: string;
  modalidad: ModalidadExamen;
  duracionMinutos?: number;
  escalaMin: number;
  escalaMax: number;
  niveles: NivelEscala[];
  feedbackModo: FeedbackModo;
  preguntas: {
    tipo: TipoPregunta;
    enunciado: string;
    puntajeMaximo: number;
    opciones?: unknown;
    criterios?: {
      matrizOrigenId?: string;
      nombre: string;
      descripcion: string;
      puntajeMaximo: number;
      nivelesDescripcion: NivelDescripcion[];
    }[];
  }[];
}) => request<Examen>('/examenes', { method: 'POST', body: JSON.stringify(data) });

export const listExamenesPorCurso = (cursoId: string) => request<Examen[]>(`/examenes?cursoId=${cursoId}`);

export const getExamen = (id: string) => request<Examen>(`/examenes/${id}`);

export const publicarExamenAComision = (
  examenId: string,
  data: { comisionId: string; fechaInicio?: string; fechaFin?: string },
) => request<ExamenComision>(`/examenes/${examenId}/comisiones`, { method: 'POST', body: JSON.stringify(data) });

export const aplicarVara = (examenId: string, data: { varaPorcentaje: number }) =>
  request<RespuestaExamen[]>(`/examenes/${examenId}/vara`, { method: 'PATCH', body: JSON.stringify(data) });

export const liberarFeedback = (examenId: string) =>
  request<Examen>(`/examenes/${examenId}/liberar-feedback`, { method: 'POST' });

// ---- Rendir examen (público, sin identificación de docente) ----

export interface ExamenParaRendir {
  examen: {
    id: string;
    titulo: string;
    consigna: string;
    modalidad: ModalidadExamen;
    duracionMinutos: number | null;
    preguntas: Array<{
      id: string;
      tipo: TipoPregunta;
      enunciado: string;
      puntajeMaximo: string;
      opciones: unknown;
    }>;
  };
  comision: { id: string; nombre: string };
}

export const getExamenPorSlug = (slug: string) => request<ExamenParaRendir>(`/rendir/${slug}`);

export const registrarRespuesta = (
  slug: string,
  data: { alumnoEmail: string; respuestas: { preguntaId: string; contenido: unknown }[] },
) => request<RespuestaExamen>(`/rendir/${slug}`, { method: 'POST', body: JSON.stringify(data) });

// ---- Respuestas de examen (uso docente) ----

export const listRespuestasPorExamen = (examenId: string) =>
  request<RespuestaExamen[]>(`/examenes/${examenId}/respuestas`);

export const getRespuestaExamen = (examenId: string, id: string) =>
  request<RespuestaExamen>(`/examenes/${examenId}/respuestas/${id}`);

export const revisarRespuestaExamen = (
  examenId: string,
  id: string,
  data: {
    estadoRevision: 'aceptada' | 'editada';
    notaTotalFinal?: number;
    feedbackGeneralFinal?: string;
    overridesPorPregunta?: { preguntaId: string; notaFinal: number }[];
  },
) => request<RespuestaExamen>(`/examenes/${examenId}/respuestas/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const recorregirRespuestaExamen = (examenId: string, id: string) =>
  request<RespuestaExamen>(`/examenes/${examenId}/respuestas/${id}/recorregir`, { method: 'POST' });

export const bulkAceptarRespuestas = (examenId: string) =>
  request<RespuestaExamen[]>(`/examenes/${examenId}/respuestas/bulk-aceptar`, { method: 'POST' });
