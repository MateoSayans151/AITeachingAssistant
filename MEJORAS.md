# Notas de setup y mejoras pendientes

Este documento junta lo que encontramos al levantar el proyecto por primera vez (errores reales,
no hipotéticos) para que el resto del equipo no pise los mismos problemas. No reemplaza al
[README.md](./README.md) — son notas complementarias, más el registro de qué se podría mejorar.

## 1. La connection string de Supabase no es tan directa como parece

Al completar `DATABASE_URL` en `backend/.env` nos encontramos con tres errores en cadena:

1. **`invalid IPv6 address in database URL`** — pasa si dejás los corchetes `[ ]` de los
   placeholders del `.env.example` (son solo notación de "completar acá", no van en el valor
   final). Prisma interpreta `[algo]` en la posición del host como una dirección IPv6 literal.
2. **Contraseña con caracteres especiales** — si tu contraseña de Postgres tiene `@`, `:`, `/`,
   `?` o `#`, hay que codificarlos (`@` → `%40`, etc.) porque rompen el parseo de la URL. Un `@`
   sin codificar en la contraseña hace que la URL tenga dos `@` y no se sepa cuál separa
   usuario:contraseña de host.
3. **`no tenant identifier provided (external_id or sni_hostname required)`** — el pooler de
   Supabase (Supavisor) necesita el usuario como `postgres.<project-ref>`, **no** `postgres` a
   secas. El `.env.example` actual no lo refleja.

**Recomendación:** en vez de armar la URL a mano desde la plantilla, copiar el connection string
completo tal cual lo da Supabase (**Settings → Database → Connection string**) y solo reemplazar
la contraseña (codificada).

## 2. Transaction pooler (6543) vs. Session pooler (5432)

Con el Transaction pooler (puerto 6543, el que recomienda el `.env.example` actual), `npx prisma
db push` se quedaba **colgado indefinidamente** al conectar — ni error ni éxito. Con el Session
pooler (puerto 5432) conectó y sincronizó en 2 segundos.

Esto es un patrón conocido de Prisma + Supabase: el modo transaction pooler no soporta bien las
queries de introspección que usa `db push` / `migrate`. La solución recomendada por Prisma es usar
**dos variables**, no una:

- `DIRECT_URL` (Session pooler, puerto 5432) → para `prisma db push` / `prisma migrate`.
- `DATABASE_URL` (Transaction pooler, puerto 6543) → para que la app corra en runtime
  (mejor manejo de conexiones concurrentes).

