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
