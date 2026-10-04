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
