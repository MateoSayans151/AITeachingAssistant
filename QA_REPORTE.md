# QA y fricción UX — AI Teaching Assistant

Sesión del 26/10/2026. Entorno de prueba: front `:3000`, back `:3002`, Supabase **local** en Docker con `supabase/schema.sql` (la red de UADE bloquea el protocolo de Postgres hacia Supabase), mails en modo prueba (`delivered@resend.dev`). Todo lo creado lleva el prefijo `QA-` o `qa.`. Cada arreglo es un commit con su ID; la suite del backend pasó de 477 a **501 tests** y `next build` + `tsc` de ambos proyectos compilan sin errores.

## Resumen

El camino completo funcionaba de punta a punta desde el principio (docente arma → alumno rinde → IA corrige → docente acepta → mails de nota), y la seguridad básica estaba bien (aislamiento entre docentes, sin fuga de la clave de respuestas, XSS y prompt injection contenidos). Los problemas estaban en **tres bugs que podían dejar a un alumno sin examen o sin poder entregar**, y en la **fricción**: armar preguntas, esperar a la IA y revisar en tanda.

Todo el camino se volvió a recorrer como docente nuevo, con 5 preguntas mixtas y dos alumnos (uno desde un iframe de 390 px).

| | Antes | Después |
|---|---|---|
| Crear + publicar un examen de 5 preguntas mixtas (desde la home) | ~25 clics (estimado de la 1.ª pasada) | **16 clics** (contados en la prueba final) |
| Llegar a las respuestas pendientes (desde la home) | 3 clics | **1 clic** (tarjeta "Para revisar") |
| Corregir 2 alumnos y publicar las notas (desde la home) | ~9 clics (7 con "Aceptar todas") | **6 clics** (5 con "Aceptar todas"; en bloque no crece con la cantidad de alumnos) |
| Decisiones técnicas obligatorias al crear | tipo ×5, puntos ×5, consigna, rúbrica ×2 | puntos ×5 (la IA arma los criterios; la consigna es opcional) |
| Espera de la IA al sugerir criterios | hasta 90 s sin salida | tope de 30 s, con aviso de cuánto puede tardar |
| Zona táctil de una opción en el celular | 13 px (fila de 20 px) | fila de 44 px |

No se midió con cronómetro (la herramienta de navegador no da tiempos confiables): los "después" son clics contados en la prueba final y los "antes", clics contados en la primera pasada. La espera dominante es la IA: 10–30 s por sugerencia de criterios y unos segundos por corrección.

## Hallazgos y estado final

Severidad: **S1** bloqueante · **S2** grave (haría fallar o abandonar a un docente nuevo) · **S3** molestia · **S4** pulido. Estado: ✅ arreglado y verificado en el navegador · 🟡 parcial · ⏸ pospuesto.

