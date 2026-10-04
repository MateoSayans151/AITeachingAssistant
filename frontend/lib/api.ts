import { supabase } from './supabase';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Rutas donde un 401 no significa "sesión vencida": /rendir y /entregar son del alumno (no tiene sesión de docente) y
// /auth/me es justo donde se descubre que la cuenta no se puede usar (la pantalla de inicio muestra el motivo).
const RUTAS_PUBLICAS = ['/auth/me', '/rendir/', '/entregar/'];

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  // Access token de Supabase Auth; supabase-js lo renueva solo cuando vence.
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
    cache: 'no-store',
  });

  if (res.status === 401 && !RUTAS_PUBLICAS.some((r) => path.startsWith(r))) {
    // Sin sesión, o vencida: volver al login. En el navegador la promesa queda pendiente hasta que la redirección
    // termine, así la página que hizo el pedido no recibe un error sin capturar (el overlay rojo de Next en dev).
    await supabase.auth.signOut();
    if (typeof window !== 'undefined') {
      window.location.href = '/';
      return new Promise<T>(() => {});
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(res.status, `Error ${res.status} en ${path}: ${body}`, body);
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
  // Link para los alumnos. Los TP anteriores al link no lo tienen (urlAcceso null).
  urlAcceso?: string | null;
  modoSeguro: boolean;
  /** Ventana de tiempo: minutos por alumno. null = horario fijo. */
  duracionMinutos: number | null;
  /** Horario fijo: se abre en fechaInicio y vence en fechaFin. */
  fechaInicio: string | null;
  fechaFin: string | null;
}

export type ModalidadLink = 'ventana_tiempo' | 'horario_fijo';

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
  /** Solo si el alumno entregó desde el link; trae las señales del modo seguro. */
  intento?: {
    inicioEn: string;
    entregadoEn: string | null;
    estado: EstadoIntento;
    salidasPantalla: number;
    cambiosPestana: number;
    pegados: number;
  } | null;
}

export interface ResumenCurso {
  id: string;
  contenido: string;
  cantidadEntregasAnalizadas: number;
  modeloIa: string;
  generadoEn: string;
}

// ---- Docentes ----

// Quién es el docente de la sesión (el login en sí lo hace Supabase Auth desde el navegador).
export const getDocenteActual = () => request<Docente>('/auth/me');

// ---- Trabajos prácticos ----

export const listTrabajosPracticos = () => request<TrabajoPractico[]>('/trabajos-practicos');

export const getTrabajoPractico = (id: string) => request<TrabajoPractico>(`/trabajos-practicos/${id}`);

export const createTrabajoPractico = (data: {
  titulo: string;
  materia?: string;
  consigna: string;
  criterios: { nombre: string; descripcion: string; puntajeMaximo: number }[];
  // Config del link para los alumnos (siempre se genera): lo que corresponde según la modalidad.
  modoSeguro: boolean;
  modalidad: ModalidadLink;
  duracionMinutos?: number;
  fechaInicio?: string;
  fechaFin?: string;
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
  materiales?: MaterialCurso[];
}

export interface MaterialCurso {
  id: string;
  cursoId: string;
  titulo: string;
  unidad: string | null;
  contenido: string;
  createdAt: string;
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

export interface AntiCheatConfig {
  pantallaCompleta: boolean;
  cambioPestana: boolean;
  pegado: boolean;
}

export type TipoEventoIntegridad = 'salida_pantalla_completa' | 'cambio_pestana' | 'pegado';
export type EstadoIntento = 'en_curso' | 'entregado' | 'vencido';

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

export interface DistribucionEsperada {
  umbralAprobacion: number;
  /** % de alumnos que se espera que aprueben. */
  aprobadosEsperadosPct: number;
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
  /** Lo que el docente espera del examen; precarga la regla de la vara. */
  distribucionEsperada: DistribucionEsperada | null;
  feedbackModo: FeedbackModo;
  feedbackLiberadoEn: string | null;
  estado: EstadoExamen;
  antiCheat: AntiCheatConfig | null;
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
  /** Nota sugerida tras la vara vigente (la sugerida original no se toca). */
  notaConVara: string | null;
  ajusteVaraId: string | null;
  /** Solo la define el docente al aceptar o editar; mientras está pendiente es null. */
  notaTotalFinal: string | null;
  feedbackGeneralFinal: string | null;
  estado: EstadoEntrega;
  estadoRevision: EstadoRevision;
  revisadoEn: string | null;
  createdAt: string;
  alumno?: Alumno;
  examen?: Examen;
  /** En el listado: resumen del intento (cuántas señales de integridad y cómo se cerró). */
  intento?: { estado: EstadoIntento; eventos: number } | null;
  /** En el detalle: señales de integridad completas. Informativas, no afectan la nota. */
  integridad?: {
    estado: EstadoIntento;
    inicioEn: string;
    entregadoEn: string | null;
    expiraEn: string | null;
    consentimientoEn: string | null;
    eventos: { tipo: TipoEventoIntegridad; ocurridoEn: string; detalle: string | null }[];
  } | null;
}

// ---- Cursos ----

export const createCurso = (data: { nombre: string; materia?: string }) =>
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

// ---- Material de cátedra (texto plano, por curso) ----

export const listMaterialesPorCurso = (cursoId: string) => request<MaterialCurso[]>(`/cursos/${cursoId}/materiales`);

export const createMaterialCurso = (
  cursoId: string,
  data: { titulo: string; unidad?: string; contenido: string },
) => request<MaterialCurso>(`/cursos/${cursoId}/materiales`, { method: 'POST', body: JSON.stringify(data) });

export const eliminarMaterialCurso = (id: string) => request<void>(`/materiales/${id}`, { method: 'DELETE' });

export const agregarAlumno = (comisionId: string, data: { nombre: string; email: string }) =>
  request<Alumno>(`/comisiones/${comisionId}/alumnos`, { method: 'POST', body: JSON.stringify(data) });

// ---- Matrices de rúbrica reutilizables ----

export const createMatrizRubrica = (data: {
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
  antiCheat?: AntiCheatConfig;
  distribucionEsperada?: DistribucionEsperada;
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
      /** Opcional: qué implica cada uno de los 5 niveles en este criterio. */
      nivelesDescripcion?: NivelDescripcion[];
    }[];
  }[];
}) => request<Examen>('/examenes', { method: 'POST', body: JSON.stringify(data) });

