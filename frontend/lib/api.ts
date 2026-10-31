import { supabase } from './supabase';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Rutas donde un 401 no significa "sesión vencida": /rendir es del alumno (no tiene sesión de docente) y
// /auth/me es justo donde se descubre que la cuenta no se puede usar (la pantalla de inicio muestra el motivo).
const RUTAS_PUBLICAS = ['/auth/me', '/rendir/'];

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: string,
  ) {
    super(message);
  }
}

/** Id aleatorio de esta pestaña (dura lo que dura la pestaña: sobrevive a un refresh, no se comparte con otro dispositivo). */
function clienteId(): string {
  try {
    let id = window.sessionStorage.getItem('ata_cliente_id');
    if (!id) {
      id = crypto.randomUUID();
      window.sessionStorage.setItem('ata_cliente_id', id);
    }
    return id;
  } catch {
    return 'sin-id';
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  // Access token de Supabase Auth; supabase-js lo renueva solo cuando vence.
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      // Identifica esta pestaña ante el servidor: si el token del examen aparece en otro dispositivo, queda anotado.
      ...(path.startsWith('/rendir/') ? { 'X-Cliente-Id': clienteId() } : {}),
      // Con FormData el navegador pone solo el Content-Type (multipart con su boundary).
      ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
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

// Estados de una respuesta de examen: la IA la corrige (`estado`) y después la revisa el docente (`estadoRevision`).
export type EstadoEntrega = 'pendiente_correccion' | 'corregido' | 'revisado';
export type EstadoRevision = 'pendiente' | 'aceptada' | 'editada';

// ---- Docentes ----

// Quién es el docente de la sesión (el login en sí lo hace Supabase Auth desde el navegador).
export const getDocenteActual = () => request<Docente>('/auth/me');

// ============================================================================
// Cátedra: exámenes con preguntas tipadas, cursos/comisiones y vara.
// ============================================================================

export interface Curso {
  id: string;
  nombre: string;
  materia: string | null;
  createdAt: string;
  _count?: { comisiones: number; examenes: number; equipo?: number };
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
  /** El alumno comparte su pantalla completa y se guardan capturas. Los exámenes anteriores no lo traen. */
  pantallaCompartida?: boolean;
}

/** Eventos que reporta el navegador del alumno. */
export type TipoEventoCliente =
  | 'salida_pantalla_completa'
  | 'cambio_pestana'
  | 'pegado'
  | 'pantalla_compartida_detenida'
  | 'superficie_no_permitida'
  | 'monitor_extendido';
/** Todos los eventos: además de los del navegador, los que deduce el servidor. */
export type TipoEventoIntegridad =
  | TipoEventoCliente
  | 'salto_de_texto'
  | 'cambio_de_origen'
  | 'captura_omitida'
  | 'latido_perdido';
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
  /** true: cualquier alumno con el link puede entrar; false: solo los de la lista de la comisión. */
  accesoAbierto?: boolean;
  /** true: el alumno tiene que escribir un código de 6 dígitos que le llega al mail. */
  verificarEmail?: boolean;
  /** Si está, solo entran mails de ese dominio. */
  dominioPermitido?: string | null;
  createdAt: string;
  comision?: Comision;
  urlAcceso?: string;
}

export interface DistribucionEsperada {
  umbralAprobacion: number;
  /** % de alumnos que se espera que aprueben. */
  aprobadosEsperadosPct: number;
}

/** Cuántas respuestas tiene un examen y en qué punto está cada una (lo calcula el servidor). */
export interface ResumenRespuestas {
  entregadas: number;
  /** La IA todavía no las corrigió. */
  sinCorregir: number;
  /** La IA ya sugirió una nota y el docente todavía no la revisó. */
  porRevisar: number;
  revisadas: number;
}

/** Un examen que espera algo del docente: lo que muestra la home en "Para revisar". */
export interface ExamenPorRevisar extends ResumenRespuestas {
  id: string;
  titulo: string;
  cursoId: string;
  cursoNombre: string;
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
  /** Quién lo armó (los exámenes anteriores a los cursos con varios docentes no lo tienen). */
  creadoPor?: { id: string; nombre: string } | null;
  preguntas?: Pregunta[];
  comisiones?: ExamenComision[];
  /**
   * La lista por curso trae { preguntas, respuestas }; el detalle trae { respuestas, intentos }: cuántos alumnos entregaron y
   * cuántos empezaron (con cualquiera de los dos mayor a 0 el examen ya no se puede borrar).
   */
  _count?: { preguntas?: number; respuestas: number; intentos?: number };
  /** En la lista de un curso: cuántas respuestas tiene y cuántas esperan al docente. */
  resumenRespuestas?: ResumenRespuestas;
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
  /** La devolución que dejó el docente sobre esta pregunta al revisar (ausente o null: todavía no la tocó; '': la quitó). */
  feedbackFinal?: string | null;
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
    /** Log de acceso: cada vez que el alumno ingresó al examen. */
    sesiones?: { iniciadaEn: string; ip: string | null; userAgent: string | null }[];
    /** Cuántas capturas de pantalla hay guardadas (se ven con `getCapturas`). */
    capturas?: number;
  } | null;
}

