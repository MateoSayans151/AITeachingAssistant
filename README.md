# AI Teaching Assistant — MVP

Asistente de corrección con IA para docentes. Trabajo de Tecnología e Innovación (UADE) —
Mateo Sayanz, Facundo Conde, Tomás Lonati.

Stack: **Next.js** (frontend) + **NestJS** (backend) + **Supabase/Postgres** (DB) + **Vercel AI SDK**
para la integración con el modelo de IA (Gemini 3.1 Flash-Lite por default, Claude Haiku 4.5 como
alternativa).

## Flujo del MVP

1. El docente carga **consigna + rúbrica** una vez por trabajo práctico (`/trabajos/nuevo`).
2. Carga las **entregas** de los alumnos en texto (`/trabajos/[id]/entregas/nueva`). Al guardar, el
   backend arma un prompt (consigna + rúbrica + entrega) y le pide al LLM una salida estructurada
   (JSON) con nota por criterio, nota total y feedback.
3. El docente **revisa** cada corrección (`/trabajos/[id]/revisar`): puede aceptarla tal cual o editar
   la nota y el feedback antes de que se considere "final". Nada llega al alumno sin pasar por acá.
4. Una vez que hay varias entregas corregidas, el docente puede generar un **resumen agregado del
   curso** (`/trabajos/[id]/resumen`): un segundo prompt que identifica qué criterios o conceptos
   generaron más dificultad entre los alumnos.

No hay OCR ni carga de imágenes/PDF escaneado en este MVP — todo es texto plano, a propósito (ver el
documento de contexto del proyecto).

## 1. Base de datos (Supabase)

1. Creá un proyecto en [supabase.com](https://supabase.com).
2. Andá a **SQL Editor** y corré el contenido de [`supabase/schema.sql`](./supabase/schema.sql).
   Esto crea las 6 tablas: `docentes`, `trabajos_practicos`, `criterios_rubrica`, `entregas`,
   `correcciones`, `resumenes_curso`.
3. Andá a **Settings → Database → Connection string** y copiá la de tipo **Transaction pooler**
   (puerto 6543). La vas a necesitar en el paso 2.

> Alternativa: en vez de correr `schema.sql` a mano, podés dejar que Prisma cree las tablas por vos
> con `npx prisma migrate dev` (ver paso 2). Los dos caminos crean el mismo esquema — no hace falta
> hacer los dos.

## 2. Backend (NestJS)

```bash
cd backend
npm install
cp .env.example .env
```

Completá `.env`:

- `DATABASE_URL`: el connection string de Supabase del paso 1.
- `AI_PROVIDER`: `google` (default, Gemini 3.1 Flash-Lite) o `anthropic` (Claude Haiku 4.5).
- `GOOGLE_GENERATIVE_AI_API_KEY`: tu clave de [Google AI Studio](https://aistudio.google.com/apikey)
  (si usás `google`).
- `ANTHROPIC_API_KEY`: tu clave de [console.anthropic.com](https://console.anthropic.com) (si usás
  `anthropic`).

Generá el cliente de Prisma y sincronizá el esquema:

```bash
npx prisma generate
npx prisma db push   # si NO corriste schema.sql a mano en Supabase
```

Levantá el servidor:

```bash
npm run start:dev
```

Debería quedar escuchando en `http://localhost:3001/api`.

## 3. Frontend (Next.js)

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Por default apunta a `http://localhost:3001/api` (backend local). Abrí `http://localhost:3000`.

La primera vez te va a pedir nombre y email para "identificarte" como docente — es un reemplazo
mínimo de login real (no hay autenticación en este MVP; queda para v2 con Supabase Auth).

## 4. Deploy

- **Frontend**: Vercel, apuntando a la carpeta `frontend/`. Variable de entorno
  `NEXT_PUBLIC_API_URL` = URL pública del backend + `/api`.
- **Backend**: Vercel también funciona (hay soporte oficial para NestJS), o cualquier host de Node.
  Variables de entorno: las mismas de `.env`, más `FRONTEND_ORIGIN` apuntando a la URL de Vercel del
  frontend (para CORS).
- **DB**: ya vive en Supabase, no hace falta deployarla.

## Sobre el modelo de IA elegido

Se comparó **Gemini 3.1 Flash-Lite** contra **GPT-5 nano** (ambos son las opciones "baratas" de cada
proveedor). En benchmarks generales (MMLU Pro, GPQA) Gemini 3.1 Flash-Lite rinde notablemente mejor en
comprensión y seguimiento de instrucciones — lo que más importa acá, porque el modelo tiene que seguir
una rúbrica con matices y devolver un JSON estructurado consistente. GPT-5 nano es más barato por
token, pero para el volumen de un MVP de facultad la diferencia de costo es marginal frente a la
diferencia de calidad. Por eso quedó como default, con Claude Haiku 4.5 como alternativa intercambiable
por variable de entorno (gracias al AI SDK, cambiar de proveedor no requiere tocar código).

**Nota:** los nombres exactos de modelos "preview" (como `gemini-3.1-flash-lite`) pueden cambiar antes
de production. Confirmá el ID exacto en la consola del proveedor antes de dar por cerrada esta
decisión, y considerá correr la comparación de calidad que ya proponía el documento de Clase 3
(15-20 entregas reales, dos o tres modelos, evaluar feedback y no solo precio).

## Qué falta para una v2

- Autenticación real (Supabase Auth) en vez de la identificación por email.
- Edición inline de la nota por criterio (hoy solo se edita la nota total y el feedback).
- Carga de PDF/Word con extracción de texto (hoy es texto plano pegado o escrito).
- Notificación al alumno cuando el docente confirma la corrección.
- Cola de trabajo para la corrección con IA en vez de ejecutarla sincrónicamente al crear la entrega.