export const listExamenesPorCurso = (cursoId: string) => request<Examen[]>(`/examenes?cursoId=${cursoId}`);

export const getExamen = (id: string) => request<Examen>(`/examenes/${id}`);

export const publicarExamenAComision = (
  examenId: string,
  data: { comisionId: string; fechaInicio?: string; fechaFin?: string },
) => request<ExamenComision>(`/examenes/${examenId}/comisiones`, { method: 'POST', body: JSON.stringify(data) });

// ---- Vara: regla explícita y auditable (nunca pisa la nota sugerida) ----
export type ModoVara = 'porcentaje' | 'puntos' | 'aprobados_esperados';

export interface ReglaVara {
  modo: ModoVara;
  /** porcentaje: % sobre la sugerida · puntos: suma fija · aprobados_esperados: % de aprobados esperado. */
  valor: number;
  /** Solo aprobados_esperados: nota mínima para aprobar. */
  umbral?: number;
  /** Solo aprobados_esperados: máximo desplazamiento en puntos (hacia arriba o hacia abajo). */
  tope?: number;
  /** Solo aprobados_esperados: false = "al menos X%" (solo sube); true = "alrededor de X%" (sube o baja). */
  permitirBajar?: boolean;
}

export interface ResumenVara {
  total: number;
  ajustadas: number;
  aprobadosAntes: number | null;
  aprobadosDespues: number | null;
  alcanzable: boolean | null;
}

export interface PreviewVara {
  regla: ReglaVara;
  desplazamiento: number | null;
  resumen: ResumenVara;
  filas: { respuestaId: string; alumno: string | null; notaSugerida: number; notaConVaraActual: number | null; notaConVara: number }[];
}

export interface AjusteVaraResumen {
  id: string;
  estado: 'activo' | 'reemplazado' | 'revertido';
  creadoEn: string;
  revertidoEn: string | null;
  autor: string | null;
  regla: ReglaVara;
  desplazamiento: number | null;
  resumen: ResumenVara;
  descripcion: string;
}

export interface ExplicacionVara {
  respuestaId: string;
  notaSugerida: number | null;
  notaConVara: number | null;
  notaFinal: number | null;
  estadoRevision: EstadoRevision;
  ajusteVigente: { ajusteId: string; descripcion: string; notaBase: number; notaDespues: number; creadoEn: string; autor: string | null } | null;
  historial: { ajusteId: string; estado: string; descripcion: string; notaBase: number; notaConVaraAntes: number | null; notaDespues: number; creadoEn: string }[];
  explicacion: string;
}

export const previewVara = (examenId: string, regla: ReglaVara) =>
  request<PreviewVara>(`/examenes/${examenId}/vara/preview`, { method: 'POST', body: JSON.stringify(regla) });

export const aplicarVara = (examenId: string, regla: ReglaVara) =>
  request<AjusteVaraResumen>(`/examenes/${examenId}/vara`, { method: 'POST', body: JSON.stringify(regla) });

export const listAjustesVara = (examenId: string) => request<AjusteVaraResumen[]>(`/examenes/${examenId}/vara`);

export const revertirAjusteVara = (examenId: string, ajusteId: string) =>
  request<{ restauradas: number; omitidas: number }>(`/examenes/${examenId}/vara/${ajusteId}/revertir`, { method: 'POST' });

export const explicarVaraRespuesta = (examenId: string, respuestaId: string) =>
  request<ExplicacionVara>(`/examenes/${examenId}/respuestas/${respuestaId}/vara`);