| ID | Sev | Qué pasaba | Estado |
|---|---|---|---|
| QA-014 | S1 | Una línea con dos emails (`maria@x; juan@gmial.com`) descartaba al segundo sin avisar: ese alumno nunca recibía examen ni nota | ✅ toma todos los emails de la línea |
| QA-015 | S2 | `NOMBRE <email>` (copiado de Gmail/Outlook) se rechazaba | ✅ |
| QA-017 | S1 | "Entregar examen" usaba `window.confirm`; en los navegadores embebidos de WhatsApp/Instagram/Gmail puede no mostrarse o devolver "no" y el alumno no puede entregar. Eran 12 diálogos nativos en la app | ✅ modal propio en los 12 sitios + test que impide que vuelvan |
| QA-008 | S2 | La 1.ª pregunta arrancaba como "Desarrollo" con rúbrica vacía | ✅ arranca como opción múltiple |
| QA-009 | S2 | Opciones de opción múltiple como inputs nativos, círculo de "correcta" sin rótulo, sin "Quitar" | ✅ |
| QA-019 | S2 | La respuesta correcta venía pre-elegida (opción A; "Verdadero"): fácil publicar con la clave invertida | ✅ hay que elegirla |
| QA-006 | S2 | La consigna era obligatoria | ✅ opcional, con default |
| QA-011 | S2 | "Sugerir criterios con IA" esperaba hasta 90 s con 4 reintentos, sin avisar ni dar salida, y el resultado corría la pantalla | ✅ 30 s, 1 reintento, aviso en el lugar del resultado |
| QA-010 | S2 | Toda pregunta de IA exige criterios con pesos; la IA sugería 3 para una respuesta corta, con "Restricción de formato" | 🟡 2 criterios, sin formato, botón de IA destacado. **Falta** (estructural, ver abajo) |
| QA-012 | S3 | "Qué se espera" cortado en un input de una línea | ✅ |
| QA-018 | S2 | 3 clics hasta las respuestas; la home y el curso no mostraban entregas ni pendientes; "1 comisiones" | ✅ bloque "Para revisar", contadores, plurales |
| QA-020 | S2 | El feedback al alumno decía "la segunda pregunta" cuando era la 5 | ✅ la IA recibe el número real |
| QA-021 | S2 | Revisar 50 alumnos = 50 idas y vueltas al listado | ✅ Anterior/Siguiente, "Aceptar y pasar a la siguiente", acciones fijas abajo |
| QA-022 | S3 | "Ajustar vara" / "Con vara" y el modelo de IA arriba de todo, sin explicación | ✅ se explica; columnas solo si se usan |
| QA-024 | S2 | Opciones de 13 px en el celular; texto de 15 px (zoom en iOS) | ✅ 44 px y 16 px; sin scroll horizontal a 390 px |
| QA-001 | S2 | Un docente nuevo veía solo un login | ✅ qué hace la app en una frase y tres pasos |
| QA-002 | S3 | Sin sesión, la barra mostraba vínculos a pantallas protegidas | ✅ |
| QA-003 | S3 | Aviso mínimo tras registrarse | ✅ "Revisá tu mail" con casilla, spam y reenviar |
| QA-005 | S3 | Errores del paso 1 en otro orden y sin limpiarse al corregir | ✅ se actualizan y la pantalla baja hasta ellos |
| QA-007 | S3 | Jerga en "Cómo se rinde" | ✅ en ese bloque; 🟡 "Opciones avanzadas" (plegado) sigue con jerga |
| QA-023 | S3 | La consigna desaparecía durante el examen | ✅ bloque plegable |
| QA-025 | S3 | El link del examen era texto, sin "Copiar" | ✅ |
| QA-026 | S3 | Notas con punto (6.5) y con coma (0,5); "1 alumno(s)" | ✅ formato argentino |
| QA-016 | S4 | "Se publica así" no decía cuándo cierra; nombres en minúscula | ✅ |
| QA-004 | S3 | "compartí el link con tus comisiones" | ✅ |
| QA-027 | S3 | "Tenés 1 minutos" | ✅ (hallado en la regresión) |
| QA-028 | S3 | Mandar el link por mail solo se podía al publicar | ✅ también desde el examen (hallado en la regresión) |
| QA-013 | S3 | Diálogo nativo en la rúbrica | ✅ cubierto por QA-017 |
| QA-000 | S3 | El front no tiene ESLint configurado (`next lint` pide un setup interactivo) | ⏸ requiere decidir reglas y sumar dependencias |

## Lo que sigue pendiente

**Decisiones de producto** (no las tomé):
1. **Rúbrica obligatoria en preguntas de IA (QA-010, estructural).** Es lo que más pesa en un docente poco técnico. Propuesta: al terminar el enunciado la IA arma los criterios sola y el docente solo los mira; o una "corrección simple" con un único criterio ("qué esperás en una buena respuesta") que el sistema convierte en rúbrica. Cambia la forma de cargar una pregunta y toca reglas de negocio, por eso no la hice.
2. **Trabajos Prácticos (flujo legacy)** sigue en la barra superior y en la home, al mismo nivel que los exámenes. Para un docente nuevo compite con "Nuevo examen". Sugerencia: esconderlo detrás de "Más" o quitarlo de la home.
3. **Nombres**: "vara" y "Matrices de rúbrica" se mantienen porque son términos del producto (en Argentina "subir la vara" es corriente), pero ahora llevan una explicación al lado. Si las entrevistas con docentes muestran que no se entienden, hay que renombrarlos en toda la app.