// ---- Cursos ----

export const createCurso = (data: { nombre: string; materia?: string }) =>
  request<Curso>('/cursos', { method: 'POST', body: JSON.stringify(data) });

export const listCursos = () => request<Curso[]>('/cursos');

export const getCurso = (id: string) => request<Curso>(`/cursos/${id}`);

// ---- Equipo docente de un curso: todos los docentes del curso tienen los mismos permisos ----

export interface DocenteDelCurso {
  id: string;
  nombre: string;
  email: string;
  /** Desde cuándo está en el curso. */
  desde: string;
}

/** Alguien invitado que todavía no tiene cuenta: apenas se registre con ese email entra al curso. */
export interface InvitacionDelCurso {
  id: string;
  email: string;
  createdAt: string;
}

export interface EquipoDelCurso {
  docentes: DocenteDelCurso[];
  invitaciones: InvitacionDelCurso[];
}

export const getEquipoCurso = (cursoId: string) => request<EquipoDelCurso>(`/cursos/${cursoId}/docentes`);

/** Si el email ya tiene cuenta entra en el acto (`agregado`); si no, queda una invitación (`invitado`). Repetirlo no falla. */
export const agregarDocenteCurso = (cursoId: string, email: string) =>
  request<{ estado: 'agregado'; docente: { id: string; nombre: string; email: string } } | { estado: 'invitado'; email: string }>(
    `/cursos/${cursoId}/docentes`,
    { method: 'POST', body: JSON.stringify({ email }) },
  );

/** Saca a un docente del curso (o, si es uno mismo, sale del curso). El curso no puede quedar sin docentes (409). */
export const quitarDocenteCurso = (cursoId: string, docenteId: string) => request<void>(`/cursos/${cursoId}/docentes/${docenteId}`, { method: 'DELETE' });

export const quitarInvitacionCurso = (cursoId: string, invitacionId: string) => request<void>(`/cursos/${cursoId}/invitaciones/${invitacionId}`, { method: 'DELETE' });

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

/** Sube un archivo (pdf, docx, pptx, md, txt): el servidor extrae el texto y lo guarda como material. */
export const subirArchivoMaterialCurso = (cursoId: string, archivo: File, data: { titulo?: string; unidad?: string }) => {
  const form = new FormData();
  form.append('archivo', archivo);
  if (data.titulo) form.append('titulo', data.titulo);
  if (data.unidad) form.append('unidad', data.unidad);
  return request<MaterialCurso>(`/cursos/${cursoId}/materiales/archivo`, { method: 'POST', body: form });
};

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
    /** Opcional: sin niveles detallados la matriz se guarda con `[]`; si se mandan, de 3 a 7 (como la escala del examen). */
    nivelesDescripcion?: NivelDescripcion[];
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
      /** Opcional: qué implica cada uno de los niveles de la escala del examen en este criterio (todos o ninguno). */
      nivelesDescripcion?: NivelDescripcion[];
    }[];
  }[];
}) => request<Examen>('/examenes', { method: 'POST', body: JSON.stringify(data) });

export const listExamenesPorCurso = (cursoId: string) => request<Examen[]>(`/examenes?cursoId=${cursoId}`);

export const listExamenesPorRevisar = () => request<ExamenPorRevisar[]>('/examenes/pendientes');

export const getExamen = (id: string) => request<Examen>(`/examenes/${id}`);

