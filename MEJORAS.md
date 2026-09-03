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
automáticamente `directUrl` cuando corresponde. Es la mejora de mayor impacto de esta lista;
avisen si quieren que la aplique.

## 3. `backend/.env.example` está desactualizado

El template actual (`postgres:[PASSWORD]@[PROJECT-REF].pooler.supabase.com`) no matchea el formato
real que da Supabase hoy (`postgres.<project-ref>@aws-0-<region>.pooler.supabase.com`). Vale la
pena actualizarlo — junto con el cambio del punto 2 — para que el próximo que lo complete no pase
por los mismos tres errores.

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

## 6. Otras mejoras menores, sin urgencia

- **Pinnear versión de Node** (agregar `"engines": { "node": ">=20" }` en ambos `package.json`, o
  un `.nvmrc`) — hoy no está fijada y podemos terminar con versiones distintas entre compañeros.
- **Agregar script `prisma:push`** a `backend/package.json` (hoy solo están `prisma:generate`,
  `prisma:migrate`, `prisma:studio`) para no depender de acordarse el comando `npx prisma db push`
  a mano.
- **Confirmar `GOOGLE_MODEL_ID`** (`gemini-3.1-flash-lite` en el `.env.example`): el propio
  comentario del archivo dice que hay que confirmarlo "antes de agosto 2026" — ya estamos después
  de esa fecha, conviene chequear en la consola de Google que el nombre del modelo siga siendo
  válido antes de que alguien pierda tiempo debuggeando un error de API por un ID vencido.
- **Decidir `migrate dev` vs. `db push`** como estrategia única del equipo: el README ofrece las
  dos opciones como equivalentes, pero como es una sola base de Supabase compartida por todos,
  conviene que quede claro que **solo una persona necesita correr la sincronización una vez** —
  si cada uno corre `db push` por separado no pasa nada grave (es idempotente), pero con
  `migrate dev` sí se generan archivos de migración que deberían commitearse, así que si migran a
  ese approach hay que decidir quién los genera.

## Resumen: qué requiere acción

| Ítem | Impacto | Acción sugerida |
|---|---|---|
| Split `DATABASE_URL`/`DIRECT_URL` (punto 2) | Alto — evita el cuelgue de `db push` | Editar `schema.prisma` + `.env.example` |
| Actualizar `.env.example` (punto 3) | Alto — evita los 3 errores de conexión | Reescribir el template |
| `.gitignore` | Alto (seguridad) | Ya resuelto, falta commitear |
| Correr Prisma desde `backend/` | Medio — evita error confuso | Solo difundirlo al equipo |
| Pin de versión de Node | Bajo | Agregar `engines` o `.nvmrc` |
| Script `prisma:push` | Bajo (comodidad) | Agregar línea a `package.json` |
| Confirmar `GOOGLE_MODEL_ID` | Medio | Chequear en Google AI Studio |
