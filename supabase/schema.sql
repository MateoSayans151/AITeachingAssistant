-- ============================================================
-- AI Teaching Assistant — schema inicial para Supabase (Postgres)
-- Corre esto en el SQL Editor de Supabase, o via `prisma migrate`
-- (el schema.prisma en backend/prisma/schema.prisma es equivalente).
-- ============================================================

create extension if not exists "pgcrypto";

-- Docente: quien usa la herramienta para corregir
create table if not exists docentes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  email text not null unique,
  created_at timestamptz not null default now()
);

-- Trabajo práctico: consigna + metadata. La rúbrica vive en criterios_rubrica.
create table if not exists trabajos_practicos (
  id uuid primary key default gen_random_uuid(),
  docente_id uuid not null references docentes(id) on delete cascade,
  titulo text not null,
  consigna text not null,
  materia text,
  created_at timestamptz not null default now()
);

create index if not exists idx_trabajos_practicos_docente on trabajos_practicos(docente_id);

-- Criterio de rúbrica: cada fila es un criterio evaluable dentro de un TP
create table if not exists criterios_rubrica (
  id uuid primary key default gen_random_uuid(),
  trabajo_practico_id uuid not null references trabajos_practicos(id) on delete cascade,
  nombre text not null,
  descripcion text not null,
  puntaje_maximo numeric not null check (puntaje_maximo > 0),
  orden int not null default 0
);

create index if not exists idx_criterios_rubrica_tp on criterios_rubrica(trabajo_practico_id);

-- Entrega: el trabajo de un alumno para un TP dado
create type estado_entrega as enum ('pendiente_correccion', 'corregido', 'revisado');

create table if not exists entregas (
  id uuid primary key default gen_random_uuid(),
  trabajo_practico_id uuid not null references trabajos_practicos(id) on delete cascade,
  alumno_nombre text not null,
  alumno_email text,
  texto_trabajo text not null,
  estado estado_entrega not null default 'pendiente_correccion',
  created_at timestamptz not null default now()
);

create index if not exists idx_entregas_tp on entregas(trabajo_practico_id);
create index if not exists idx_entregas_estado on entregas(estado);

-- Corrección: lo que devuelve la IA por entrega, más lo que el docente confirma/edita
create type estado_revision as enum ('pendiente', 'aceptada', 'editada');

