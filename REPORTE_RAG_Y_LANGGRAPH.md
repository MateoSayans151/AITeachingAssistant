# Reporte: RAG y futura indexacion con Python/LangGraph

## Implementacion actual

El RAG queda dentro del backend NestJS, sin crear ni gestionar branches de Supabase.

1. Al crear un material, `RagService` lo divide en fragmentos de aproximadamente 2.200 caracteres con solapamiento.
2. Genera un embedding de 768 dimensiones por fragmento con `text-embedding-004` y lo guarda en `rag_fragmentos_material` (pgvector).
3. Antes de corregir las preguntas abiertas, genera un embedding de la consigna y las respuestas del alumno y recupera los seis fragmentos mas cercanos, siempre filtrados por `curso_id`.
4. Solo esos fragmentos llegan a `AiService`. La rubrica sigue determinando la nota y la validacion de notas sigue ocurriendo en codigo.

La migracion a aplicar en la base elegida es `supabase/migrations/20260921_add_rag_materiales.sql`. Para una base nueva, `supabase/schema.sql` ya incluye las mismas estructuras. Despues de aplicar la migracion, llamar `POST /api/cursos/:cursoId/materiales/reindexar` para indexar materiales que ya existian.

## Seguridad y operacion

- El `curso_id` se filtra dentro de la consulta vectorial; no se recuperan fragmentos de otra materia.
- Al borrar un material, sus fragmentos se borran por `ON DELETE CASCADE`.
- Si falla el embedding al crear un material, el texto se conserva y se puede reintentar la indexacion mediante el endpoint.
- No cambiar `RAG_EMBEDDING_MODEL_ID` ni `RAG_EMBEDDING_DIMENSIONS` sin reindexar: vectores de modelos o dimensiones distintas no se pueden comparar.
- La indexacion es sincronica y adecuada para texto plano del MVP. Para PDF/Word o lotes grandes deberia pasar a una cola.

## Microservicio futuro: Python + LangGraph

No conviene reemplazar NestJS. Conviene agregar un servicio Python separado solamente cuando haya procesamiento largo o condicional:

```text
API Nest: recibe PDF/Word y crea trabajo de indexacion
  -> worker Python/LangGraph: extrae texto
  -> valida calidad y detecta OCR fallido
  -> fragmenta y genera embeddings por lotes
  -> reintenta fallos
  -> actualiza pgvector y estado del documento
  -> NestJS muestra progreso o solicita revision del docente
```

LangGraph aporta persistencia de estado, reintentos, bifurcaciones y pausas de revision humana. NestJS conserva autenticacion, API publica, reglas de negocio, Prisma y correcciones. Ambos servicios comparten Supabase y una cola; no deberian compartir acceso irrestricto a tablas de negocio.

## Jev y costo/latencia

Interpreto “.jev” como **Jev** de TypeSafe, no como una extension de archivo. Jev es un modelo de decisiones tipadas: no redacta feedback ni reemplaza al LLM de correccion.

Podria agregarse opcionalmente despues de pgvector:

```text
pgvector recupera 12 candidatos rapidos
  -> Jev puntua relevancia pregunta-fragmento en paralelo
  -> se envian solo los mejores 3-5 al LLM corrector
```

Esto puede reducir tokens de entrada y mejorar precision cuando haya mucho material parecido. No necesariamente acelera la busqueda de un curso pequeno: suma una llamada remota, por lo que hay que medir latencia y calidad contra el RAG simple primero. Tampoco reemplaza embeddings ni pgvector para un corpus grande; funciona mejor como reranker/filtro opcional.

La decision recomendada para el MVP es medir primero: porcentaje de respuestas con evidencia relevante recuperada, tokens enviados al modelo, latencia p95 y correcciones modificadas por docentes. Incorporar Jev solo si el conjunto de materiales crece y esos datos muestran que los primeros seis fragmentos no son suficientemente precisos.

Referencias: [Supabase semantic search](https://supabase.com/docs/guides/ai/semantic-search), [Supabase RAG con permisos](https://supabase.com/docs/guides/ai/rag-with-permissions), [Jev para reranking RAG](https://jev-agent.com/use-cases/rag-reranking).
