-- Ejecutar primero en el entorno de prueba manual y luego, sin cambios, en produccion.
-- No crea ni administra branches de Supabase.
create extension if not exists vector with schema extensions;

create table if not exists rag_fragmentos_material (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references materiales_curso(id) on delete cascade,
  curso_id uuid not null references cursos(id) on delete cascade,
  indice integer not null check (indice >= 0),
  contenido text not null,
  -- text-embedding-004 reducido a 768 dimensiones.
  embedding extensions.vector(768) not null,
  created_at timestamptz not null default now(),
  unique (material_id, indice)
);
create index if not exists idx_rag_fragmentos_material_curso on rag_fragmentos_material(curso_id);
create index if not exists idx_rag_fragmentos_material_embedding
  on rag_fragmentos_material using hnsw (embedding vector_cosine_ops);