/** Borra un examen que nadie empezó ni entregó (si no, 409 con el motivo). Se van con él sus preguntas y los links publicados. */
export const deleteExamen = (id: string) => request<void>(`/examenes/${id}`, { method: 'DELETE' });

/** Cambia el nombre de un examen ya creado (se puede en cualquier momento, aunque haya alumnos rindiendo). */
export const renombrarExamen = (id: string, titulo: string) =>
  request<{ id: string; titulo: string }>(`/examenes/${id}`, { method: 'PATCH', body: JSON.stringify({ titulo }) });

export const publicarExamenAComision = (
  examenId: string,
  data: { comisionId: string; fechaInicio?: string; fechaFin?: string; accesoAbierto?: boolean; verificarEmail?: boolean; dominioPermitido?: string },
) => request<ExamenComision>(`/examenes/${examenId}/comisiones`, { method: 'POST', body: JSON.stringify(data) });

// ---- Sugerir criterios con IA (borrador para el docente; la IA propone, el docente edita y decide) ----
export interface CriterioSugerido {
  nombre: string;
  descripcion: string;
  /** Entero 1..100; los pesos de toda la sugerencia suman exactamente 100. */
  peso: number;
  /** Exactamente 5 descripciones: niveles[0] = nivel 1 (el más bajo) … niveles[4] = nivel 5 (el mejor). */
  niveles: string[];
}

/**
 * Solo para preguntas abiertas (desarrollo, resolución de problema, demostración, análisis de caso, respuesta corta).
 * `cantidadNiveles` (entero de 3 a 7, por defecto 5) es la cantidad de niveles de la escala del examen: cada criterio sugerido
 * trae exactamente esa cantidad de descripciones en `niveles`.
 */
export const sugerirCriterios = (data: { enunciado: string; tipo: TipoPregunta; cantidad?: number; cantidadNiveles?: number }) =>
  request<{ criterios: CriterioSugerido[] }>('/examenes/sugerir-criterios', { method: 'POST', body: JSON.stringify(data) });

// ---- Sugerir preguntas con IA (borrador para el docente; la IA propone, el docente verifica, edita y decide) ----
export type DificultadPregunta = 'facil' | 'media' | 'dificil';

export interface PreguntaSugerida {
  tipo: TipoPregunta;
  enunciado: string;
  /** Solo en las cerradas, con la misma forma que se guarda en el examen (opción múltiple/casillas: [{id, texto, correcta}]; V/F: {correcta}; numérica: {respuestaCorrecta, tolerancia}; pares: {izquierda, derecha, paresCorrectos}). */
  opciones?: unknown;
  /** Por qué la respuesta correcta lo es (en las abiertas, qué debería contener una buena respuesta). */
  explicacion: string;
  /** De qué parte del material sale; null si no se pudo ubicar. */
  fuente: { titulo: string; unidad: string | null } | null;
}

/**
 * Pide hasta 8 preguntas de los `tipos` indicados, armadas con el material del curso. `temas` son unidades o títulos del material
 * (o un tema escrito a mano); sin temas se usa todo el material. `existentes` son los enunciados que el examen ya tiene, para que la
 * IA no los repita. `sinMaterial` viene en true si el curso no tiene material y las preguntas salen solo del tema.
 */
export const sugerirPreguntas = (data: {
  cursoId: string;
  tipos: TipoPregunta[];
  cantidad?: number;
  dificultad?: DificultadPregunta;
  temas?: string[];
  foco?: string;
  existentes?: string[];
}) => request<{ preguntas: PreguntaSugerida[]; sinMaterial: boolean }>('/examenes/sugerir-preguntas', { method: 'POST', body: JSON.stringify(data) });

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

/**
 * Publicar las notas es idempotente: si ya estaban publicadas se conserva la fecha original. Además lanza en segundo
 * plano el mail con la nota a cada alumno ya revisado (`aEnviar` = cuántos); si el servidor no tiene el envío de mails
 * configurado responde 409 y no publica nada.
 */
export type ExamenConPendientes = Examen & { pendientesDeRevision: number; aEnviar: number };

export const liberarFeedback = (examenId: string) =>
  request<ExamenConPendientes>(`/examenes/${examenId}/liberar-feedback`, { method: 'POST' });

// ---- Mails con la nota (los manda el backend con Resend) ----

