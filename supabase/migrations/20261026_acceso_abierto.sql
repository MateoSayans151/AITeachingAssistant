-- Acceso abierto al link de un examen: con acceso_abierto = true, el alumno que entra con un email que NO está en la lista
-- de la comisión se agrega solo (con el nombre y el email que escribe), sin que el docente haya cargado a nadie antes.
-- Con false, solo entran los que figuran en la lista (el comportamiento de siempre).
--
-- Los links que ya estaban publicados quedan en false: no cambia lo que ya funcionaba. Los nuevos se publican con true.
--
-- Idempotente: se puede correr más de una vez.
alter table examen_comisiones add column if not exists acceso_abierto boolean not null default false;
