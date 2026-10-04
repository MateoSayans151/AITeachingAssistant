-- Fase 1: examen rendible (reloj del servidor, autoguardado) y anti-cheat nivel 1.
do $$ begin
  create type estado_intento as enum ('en_curso', 'entregado', 'vencido');
exception when duplicate_object then null; end $$;
do $$ begin
  create type tipo_evento_integridad as enum ('salida_pantalla_completa', 'cambio_pestana', 'pegado');
exception when duplicate_object then null; end $$;

alter table examenes add column if not exists anti_cheat jsonb;

create table if not exists intentos_examen (
  id uuid primary key default gen_random_uuid(),
  examen_id uuid not null references examenes(id) on delete cascade,
  alumno_id uuid not null references alumnos(id) on delete cascade,
  inicio_en timestamptz not null default now(),
  expira_en timestamptz,
  estado estado_intento not null default 'en_curso',
  borrador jsonb not null default '{}'::jsonb,
  borrador_actualizado_en timestamptz,
  consentimiento_en timestamptz,
  entregado_en timestamptz,
  created_at timestamptz not null default now(),
  unique (examen_id, alumno_id)
);
create index if not exists idx_intentos_estado_expira on intentos_examen(estado, expira_en);

create table if not exists eventos_integridad (
  id uuid primary key default gen_random_uuid(),
  intento_id uuid not null references intentos_examen(id) on delete cascade,
  tipo tipo_evento_integridad not null,
  ocurrido_en timestamptz not null default now(),
  detalle text
);
create index if not exists idx_eventos_integridad_intento on eventos_integridad(intento_id);