export interface ResumenNotificaciones {
  /** El servidor tiene el envío de mails configurado (RESEND_API_KEY y EMAIL_FROM). Sin eso no se puede publicar. */
  configurado: boolean;
  /** Dirección a la que llegan TODOS los mails en vez de a los alumnos; null = modo normal. */
  modoPrueba: string | null;
  enviados: number;
  /** Les tocaba el mail y el último intento falló. */
  conError: number;
  /** Les toca el mail y todavía no salió. */
  sinEnviar: number;
  /** Respuestas todavía sin revisar: no reciben nada hasta que las revises. */
  sinRevisar: number;
  /** Envíos de este examen que el servidor tiene en marcha ahora. */
  enCurso: number;
  ultimoError: string | null;
}

export const getResumenNotificaciones = (examenId: string) =>
  request<ResumenNotificaciones>(`/examenes/${examenId}/notificaciones`);

/** Reintenta en segundo plano el mail de los alumnos que todavía no lo recibieron. 409 si el envío no está configurado. */
export const reenviarNotificaciones = (examenId: string) =>
  request<{ aEnviar: number }>(`/examenes/${examenId}/notificaciones/reenviar`, { method: 'POST' });

// ---- Rendir examen (público: el alumno no tiene sesión de docente) ----
// Flujo: info del link -> iniciar (con su email, y aceptar el aviso si hay anti-cheat) ->
// autoguardado / eventos / entrega con el token del intento que devuelve `iniciar`.

