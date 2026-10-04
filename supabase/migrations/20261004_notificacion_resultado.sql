-- Notificación del resultado por mail: cuándo se le mandó al alumno su nota y feedback, y por qué falló si falló.
--
-- notificado_en        → null = todavía no se le avisó; con fecha = el mail salió (así "reenviar a los que faltan" no
--                        duplica y publicar dos veces no manda dos mails).
-- notificacion_error   → último motivo de fallo del envío (se limpia al enviar bien). null = sin errores.
--
-- Idempotente: se puede correr más de una vez.
alter table respuestas_examen add column if not exists notificado_en timestamptz;
alter table respuestas_examen add column if not exists notificacion_error text;
