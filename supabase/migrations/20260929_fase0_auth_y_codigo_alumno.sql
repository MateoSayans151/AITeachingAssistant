-- Fase 0 (seguridad): login real de docentes y código de acceso por alumno.
alter table docentes add column if not exists password_hash text;

alter table alumnos add column if not exists codigo_acceso text;
-- Alumnos existentes: código aleatorio de 12 caracteres.
update alumnos
   set codigo_acceso = substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
 where codigo_acceso is null;
alter table alumnos alter column codigo_acceso set not null;
