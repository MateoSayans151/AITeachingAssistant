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
  password_hash text,
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

-- Material de cátedra: apuntes/bibliografía en texto plano que el docente carga por
-- curso (no por examen puntual) y que la IA usa como referencia extra al corregir las
-- preguntas abiertas de ese curso. Mismo criterio "texto plano, a propósito" que el
-- resto del MVP — sin carga de PDF/imagen.
create table if not exists materiales_curso (
  id uuid primary key default gen_random_uuid(),
  curso_id uuid not null references cursos(id) on delete cascade,
  titulo text not null,
  unidad text,
  contenido text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_materiales_curso_curso on materiales_curso(curso_id);

-- Indice RAG del material de catedra. En una base existente aplicar la migracion
-- supabase/migrations/20260921_add_rag_materiales.sql.
create extension if not exists vector with schema extensions;

create table if not exists rag_fragmentos_material (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references materiales_curso(id) on delete cascade,
  curso_id uuid not null references cursos(id) on delete cascade,
  indice integer not null check (indice >= 0),
  contenido text not null,
  embedding extensions.vector(768) not null,
  created_at timestamptz not null default now(),
  unique (material_id, indice)
);
create index if not exists idx_rag_fragmentos_material_curso on rag_fragmentos_material(curso_id);
create index if not exists idx_rag_fragmentos_material_embedding
  on rag_fragmentos_material using hnsw (embedding vector_cosine_ops);

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
  codigo_acceso text not null,
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

-- ---------------------------------------------------------------------------
-- Fase 1: intentos de examen (reloj del servidor, autoguardado) y anti-cheat nivel 1.
-- (Idéntico a supabase/migrations/20260930_fase1_intentos_y_anticheat.sql)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Fase 2: vara auditable.
-- (Idéntico a supabase/migrations/20261001_fase2_vara_auditable.sql)
-- ---------------------------------------------------------------------------
-- Fase 2: vara auditable. La vara deja de pisar la nota: se guarda como ajuste con regla explícita,
-- snapshot por respuesta y posibilidad de revertirlo. notaTotalFinal solo la escribe el docente.
do $$ begin
  create type estado_ajuste_vara as enum ('activo', 'reemplazado', 'revertido');
exception when duplicate_object then null; end $$;

-- { umbralAprobacion, aprobadosEsperadosPct } — lo que el docente espera del examen; precarga la vara.
alter table examenes add column if not exists distribucion_esperada jsonb;

create table if not exists ajustes_vara (
  id uuid primary key default gen_random_uuid(),
  examen_id uuid not null references examenes(id) on delete cascade,
  autor_id uuid references docentes(id) on delete set null,
  regla jsonb not null, -- { modo, valor, umbral?, tope? }
  desplazamiento numeric, -- puntos aplicados (solo modo aprobados_esperados)
  resumen jsonb not null, -- { total, ajustadas, aprobadosAntes, aprobadosDespues, alcanzable }
  estado estado_ajuste_vara not null default 'activo',
  created_at timestamptz not null default now(),
  revertido_en timestamptz
);
create index if not exists idx_ajustes_vara_examen on ajustes_vara(examen_id, created_at);

-- Snapshot por respuesta: qué nota había antes y cuál quedó después de cada ajuste.
create table if not exists ajustes_vara_detalle (
  id uuid primary key default gen_random_uuid(),
  ajuste_id uuid not null references ajustes_vara(id) on delete cascade,
  respuesta_id uuid not null references respuestas_examen(id) on delete cascade,
  nota_base numeric not null, -- sugerida por la IA
  nota_con_vara_antes numeric, -- lo que tenía la respuesta antes de este ajuste (null = sin vara)
  ajuste_anterior_id uuid references ajustes_vara(id) on delete set null,
  nota_despues numeric not null,
  unique (ajuste_id, respuesta_id)
);
create index if not exists idx_ajustes_vara_detalle_respuesta on ajustes_vara_detalle(respuesta_id);

alter table respuestas_examen add column if not exists nota_con_vara numeric;
alter table respuestas_examen add column if not exists ajuste_vara_id uuid references ajustes_vara(id) on delete set null;

-- Datos de la vara vieja: dejaba una nota final escrita en respuestas todavía pendientes.
-- Se mueve a nota_con_vara (sin autor ni regla: no hay de dónde recuperarlos) y la final vuelve a null.
-- Idempotente: la segunda vez no hay pendientes con nota final.
update respuestas_examen
   set nota_con_vara = nota_total_final, nota_total_final = null
 where estado_revision = 'pendiente' and nota_total_final is not null;

-- ---------------------------------------------------------------------------
-- Endurecimiento: fallos de acceso en la base.
-- (Idéntico a supabase/migrations/20261002_endurecimiento_fallos_acceso.sql)
-- ---------------------------------------------------------------------------
-- Endurecimiento: el freno a los intentos fallidos de código de acceso pasa de memoria del proceso a la
-- base, para que valga igual con varias instancias del backend.
create table if not exists fallos_acceso (
  id uuid primary key default gen_random_uuid(),
  clave text not null, -- "slug|email" o "ip|<ip>"
  ocurrido_en timestamptz not null default now()
);
create index if not exists idx_fallos_acceso_clave on fallos_acceso(clave, ocurrido_en);
create index if not exists idx_fallos_acceso_ocurrido on fallos_acceso(ocurrido_en);

-- ---------------------------------------------------------------------------
-- Login de docentes con Supabase Auth.
-- (Idéntico a supabase/migrations/20261003_supabase_auth.sql)
-- ---------------------------------------------------------------------------
-- El login de docentes pasa a Supabase Auth. Cada docente se vincula con su usuario de auth.users en el
-- primer login: por id si ya estaba vinculado, o por email confirmado para los docentes anteriores.
-- (Sin clave foránea a auth.users a propósito: el esquema tiene que poder crearse también en un Postgres común.)
alter table docentes add column if not exists auth_user_id uuid unique;

-- ---------------------------------------------------------------------------
-- Link de entrega de trabajos prácticos para alumnos.
-- (Idéntico a supabase/migrations/20261003_tp_link_alumnos.sql)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Notificación del resultado por mail al alumno.
-- (Idéntico a supabase/migrations/20261004_notificacion_resultado.sql)
-- ---------------------------------------------------------------------------
alter table respuestas_examen add column if not exists notificado_en timestamptz;
alter table respuestas_examen add column if not exists notificacion_error text;

-- ---------------------------------------------------------------------------
-- Seguridad: RLS en todas las tablas de public (va al final: tiene que correr después de crear todas).
-- (Idéntico a supabase/migrations/20261004_rls_todas_las_tablas.sql)
-- ---------------------------------------------------------------------------
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
