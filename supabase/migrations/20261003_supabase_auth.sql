-- El login de docentes pasa a Supabase Auth. Cada docente se vincula con su usuario de auth.users en el
-- primer login: por id si ya estaba vinculado, o por email confirmado para los docentes anteriores.
-- (Sin clave foránea a auth.users a propósito: el esquema tiene que poder crearse también en un Postgres común.)
alter table docentes add column if not exists auth_user_id uuid unique;
