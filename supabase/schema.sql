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
