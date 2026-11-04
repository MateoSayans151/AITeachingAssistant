-- Control del docente sobre un examen en marcha: cierre programado, aviso a los alumnos que están rindiendo y tiempo extra por alumno.
-- Idempotente.
alter table examenes add column if not exists cierre_programado_en timestamptz;
-- Al llegar la hora: true = se entrega lo que tengan los que siguen rindiendo; false = terminan su intento.
alter table examenes add column if not exists cierre_entregar_en_curso boolean not null default true;
-- Último aviso del docente (un cartel dentro del examen) y cuándo lo mandó.
alter table examenes add column if not exists aviso_texto text;
alter table examenes add column if not exists aviso_en timestamptz;

-- Minutos extra que el docente le dio a este alumno (ya sumados a expira_en; se guardan para que un cambio de la duración del examen no los pierda).
alter table intentos_examen add column if not exists minutos_extra integer not null default 0;