Se implementaría así en [`backend/prisma/schema.prisma`](./backend/prisma/schema.prisma):

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")   // pooled, para runtime
  directUrl = env("DIRECT_URL")     // directo/session, para migraciones
}
```

Con esto el equipo deja de tener que acordarse "para migrar cambio de puerto a mano" — Prisma usa
automáticamente `directUrl` cuando corresponde. Es la mejora de mayor impacto de esta lista.

**Sigue pendiente (diferido a propósito).** No se aplicó todavía: `directUrl = env("DIRECT_URL")` hace que
Prisma exija esa variable al migrar, así que a quien ya tiene su `backend/.env` armado (sin `DIRECT_URL`) le
fallarían `prisma db push` / `migrate` hasta que la agregue. Hay que coordinarlo con el equipo: cambiar
`schema.prisma`, sumar `DIRECT_URL` al `.env.example` y avisar a todos que la agreguen a su `.env`. Mientras
tanto, el workaround quedó documentado en los comentarios de `backend/.env.example`: cambiar `DATABASE_URL` a
la URL del Session pooler (puerto 5432, sin `?pgbouncer=true`) solo mientras se corre `prisma db push` /
`migrate`, y volver a la de 6543 después.

## 3. `backend/.env.example` estaba desactualizado (resuelto)

El template viejo (`postgres:[PASSWORD]@[PROJECT-REF].pooler.supabase.com`) no matcheaba el formato
real que da Supabase hoy (`postgres.<project-ref>@aws-0-<region>.pooler.supabase.com`). Ya quedó
reescrito: explica el formato (usuario `postgres.<project-ref>`, host `aws-0-<region>.pooler.supabase.com`,
contraseña URL-encoded, sin corchetes), trae un ejemplo y documenta la alternativa del Session pooler (5432)
para `prisma db push` / `migrate`. Lo único que sigue pendiente es el split `DATABASE_URL`/`DIRECT_URL` del
punto 2.

## 4. No había `.gitignore`

El repo no tenía ningún `.gitignore` (ni raíz ni por carpeta). Riesgo real: el primer `git add .`
después de crear `backend/.env` (con la contraseña de la DB y la API key de Google adentro) lo
hubiera subido al repo. Ya se agregó uno en la raíz que ignora `node_modules/`, `.env*`, builds,
etc. — hay que commitearlo.

**Importante para el equipo:** nunca se pasa el `.env` real por Discord/WhatsApp/mail — cada uno
arma el suyo desde `.env.example` con sus propias claves.

## 5. Correr comandos de Prisma siempre desde `backend/`

Si corrés `npx prisma ...` estando parado en la raíz del repo (no en `backend/`), `npx` no
encuentra el binario local (`backend/node_modules/.bin/prisma`, versión 5.x fijada en
`package.json`) y baja una versión distinta de internet — en nuestro caso terminó instalando una
release candidate (8.0.0-rc) con un CLI totalmente distinto (sin `db push`, con otros comandos).
El resultado es un error confuso que no tiene nada que ver con la base de datos. Regla simple:
`cd backend` antes de cualquier `npx prisma ...`.

## 6. RLS en Supabase: hay que aplicar la migración en cada base

La anon key de Supabase es pública (el front la publica), así que sin Row Level Security cualquiera podría
leer o escribir las tablas de `public` por la Data API (PostgREST), incluida la clave de respuestas en
`preguntas.opciones`. La migración `supabase/migrations/20261004_rls_todas_las_tablas.sql` activa RLS en todas
las tablas sin crear policies (deny-all para `anon`/`authenticated`); el backend no se entera porque Prisma se
conecta como `postgres`, que saltea RLS. Hay que correrla una vez en cada base ya creada (y volver a correrla si
se agregan tablas); el README tiene el `curl` para verificar que quedó bien.

## 7. Otras mejoras menores, sin urgencia

- **Pinnear versión de Node** (agregar `"engines": { "node": ">=20" }` en ambos `package.json`, o
  un `.nvmrc`) — hoy no está fijada y podemos terminar con versiones distintas entre compañeros.
- **Agregar script `prisma:push`** a `backend/package.json` (hoy solo están `prisma:generate`,
  `prisma:migrate`, `prisma:studio`) para no depender de acordarse el comando `npx prisma db push`
  a mano.
- **`GOOGLE_MODEL_ID` y modelo de embeddings (verificados el 2026-10-04).** Contra la doc oficial de Gemini
  (`ai.google.dev/gemini-api/docs/models`): `gemini-3.1-flash-lite` figura como modelo estable (la variante
  `gemini-3.1-flash-lite-preview` está dada de baja, no usarla) y `gemini-embedding-001` también es estable y
  admite 768 dimensiones. No hace falta cambiar nada; solo volver a mirar ese listado si aparece un error de
  API por un ID vencido. La lectura de la doc fue automática: queda una confirmación manual con una llamada
  real a la API antes del deploy.
- **Decidir `migrate dev` vs. `db push`** como estrategia única del equipo: el README ofrece las
  dos opciones (aunque no son equivalentes: Prisma no crea `rag_fragmentos_material` ni activa RLS, por eso
  el camino recomendado es `supabase/schema.sql`), pero como es una sola base de Supabase compartida por todos,
  conviene que quede claro que **solo una persona necesita correr la sincronización una vez** —
  si cada uno corre `db push` por separado no pasa nada grave (es idempotente), pero con
  `migrate dev` sí se generan archivos de migración que deberían commitearse, así que si migran a
  ese approach hay que decidir quién los genera.

## Resumen: qué requiere acción

| Ítem | Impacto | Acción sugerida |
|---|---|---|
| Split `DATABASE_URL`/`DIRECT_URL` (punto 2) | Alto — evita el cuelgue de `db push` | Pendiente: editar `schema.prisma` + `.env.example` y avisar al equipo (ver punto 2) |
| Actualizar `.env.example` (punto 3) | Alto — evita los 3 errores de conexión | Ya resuelto |
| RLS en todas las tablas (punto 6) | Alto (seguridad) | Correr la migración `20261004` en cada base y verificar con el `curl` del README |
| `.gitignore` | Alto (seguridad) | Ya resuelto, falta commitear |
| Correr Prisma desde `backend/` | Medio — evita error confuso | Solo difundirlo al equipo |
| Pin de versión de Node | Bajo | Agregar `engines` o `.nvmrc` |
| Script `prisma:push` | Bajo (comodidad) | Agregar línea a `package.json` |
| Confirmar `GOOGLE_MODEL_ID` | Medio | Ya verificado contra la doc (punto 7); falta una prueba real con la API key |
