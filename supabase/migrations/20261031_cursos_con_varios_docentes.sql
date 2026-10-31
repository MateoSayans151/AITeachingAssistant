-- Cursos con varios docentes: un curso lo comparten los docentes de su equipo, todos con los mismos permisos (ver, armar y
-- corregir exámenes, cargar material, manejar comisiones y sumar o sacar docentes). El acceso pasa a decidirse por pertenencia al
-- equipo (curso_docentes) y no por cursos.docente_id, que queda como "quien lo creó" (el docente de referencia de los mails).
--
-- - curso_docentes: pertenencia. Se llena con el creador de cada curso que ya existe.
-- - curso_invitaciones: docentes invitados que todavía no tienen cuenta; al entrar con ese email (confirmado) se suman solos.
-- - examenes.creado_por: quién armó cada examen (los anteriores quedan en null).
-- - cursos.docente_id: ya no se borra en cascada. Borrar un docente que creó cursos falla hasta reasignarlos: no se lleva puesto
--   un curso que usan otros.
--
-- Idempotente: se puede correr más de una vez.

create table if not exists curso_docentes (
  curso_id uuid not null references cursos(id) on delete cascade,
  docente_id uuid not null references docentes(id) on delete cascade,
  agregado_por uuid,
  created_at timestamptz not null default now(),
  primary key (curso_id, docente_id)
);
create index if not exists idx_curso_docentes_docente on curso_docentes(docente_id);

create table if not exists curso_invitaciones (
  id uuid primary key default gen_random_uuid(),
  curso_id uuid not null references cursos(id) on delete cascade,
  email text not null, -- en minúscula
  invitado_por uuid references docentes(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (curso_id, email)
);
create index if not exists idx_curso_invitaciones_email on curso_invitaciones(email);

-- Todo curso existente arranca con su creador como único miembro: nadie pierde acceso.
insert into curso_docentes (curso_id, docente_id)
select id, docente_id from cursos
on conflict do nothing;

alter table examenes add column if not exists creado_por uuid references docentes(id) on delete set null;
create index if not exists idx_examenes_creado_por on examenes(creado_por);

alter table cursos drop constraint if exists cursos_docente_id_fkey;
alter table cursos add constraint cursos_docente_id_fkey foreign key (docente_id) references docentes(id) on delete restrict;

-- Mismo criterio que 20261004_rls_todas_las_tablas.sql: solo el backend toca estas tablas (anon y authenticated, nada).
alter table curso_docentes enable row level security;
alter table curso_invitaciones enable row level security;
