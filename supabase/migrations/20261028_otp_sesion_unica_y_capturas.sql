-- Verificación de mail con código (OTP), sesión única por intento, latido del cliente y capturas de pantalla.
--
-- Todo es opt-in por publicación / por examen: lo que ya está publicado sigue funcionando igual
-- (verificar_email = false, sin dominio permitido, sin pantalla compartida).

-- 1) Publicación: verificar el mail con un código y, opcionalmente, restringir el dominio de los mails que pueden entrar.
alter table examen_comisiones add column if not exists verificar_email boolean not null default false;
alter table examen_comisiones add column if not exists dominio_permitido text;

-- 2) Códigos de acceso (OTP). Se guarda un HMAC del código, nunca el código en claro.
create table if not exists codigos_acceso (
  id uuid primary key default gen_random_uuid(),
  examen_comision_id uuid not null references examen_comisiones(id) on delete cascade,
  email text not null,
  codigo_hash text not null,
  expira_en timestamptz not null,
  intentos int not null default 0,
  consumido_en timestamptz,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists idx_codigos_acceso_email on codigos_acceso(examen_comision_id, email, created_at);
create index if not exists idx_codigos_acceso_created on codigos_acceso(created_at);

-- 3) Estado de la sesión del intento: sesión única, origen, latido, próxima captura y marca visible.
alter table intentos_examen add column if not exists sesion int not null default 0;
alter table intentos_examen add column if not exists ultimo_origen_ip text;
alter table intentos_examen add column if not exists ultimo_origen_ua text;
alter table intentos_examen add column if not exists ultimo_cliente_id text;
alter table intentos_examen add column if not exists ultimo_latido_en timestamptz;
alter table intentos_examen add column if not exists proxima_captura_en timestamptz;
alter table intentos_examen add column if not exists captura_pedida_id uuid;
alter table intentos_examen add column if not exists captura_pedida_en timestamptz;
alter table intentos_examen add column if not exists marca_actual text;
alter table intentos_examen add column if not exists marca_anterior text;

-- 4) Historial de inicios de sesión del intento (siempre se registra: es un log de acceso, no de conducta).
create table if not exists sesiones_intento (
  id uuid primary key default gen_random_uuid(),
  intento_id uuid not null references intentos_examen(id) on delete cascade,
  iniciada_en timestamptz not null default now(),
  ip text,
  user_agent text
);
create index if not exists idx_sesiones_intento on sesiones_intento(intento_id);

-- 5) Eventos nuevos. ALTER TYPE ... ADD VALUE no puede usarse dentro de la misma transacción donde se crea el valor.
alter type tipo_evento_integridad add value if not exists 'pantalla_compartida_detenida';
alter type tipo_evento_integridad add value if not exists 'superficie_no_permitida';
alter type tipo_evento_integridad add value if not exists 'monitor_extendido';
alter type tipo_evento_integridad add value if not exists 'salto_de_texto';
alter type tipo_evento_integridad add value if not exists 'cambio_de_origen';
alter type tipo_evento_integridad add value if not exists 'captura_omitida';
alter type tipo_evento_integridad add value if not exists 'latido_perdido';

-- 6) Capturas de pantalla (la imagen vive en el almacenamiento; acá solo la referencia). Se borran solas al vencer eliminar_en.
create table if not exists capturas_integridad (
  id uuid primary key default gen_random_uuid(),
  intento_id uuid not null references intentos_examen(id) on delete cascade,
  ocurrido_en timestamptz not null default now(),
  motivo text not null,
  ruta text not null,
  bytes int not null,
  marca text,
  marca_valida boolean not null default false,
  eliminar_en timestamptz not null
);
create index if not exists idx_capturas_intento on capturas_integridad(intento_id, ocurrido_en);
create index if not exists idx_capturas_eliminar on capturas_integridad(eliminar_en);

-- RLS: las tablas nuevas quedan en deny-all para anon/authenticated (solo las toca el backend).
alter table codigos_acceso enable row level security;
alter table sesiones_intento enable row level security;
alter table capturas_integridad enable row level security;
