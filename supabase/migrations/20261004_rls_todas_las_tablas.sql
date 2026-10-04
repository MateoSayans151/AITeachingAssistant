-- Seguridad: Row Level Security en todas las tablas de public, sin policies (deny-all para anon/authenticated).
--
-- Por qué: el frontend publica la anon key de Supabase (NEXT_PUBLIC_SUPABASE_ANON_KEY) y, si la Data API
-- (PostgREST) está expuesta, esa key alcanza para leer y escribir cualquier tabla de public desde afuera, incluida
-- la clave de respuestas de los exámenes (preguntas.opciones). El ÚNICO cliente legítimo de estas tablas es el
-- backend, que se conecta con Prisma como el rol postgres (BYPASSRLS), así que no lo afecta nada de esto.
-- Con RLS activado y SIN policies, anon y authenticated no ven ni tocan ninguna fila: es lo que queremos.
--
-- No se crea ninguna policy A PROPÓSITO. Si alguna vez el frontend tuviera que leer una tabla directo desde
-- Supabase, habría que agregar una policy puntual y revisada para esa tabla; hoy no hay ningún caso. Tampoco se
-- usa FORCE ROW LEVEL SECURITY: el dueño de las tablas (el rol del backend) tiene que seguir salteando RLS.
-- Ojo: si algún día el backend se conectara con un rol sin BYPASSRLS, vería todas las tablas vacías.
--
-- Idempotente: se puede correr todas las veces que haga falta. Recorre las tablas que existan en public en el
-- momento de correrlo, así que no hay una lista a mano que mantener: si más adelante se agrega una tabla
-- (o hay una base creada antes de esta migración), se vuelve a correr y queda cubierta.

-- 1) RLS en cada tabla del esquema public.
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    begin
      execute format('alter table public.%I enable row level security', t.tablename);
    exception when insufficient_privilege then
      -- Tabla de otro dueño (p. ej. creada por una extensión): no frenamos toda la migración por eso.
      raise warning 'No se pudo activar RLS en public.% (permisos insuficientes)', t.tablename;
    end;
  end loop;
end $$;

-- 2) Cinturón y tirantes: además de RLS, anon y authenticated pierden los GRANTs sobre tablas y secuencias
-- (los que Supabase da por default), y lo mismo para lo que se cree de acá en adelante.
-- Se hace con guarda por pg_roles para que la migración también corra en un Postgres común, donde esos roles
-- no existen. Los default privileges valen para lo que cree el rol que corre esta migración (postgres en el SQL
-- Editor, que es el mismo que usa Prisma para crear tablas).
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
    end if;
  end loop;
end $$;

-- Funciones: el esquema no define ninguna en public. Si se agregan, ojo que PostgREST las expone como /rpc/<nombre>:
-- habría que revocarles EXECUTE a anon/authenticated también.

-- Verificación (tiene que devolver 0 filas):
--   select tablename from pg_tables where schemaname = 'public' and not rowsecurity;
