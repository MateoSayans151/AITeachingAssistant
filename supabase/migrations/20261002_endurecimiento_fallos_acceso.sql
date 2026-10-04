-- Endurecimiento: el freno a los intentos fallidos de código de acceso pasa de memoria del proceso a la
-- base, para que valga igual con varias instancias del backend.
create table if not exists fallos_acceso (
  id uuid primary key default gen_random_uuid(),
  clave text not null, -- "slug|email" o "ip|<ip>"
  ocurrido_en timestamptz not null default now()
);
create index if not exists idx_fallos_acceso_clave on fallos_acceso(clave, ocurrido_en);
create index if not exists idx_fallos_acceso_ocurrido on fallos_acceso(ocurrido_en);
