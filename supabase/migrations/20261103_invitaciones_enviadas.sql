-- A quién se le mandó ya la invitación a un examen y cuántas veces. Sirve para que el docente vea quién la recibió y pueda elegir
-- a quiénes (re)enviarla, sin repetir mails por accidente. Idempotente.
create table if not exists invitaciones_enviadas (
  examen_id uuid not null references examenes(id) on delete cascade,
  alumno_id uuid not null references alumnos(id) on delete cascade,
  enviado_en timestamptz not null default now(), -- la última vez
  veces integer not null default 1,
  primary key (examen_id, alumno_id)
);
create index if not exists idx_invitaciones_enviadas_alumno on invitaciones_enviadas(alumno_id);

-- Mismo criterio que 20261004_rls_todas_las_tablas.sql: solo el backend toca esta tabla (anon y authenticated, nada).
alter table invitaciones_enviadas enable row level security;