**Del lado de configuración** (no es código):
- La plantilla del mail de confirmación de Supabase es la de fábrica (en inglés, "Confirm Your Email"). En el panel de Supabase → Authentication → Email Templates hay que traducirla antes de dárselo al docente.
- El SMTP por defecto de Supabase tiene un límite muy bajo; para docentes reales hace falta uno propio.

## Guion de demo para el docente

1. Entrar a la app → **Soy nuevo: crear cuenta** → confirmar el mail.
2. **+ Nuevo examen**: elegir/crear el curso y poner el título. Siguiente.
3. Agregar 4–5 preguntas con **+ Agregar pregunta** (opción múltiple, verdadero/falso y una o dos de desarrollo). En las de desarrollo apretar **Sugerir criterios con IA** (tarda 10–30 s) y mirar el borrador. Repartir los puntos hasta que el total diga "OK". **Guardar y continuar**.
4. Pegar la lista de alumnos (acepta una por línea, `Nombre <mail>`, varias por línea y lo que se copia de una planilla) → **Publicar y generar link** → **Copiar link** (o **Enviar el link por mail**).
5. Los alumnos rinden desde el celular con su mail. Se les autoguarda.
6. En la home aparece **Para revisar** → un clic → **Aceptar todas** o **Revisar** uno por uno (con "Aceptar y pasar a la siguiente").
7. **Publicar notas y enviarlas por mail**.

**Límites que hay que avisarle al docente:**
- El plan gratuito de Resend permite **100 mails por día**; el avance de los envíos se guarda en la memoria del servidor y se pierde si se reinicia.
- Los alumnos **no ven una pantalla con su nota**: les llega por mail al publicar.
- Un examen publicado **no se edita** (se duplica y se edita la copia) y no se puede borrar si alguien ya empezó.
- Sin fecha de cierre el link **no vence**.
- La IA puede tardar hasta 30 s en sugerir criterios y unos segundos en corregir cada entrega; la corrección es una **sugerencia**: nada llega al alumno sin que el docente la acepte.
- Desde la red de UADE el back no llega a Supabase (el firewall corta el protocolo de Postgres): usar un hotspot, o el stack local de Docker que se usó para esta prueba.

## Lo que está bien y hay que conservar

Menú de tipos de pregunta con descripciones · filas plegadas con "Se corrige sola / La corrige la IA" · total en vivo con "Repartir puntos" · botones deshabilitados que explican por qué · borrador automático con "Continuar donde lo dejé" · paso Publicar con títulos en forma de pregunta y detección de typos de dominio con "Corregir" · pantalla "Listo" con "Copiar link" · autoguardado y retomar tras recargar o reingresando desde otra pestaña · mensaje de email fuera de lista · "¡Listo!" que dice a qué mail llega la nota · aviso de qué se monitorea con aceptación obligatoria · textos de confirmación bien redactados.

## Probado y sin hallazgos

Aislamiento entre docentes (404 en lectura y escritura, listados vacíos) · la clave de respuestas no sale al alumno · XSS inofensivo mostrado como texto · inyección de prompt sin efecto (nivel 2/5) · normalización del email del alumno (mayúsculas y espacios) · sesión con tiempo límite (el reloj corre, se entrega sola al vencer) y aceptación obligatoria del aviso de monitoreo · publicación de notas y envío de invitaciones en modo prueba · contraseña incorrecta y enlace de recuperación vencido · matrices y Trabajos Prácticos (solo pantallas vacías, sin errores en consola).

## No se pudo probar o quedó parcial

Recuperar contraseña de punta a punta (solo el enlace vencido) · registro de eventos de integridad reales (pantalla completa, pestaña, pegado: la prueba corrió en un iframe, que no entra en pantalla completa) · pérdida de conexión durante el examen · bloqueo por intentos fallidos de código · Material de cátedra/RAG · vara (solo la pantalla, no el cálculo) · creación y corrección de Trabajos Prácticos · celular real (se emuló con un iframe de 390 px) · ESLint (no está configurado).