export const liberarFeedback = (examenId: string) =>
  request<Examen>(`/examenes/${examenId}/liberar-feedback`, { method: 'POST' });

// ---- Rendir examen (público: el alumno no tiene sesión de docente) ----
// Flujo: info del link -> iniciar (email + código, y aceptar el aviso si hay anti-cheat) ->
// autoguardado / eventos / entrega con el token del intento que devuelve `iniciar`.

export interface InfoRendir {
  examen: { titulo: string; consigna: string; modalidad: ModalidadExamen; duracionMinutos: number | null; antiCheat: AntiCheatConfig | null };
  comision: { nombre: string };
  ventana: { estado: 'abierta' | 'no_abierta' | 'cerrada'; fechaInicio: string | null; fechaFin: string | null };
}

export interface PreguntaRendir {
  id: string;
  tipo: TipoPregunta;
  enunciado: string;
  puntajeMaximo: string;
  opciones: unknown;
}

export interface EstadoIntentoRendir {
  /** Hora del servidor: el cliente corrige la diferencia de reloj con esto. */
  ahora: string;
  expiraEn: string | null;
  borrador: Record<string, unknown>;
  antiCheat: AntiCheatConfig | null;
  preguntas: PreguntaRendir[];
}

const conToken = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

export const getInfoRendir = (slug: string) => request<InfoRendir>(`/rendir/${slug}`);

export const iniciarIntento = (slug: string, data: { alumnoEmail: string; consentimiento?: boolean }) =>
  request<EstadoIntentoRendir & { token: string }>(`/rendir/${slug}/iniciar`, { method: 'POST', body: JSON.stringify(data) });

export const getIntento = (slug: string, token: string) =>
  request<EstadoIntentoRendir>(`/rendir/${slug}/intento`, conToken(token));

export const guardarBorrador = (slug: string, token: string, respuestas: Record<string, unknown>) =>
  request<{ guardadoEn: string }>(`/rendir/${slug}/borrador`, {
    method: 'PUT',
    body: JSON.stringify({ respuestas }),
    ...conToken(token),
  });

export const registrarEvento = (slug: string, token: string, tipo: TipoEventoIntegridad, detalle?: string) =>
  request<{ registrado: boolean }>(`/rendir/${slug}/eventos`, {
    method: 'POST',
    body: JSON.stringify({ tipo, detalle }),
    ...conToken(token),
  });

export const entregarIntento = (slug: string, token: string, respuestas?: Record<string, unknown>) =>
  request<{ recibida: boolean; enviadoEn: string; aTiempo: boolean }>(`/rendir/${slug}/entregar`, {
    method: 'POST',
    body: JSON.stringify({ respuestas }),
    ...conToken(token),
  });

// ---- Entregar trabajo práctico (público: el alumno no tiene sesión de docente) ----
// Flujo: info del link -> iniciar (nombre + email, y aceptar el aviso si hay modo seguro) ->
// autoguardado / eventos / entrega con el token del intento que devuelve `iniciar`.

export interface InfoEntregar {
  trabajo: { titulo: string; materia: string | null; modoSeguro: boolean; duracionMinutos: number | null };
  ventana: { estado: 'abierta' | 'no_abierta' | 'cerrada'; fechaInicio: string | null; fechaFin: string | null };
}

export interface EstadoIntentoEntregar {
  /** Hora del servidor: el cliente corrige la diferencia de reloj con esto. */
  ahora: string;
  expiraEn: string;
  borrador: string;
  modoSeguro: boolean;
  consigna: string;
}

export const getInfoEntregar = (slug: string) => request<InfoEntregar>(`/entregar/${slug}`);

export const iniciarEntrega = (slug: string, data: { alumnoNombre: string; alumnoEmail: string; consentimiento?: boolean }) =>
  request<EstadoIntentoEntregar & { token: string }>(`/entregar/${slug}/iniciar`, { method: 'POST', body: JSON.stringify(data) });

export const getIntentoEntrega = (slug: string, token: string) =>
  request<EstadoIntentoEntregar>(`/entregar/${slug}/intento`, conToken(token));

export const guardarBorradorEntrega = (slug: string, token: string, texto: string) =>
  request<{ guardadoEn: string }>(`/entregar/${slug}/borrador`, {
    method: 'PUT',
    body: JSON.stringify({ texto }),
    ...conToken(token),
  });

export const registrarEventoEntrega = (slug: string, token: string, tipo: TipoEventoIntegridad) =>
  request<{ registrado: boolean }>(`/entregar/${slug}/eventos`, {
    method: 'POST',
    body: JSON.stringify({ tipo }),
    ...conToken(token),
  });

export const enviarEntrega = (slug: string, token: string, texto?: string) =>
  request<{ recibida: boolean; enviadoEn: string; aTiempo: boolean }>(`/entregar/${slug}/enviar`, {
    method: 'POST',
    body: JSON.stringify({ texto }),
    ...conToken(token),
  });

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
