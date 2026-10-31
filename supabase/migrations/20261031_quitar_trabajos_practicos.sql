-- Se quitan los trabajos prácticos: la herramienta queda solo con exámenes.
--
-- ATENCIÓN: borra de forma permanente los trabajos prácticos, sus rúbricas, las entregas de los alumnos, las correcciones, los
-- resúmenes de curso y los intentos con link. Si hace falta conservar algo, exportalo ANTES de correr esto.
--
-- Los tipos estado_entrega, estado_revision y estado_intento se quedan: los usan las respuestas e intentos de los exámenes.
--
-- Idempotente: se puede correr más de una vez.

drop table if exists intentos_entrega;
drop table if exists correcciones;
drop table if exists resumenes_curso;
drop table if exists criterios_rubrica;
drop table if exists entregas;
drop table if exists trabajos_practicos;
