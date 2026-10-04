-- Link para que los alumnos entreguen un trabajo práctico por su cuenta: modo seguro y ventana de tiempo u horario fijo.
-- Aditivo e idempotente: los trabajos prácticos anteriores quedan sin link (slug_acceso null).
alter table trabajos_practicos add column if not exists slug_acceso text unique;
alter table trabajos_practicos add column if not exists modo_seguro boolean not null default false;
alter table trabajos_practicos add column if not exists duracion_minutos int; -- ventana de tiempo; null = horario fijo
alter table trabajos_practicos add column if not exists fecha_inicio timestamptz; -- horario fijo
alter table trabajos_practicos add column if not exists fecha_fin timestamptz; -- horario fijo (vencimiento)

-- Un alumno entregando desde el link (reutiliza el tipo estado_intento de la Fase 1).
create table if not exists intentos_entrega (
  id uuid primary key default gen_random_uuid(),
  trabajo_practico_id uuid not null references trabajos_practicos(id) on delete cascade,
  alumno_nombre text not null,
  alumno_email text not null, -- en minúscula
  inicio_en timestamptz not null default now(),
  expira_en timestamptz not null,
  estado estado_intento not null default 'en_curso',
  borrador text not null default '',
  borrador_actualizado_en timestamptz,
  consentimiento_en timestamptz,
  -- señales de integridad del modo seguro (contadores)
  salidas_pantalla int not null default 0,
  cambios_pestana int not null default 0,
  pegados int not null default 0,
  entregado_en timestamptz,
  -- null si venció sin escribir nada: no se manda a corregir un texto vacío
  entrega_id uuid unique references entregas(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (trabajo_practico_id, alumno_email)
);
create index if not exists idx_intentos_entrega_estado_expira on intentos_entrega(estado, expira_en);