create table if not exists correcciones (
  id uuid primary key default gen_random_uuid(),
  entrega_id uuid not null unique references entregas(id) on delete cascade,
  modelo_ia text not null,
  nota_por_criterio jsonb not null, -- [{ criterioId, nombre, notaSugerida, comentario }]
  nota_total_sugerida numeric not null,
  feedback_sugerido text not null,
  nota_total_final numeric,
  feedback_final text,
  estado_revision estado_revision not null default 'pendiente',
  revisado_en timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_correcciones_estado on correcciones(estado_revision);

-- Resumen agregado del curso para un TP: qué criterios/conceptos generaron más dificultad
create table if not exists resumenes_curso (
  id uuid primary key default gen_random_uuid(),
  trabajo_practico_id uuid not null references trabajos_practicos(id) on delete cascade,
  contenido text not null, -- markdown con el análisis agregado
  cantidad_entregas_analizadas int not null,
  modelo_ia text not null,
  generado_en timestamptz not null default now()
);

create index if not exists idx_resumenes_tp on resumenes_curso(trabajo_practico_id);

-- ============================================================
-- Cátedra: exámenes con preguntas tipadas, cursos/comisiones y vara de ajuste.
-- Todo lo de acá abajo es aditivo y convive con el flujo de arriba
-- (trabajos_practicos/entregas/correcciones) sin tocarlo.
-- ============================================================

create type tipo_pregunta as enum (
  'desarrollo', 'resolucion_problema', 'demostracion', 'analisis_caso', 'respuesta_corta',
  'numerica', 'relacionar_pares', 'opcion_multiple', 'casillas', 'verdadero_falso'
);

create type modalidad_examen as enum ('sesion_tiempo', 'ventana_dias');
create type feedback_modo as enum ('inmediato', 'manual');
create type estado_examen as enum ('borrador', 'publicado', 'cerrado');

create table if not exists cursos (
  id uuid primary key default gen_random_uuid(),
  docente_id uuid not null references docentes(id) on delete cascade,
  nombre text not null,
  materia text,
  created_at timestamptz not null default now()
);

create index if not exists idx_cursos_docente on cursos(docente_id);

create table if not exists comisiones (
  id uuid primary key default gen_random_uuid(),
  curso_id uuid not null references cursos(id) on delete cascade,
  nombre text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_comisiones_curso on comisiones(curso_id);

create table if not exists alumnos (
  id uuid primary key default gen_random_uuid(),
  comision_id uuid not null references comisiones(id) on delete cascade,
  nombre text not null,
  email text not null,
  created_at timestamptz not null default now(),
  unique (comision_id, email)
);

create table if not exists matrices_rubrica (
  id uuid primary key default gen_random_uuid(),
  docente_id uuid not null references docentes(id) on delete cascade,
  nombre text not null,
  descripcion text,
  created_at timestamptz not null default now()
);

create index if not exists idx_matrices_rubrica_docente on matrices_rubrica(docente_id);

create table if not exists criterios_matriz (
  id uuid primary key default gen_random_uuid(),
  matriz_id uuid not null references matrices_rubrica(id) on delete cascade,
  nombre text not null,
  descripcion text not null,
  puntaje_maximo numeric not null check (puntaje_maximo > 0),
  orden int not null default 0,
  niveles_descripcion jsonb not null -- [{ orden, nombre, descripcion }] x5
);

create index if not exists idx_criterios_matriz_matriz on criterios_matriz(matriz_id);

create table if not exists examenes (
  id uuid primary key default gen_random_uuid(),
  curso_id uuid not null references cursos(id) on delete cascade,
  titulo text not null,
  consigna text not null,
  modalidad modalidad_examen not null default 'ventana_dias',
  duracion_minutos int,
  escala_min numeric not null default 0,
  escala_max numeric not null default 10,
  niveles jsonb not null, -- [{ orden, nombre, colorHex, porcentaje }] x5
  vara_porcentaje numeric not null default 0,
  feedback_modo feedback_modo not null default 'manual',
  feedback_liberado_en timestamptz,
  estado estado_examen not null default 'borrador',
  created_at timestamptz not null default now()
);

create index if not exists idx_examenes_curso on examenes(curso_id);

create table if not exists examen_comisiones (
  id uuid primary key default gen_random_uuid(),
  examen_id uuid not null references examenes(id) on delete cascade,
  comision_id uuid not null references comisiones(id) on delete cascade,
  slug_acceso text not null unique,
  fecha_inicio timestamptz,
  fecha_fin timestamptz,
  created_at timestamptz not null default now(),
  unique (examen_id, comision_id)
);

create table if not exists preguntas (
  id uuid primary key default gen_random_uuid(),
  examen_id uuid not null references examenes(id) on delete cascade,
  tipo tipo_pregunta not null,
  enunciado text not null,
  orden int not null default 0,
  puntaje_maximo numeric not null check (puntaje_maximo > 0),
  opciones jsonb -- forma libre según el tipo (choices con clave, respuesta numérica, pares, etc.)
);

create index if not exists idx_preguntas_examen on preguntas(examen_id);

create table if not exists criterios_pregunta (
  id uuid primary key default gen_random_uuid(),
  pregunta_id uuid not null references preguntas(id) on delete cascade,
  matriz_origen_id uuid references matrices_rubrica(id) on delete set null,
  nombre text not null,
  descripcion text not null,
  puntaje_maximo numeric not null check (puntaje_maximo > 0),
  orden int not null default 0,
  niveles_descripcion jsonb not null
);

create index if not exists idx_criterios_pregunta_pregunta on criterios_pregunta(pregunta_id);

create table if not exists respuestas_examen (
  id uuid primary key default gen_random_uuid(),
  examen_id uuid not null references examenes(id) on delete cascade,
  alumno_id uuid not null references alumnos(id) on delete cascade,
  modelo_ia text,
  respuestas_por_pregunta jsonb not null, -- [{ preguntaId, contenidoRespuesta, notaSugerida, notaFinal, notaPorCriterio?, correcta? }]
  nota_total_sugerida numeric,
  feedback_general_sugerido text,
  nota_total_final numeric,
  feedback_general_final text,
  estado estado_entrega not null default 'pendiente_correccion',
  estado_revision estado_revision not null default 'pendiente',
  revisado_en timestamptz,
  created_at timestamptz not null default now(),
  unique (examen_id, alumno_id)
);

create index if not exists idx_respuestas_examen_estado on respuestas_examen(estado);
create index if not exists idx_respuestas_examen_revision on respuestas_examen(estado_revision);
