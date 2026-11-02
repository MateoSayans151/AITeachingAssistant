---
name: guia-docente
description: Mantiene la guía para docentes de AI Teaching Assistant (recorridos «Mostrame esta pantalla», tarjeta «Primeros pasos» y página /ayuda) alineada con las pantallas reales. Usala siempre que se agregue, renombre o saque una pantalla o un botón del frontend, cuando se cambie cómo funciona algo que un docente ve, cuando falle backend/test/guia.test.ts, o cuando alguien pida explicar, documentar o simplificar el uso de la app para profesores, aunque no diga "guía".
---

# Guía para docentes

La app la usan profesores con poca experiencia con la tecnología. La guía es lo que evita que abandonen, y envejece con cada cambio de pantalla, porque
nombra botones reales y señala elementos reales. Una guía desactualizada es peor que ninguna: manda a buscar un botón que no existe.

## Dónde está cada cosa

| Qué | Archivo |
|---|---|
| Todo el contenido y la lógica | `frontend/lib/guia.ts` |
| Recorrido sobre la pantalla | `frontend/app/components/Recorrido.tsx` |
| Tarjeta del inicio | `frontend/app/components/PrimerosPasos.tsx` |
| Página de ayuda | `frontend/app/ayuda/page.tsx` |
| Controles automáticos | `backend/test/guia.test.ts` |

El texto se edita solo en `guia.ts`; los componentes no llevan contenido propio.

## Cuando cambia una pantalla

1. Buscá en `guia.ts` el botón o la sección que cambió y actualizá cada mención: suele aparecer en un recorrido y también en `PASOS_GUIA` o en
   `PREGUNTAS_FRECUENTES`.
2. Para señalar algo nuevo, agregale `data-guia="nombre"` al elemento de la pantalla (sobre un elemento que ya exista, sin sumar envoltorios que
   alteren el diseño) y un paso con ese `destino` en `RECORRIDOS`.
3. Si es una pantalla nueva del docente, agregá su recorrido con la ruta. El primer paso va sin `destino`: así el recorrido tiene algo que mostrar aunque
   la pantalla esté vacía.
4. Si cambió una regla (qué se puede borrar, cuándo sale un mail), revisá las preguntas frecuentes contra el código, no contra la memoria.
5. Corré `npm test` en `backend/`.

Los pasos cuyo elemento no está en la pantalla se saltean solos. Por eso un elemento que aparece solo en ciertos estados, como los filtros de un examen
con respuestas, puede ser destino sin problema.

## Cómo escribir

- **Voseo y frases cortas.** Hablale a una persona, no describas un sistema: «Filtrá por lo que falta revisar», no «El módulo permite filtrar».
- **Nombrá los botones exactamente como se ven, entre « ».** El test comprueba que ese texto exista en alguna pantalla.
- **Sin jerga.** Nada de servidor, base de datos, token, API, deploy. Cuando algo técnico importa, decí su consecuencia: «lo que escribís se guarda
  automáticamente», no «autoguardado en el servidor».
- **Decí qué significa la acción, no solo dónde se hace.** Sobre todo si no se puede deshacer o si alguien más la va a ver.
- **Tranquilizá con hechos.** La preocupación habitual es «¿y si rompo algo?» y «¿la IA decide por mí?». Respondela cuando sea cierto: «Nadie ve el
  examen hasta que lo publiques».
- **Un paso de recorrido entra en dos o tres líneas.** Si no entra, va en `/ayuda`.

**Ejemplo**
Mal: «Mediante la vara se aplica un ajuste auditable a la distribución de notas sugeridas.»
Bien: «Sirve para subir o bajar las notas sugeridas de todos con una misma regla. Si no la necesitás, ignorá esta pestaña.»

## Movimiento

Cada animación tiene una función: llevar la vista de un lugar a otro o confirmar un avance. Son cortas, se reproducen una sola vez y salen con
`cubic-bezier(0.22, 1, 0.36, 1)`. Nada se repite en bucle mientras alguien lee. Toda animación nueva necesita su caso en
`@media (prefers-reduced-motion: reduce)`, y el contenido se tiene que entender sin ella.

## Cómo comprobarlo

`npm test` cubre que los destinos existan, que los botones nombrados existan y que no haya jerga. No comprueba que el señalado quede bien: si tocaste
`Recorrido.tsx` o moviste un destino, abrí la pantalla y hacé el recorrido en escritorio y a 390 px de ancho.