export interface InfoRendir {
  examen: { titulo: string; consigna: string; modalidad: ModalidadExamen; duracionMinutos: number | null; antiCheat: AntiCheatConfig | null; retencionCapturasDias?: number | null };
  comision: { nombre: string };
  /** true: cualquier alumno con el link puede entrar (se le pide nombre y email); false: solo los que figuran en la lista. */
  accesoAbierto: boolean;
  /** true: para entrar hay que pedir un código de 6 dígitos que llega al mail. */
  verificarEmail: boolean;
  /** Si está, solo entran mails de ese dominio. */
  dominioPermitido: string | null;
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

/** Pide el código que llega al mail. Responde siempre lo mismo, esté o no el mail en la lista. */
export const solicitarCodigo = (slug: string, alumnoEmail: string) =>
  request<{ enviado: boolean }>(`/rendir/${slug}/codigo`, { method: 'POST', body: JSON.stringify({ alumnoEmail }) });

export const iniciarIntento = (slug: string, data: { alumnoEmail: string; alumnoNombre?: string; consentimiento?: boolean; codigo?: string }) =>
  request<EstadoIntentoRendir & { token: string }>(`/rendir/${slug}/iniciar`, { method: 'POST', body: JSON.stringify(data) });

export const getIntento = (slug: string, token: string) =>
  request<EstadoIntentoRendir>(`/rendir/${slug}/intento`, conToken(token));

export const guardarBorrador = (slug: string, token: string, respuestas: Record<string, unknown>) =>
  request<{ guardadoEn: string }>(`/rendir/${slug}/borrador`, {
    method: 'PUT',
    body: JSON.stringify({ respuestas }),
    ...conToken(token),
  });

export interface RespuestaLatido {
  /** Código corto que la página tiene que mostrar: tiene que verse en las capturas. */
  marca: string | null;
  /** Si no es null, el servidor pide una captura de pantalla ahora (hay que mandarla con este id). */
  capturaPedida: { id: string } | null;
  ahora: string;
}

export const enviarLatido = (slug: string, token: string, data: { foco: boolean; visible: boolean; compartiendo: boolean }) =>
  request<RespuestaLatido>(`/rendir/${slug}/latido`, { method: 'POST', body: JSON.stringify(data), ...conToken(token) });

export type MotivoCaptura = 'muestreo' | 'cambio_pestana' | 'salida_pantalla_completa' | 'pantalla_compartida_detenida';

export const subirCaptura = (slug: string, token: string, data: { motivo: MotivoCaptura; pedidoId?: string; marca?: string; imagen: string }) =>
  request<{ registrada: boolean; motivo?: string }>(`/rendir/${slug}/capturas`, { method: 'POST', body: JSON.stringify(data), ...conToken(token) });

export const registrarEvento = (slug: string, token: string, tipo: TipoEventoCliente, detalle?: string) =>
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
    overridesPorPregunta?: { preguntaId: string; notaFinal: number; feedbackFinal?: string }[];
  },
) => request<RespuestaExamen>(`/examenes/${examenId}/respuestas/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const recorregirRespuestaExamen = (examenId: string, id: string) =>
  request<RespuestaExamen>(`/examenes/${examenId}/respuestas/${id}/recorregir`, { method: 'POST' });

export const bulkAceptarRespuestas = (examenId: string) =>
  request<RespuestaExamen[]>(`/examenes/${examenId}/respuestas/bulk-aceptar`, { method: 'POST' });

/**
 * Reintenta la corrección con IA de las respuestas que quedaron sin corregir (`estado: 'pendiente_correccion'`).
 * Responde enseguida con cuántas puso en cola; el backend las corrige en segundo plano, así que hay que refrescar la lista.
 */
export const corregirPendientes = (examenId: string) =>
  request<{ pendientes: number }>(`/examenes/${examenId}/respuestas/corregir-pendientes`, { method: 'POST' });

// ---- Invitaciones por mail (uso docente) ----
// El docente le manda a cada alumno el link para rendir un examen ya publicado. El envío corre en segundo plano en el
// servidor: `invitarAlumnos` responde enseguida y el avance se consulta con `getEstadoInvitaciones` (refrescar mientras `enCurso`).

export interface EstadoInvitaciones {
  /** El servidor tiene el envío de mails configurado (RESEND_API_KEY y EMAIL_FROM). Sin eso, invitar responde 409. */
  configurado: boolean;
  /** Dirección a la que llegan TODOS los mails en vez de a los alumnos (modo prueba); null = modo normal. */
  modoPrueba: string | null;
  /** Invitaciones del último envío (0 si nunca se mandó o si el servidor se reinició: el estado vive en su memoria). */
  total: number;
  enviados: number;
  conError: number;
  /** Hay un envío corriendo ahora mismo. */
  enCurso: boolean;
  /** Motivo del último fallo (por ejemplo, el límite diario de envíos del plan de Resend); null si no hubo. */
  ultimoError: string | null;
}

/**
 * Manda por mail a cada alumno su link para rendir: de la publicación `examenComisionId`, o de todas las comisiones donde el examen
 * está publicado si no se pasa. Responde enseguida con cuántos mails salen. 409 si el envío no está configurado, si ya hay un envío
 * en curso para este examen o si no hay a quién mandarle; 404 si la publicación no es de este examen.
 */
export const invitarAlumnos = (examenId: string, examenComisionId?: string) =>
  request<{ aEnviar: number }>(`/examenes/${examenId}/invitaciones`, {
    method: 'POST',
    body: JSON.stringify(examenComisionId ? { examenComisionId } : {}),
  });

export const getEstadoInvitaciones = (examenId: string) => request<EstadoInvitaciones>(`/examenes/${examenId}/invitaciones`);


// ---- Capturas de pantalla de un intento (solo el docente dueño del examen) ----
export interface CapturaIntegridad {
  id: string;
  ocurridoEn: string;
  motivo: MotivoCaptura;
  marca: string | null;
  /** false: la marca que dijo mostrar el navegador no coincide con las que emitió el servidor. */
  marcaValida: boolean;
  bytes: number;
  eliminarEn: string;
}

export const getCapturas = (examenId: string, respuestaId: string) =>
  request<CapturaIntegridad[]>(`/examenes/${examenId}/respuestas/${respuestaId}/capturas`);

/** La imagen no se puede pedir con un <img src> (necesita el token del docente): se baja con fetch y se muestra como blob. */
export async function getCapturaImagen(examenId: string, respuestaId: string, capturaId: string): Promise<Blob> {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const res = await fetch(`${API_URL}/examenes/${examenId}/respuestas/${respuestaId}/capturas/${capturaId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  if (!res.ok) throw new ApiError(res.status, `Error ${res.status} al bajar la captura`, '');
  return res.blob();
}

export const borrarCaptura = (examenId: string, respuestaId: string, capturaId: string) =>
  request<{ borrada: boolean }>(`/examenes/${examenId}/respuestas/${respuestaId}/capturas/${capturaId}`, { method: 'DELETE' });

export const borrarCapturas = (examenId: string, respuestaId: string) =>
  request<{ borradas: number }>(`/examenes/${examenId}/respuestas/${respuestaId}/capturas`, { method: 'DELETE' });
