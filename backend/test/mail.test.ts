// Tests del envío de la nota por mail (Resend): el cliente HTTP con un fetch falso (nunca se llama a Resend de verdad),
// el contenido del mail, el servicio de notificaciones (una sola vez, lotes, cuota), el rechazo de publicar notas sin
// el envío configurado y los disparadores al revisar. Corren sin base de datos ni red:
//   npm test
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ConflictException, ForbiddenException, RequestMethod } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MailService, MOTIVO_CUOTA, MailParaEnviar, ResultadoEnvio } from '../src/mail/mail.service';
import { armarMailResultado, detalleSumaLaNota } from '../src/mail/mail-resultado.util';
import { NotificacionesService } from '../src/mail/notificaciones.service';
import { ExamenesService } from '../src/examenes/examenes.service';
import { ExamenesController } from '../src/examenes/examenes.controller';
import { RespuestasExamenService } from '../src/respuestas-examen/respuestas-examen.service';
import { armarResultadoParaAlumno } from '../src/respuestas-examen/resultado.util';

const turno = () => new Promise<void>((r) => setImmediate(r));

/** Espera (cediendo el turno) hasta que se cumpla la condición; falla si no llega nunca. */
async function esperarHasta(condicion: () => boolean) {
  for (let i = 0; i < 500; i++) {
    if (condicion()) return;
    await turno();
  }
  assert.fail('La condición no se cumplió a tiempo');
}

function compuerta() {
  let abrir!: () => void;
  const abierta = new Promise<void>((r) => (abrir = r));
  return { abierta, abrir };
}

const loggerMudo = (logs: string[] = []) => ({
  warn: (m: unknown) => logs.push(String(m)),
  error: (m: unknown) => logs.push(String(m)),
  log: () => undefined,
  debug: () => undefined,
});

// ---------------------------------------------------------------------------
// 1. MailService: cliente de Resend con fetch falso
// ---------------------------------------------------------------------------
const KEY = 're_SECRETA_abc123XYZ';
const ENV: Record<string, string> = { RESEND_API_KEY: KEY, EMAIL_FROM: 'AI Teaching Assistant <notas@mail.ejemplo.com>' };

type Programada = { status: number; body?: unknown; headers?: Record<string, string> } | Error;

/** fetch de mentira: responde lo programado (la última se repite) y registra cada pedido. Nunca sale a la red. */
function fetchFalso(programadas: Programada[]) {
  const llamadas: Array<{ url: string; init: any; cuerpo: any }> = [];
  const impl = (async (url: unknown, init: any) => {
    llamadas.push({ url: String(url), init, cuerpo: JSON.parse(init.body) });
    const p = programadas[Math.min(llamadas.length - 1, programadas.length - 1)];
    if (p instanceof Error) throw p;
    return new Response(typeof p.body === 'string' ? p.body : JSON.stringify(p.body ?? {}), { status: p.status, headers: p.headers });
  }) as unknown as typeof fetch;
  return { impl, llamadas };
}

function mailConFalsos(programadas: Programada[], env: Record<string, string | undefined> = ENV) {
  const { impl, llamadas } = fetchFalso(programadas);
  const esperas: number[] = [];
  const logs: string[] = [];
  const mail = new MailService({ get: (clave: string) => env[clave] } as any, { fetch: impl, esperar: async (ms) => void esperas.push(ms) });
  (mail as any).logger = loggerMudo(logs);
  return { mail, llamadas, esperas, logs };
}

const MAIL: MailParaEnviar = {
  to: 'ana@mail.com',
  subject: 'Tu nota en "Parcial 1"',
  html: '<p>hola</p>',
  text: 'hola',
  replyTo: 'docente@facu.edu.ar',
  idempotencyKey: 'resultado-r-1',
};

const fallo = (r: ResultadoEnvio) => {
  assert.equal(r.ok, false);
  return r as Extract<ResultadoEnvio, { ok: false }>;
};

test('MailService: manda a Resend con el formato de la API (URL, headers, cuerpo, Idempotency-Key y timeout)', async () => {
  const { mail, llamadas } = mailConFalsos([{ status: 200, body: { id: 'abc' } }]);
  assert.deepEqual(await mail.enviar(MAIL), { ok: true });

  assert.equal(llamadas.length, 1);
  const { url, init, cuerpo } = llamadas[0];
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.headers['Idempotency-Key'], 'resultado-r-1');
  assert.ok(init.signal instanceof AbortSignal && !init.signal.aborted, 'cada pedido lleva su timeout');
  assert.deepEqual(cuerpo, {
    from: ENV.EMAIL_FROM,
    to: ['ana@mail.com'],
    subject: 'Tu nota en "Parcial 1"',
    html: '<p>hola</p>',
    text: 'hola',
    reply_to: 'docente@facu.edu.ar',
  });
});

test('MailService: sin replyTo ni idempotencyKey no manda esos campos', async () => {
  const { mail, llamadas } = mailConFalsos([{ status: 200 }]);
  await mail.enviar({ to: 'a@b.com', subject: 's', html: 'h', text: 't' });
  assert.equal('reply_to' in llamadas[0].cuerpo, false);
  assert.equal('Idempotency-Key' in llamadas[0].init.headers, false);
});

test('MailService: "configurado" necesita API key Y remitente; sin ellos no sale ningún pedido', async () => {
  for (const env of [{}, { RESEND_API_KEY: KEY }, { EMAIL_FROM: ENV.EMAIL_FROM }, { RESEND_API_KEY: '  ', EMAIL_FROM: ENV.EMAIL_FROM }]) {
    const { mail, llamadas } = mailConFalsos([{ status: 200 }], env);
    assert.equal(mail.configurado, false, JSON.stringify(env));
    const r = fallo(await mail.enviar(MAIL));
    assert.match(r.motivo, /RESEND_API_KEY y EMAIL_FROM/);
    assert.equal(llamadas.length, 0);
  }
  assert.equal(mailConFalsos([]).mail.configurado, true);
});

test('MailService: un 4xx de Resend devuelve el motivo en castellano, sin cuota y sin reintentar', async () => {
  const { mail, llamadas, esperas } = mailConFalsos([
    { status: 422, body: { statusCode: 422, name: 'validation_error', message: 'The domain mail.ejemplo.com is not verified.' } },
  ]);
  const r = fallo(await mail.enviar(MAIL));
  assert.equal(r.motivo, 'Resend rechazó el mail: The domain mail.ejemplo.com is not verified.');
  assert.equal(r.cuota, undefined);
  assert.equal(llamadas.length, 1);
  assert.deepEqual(esperas, []);
});

test('MailService: credenciales inválidas, conflicto de idempotencia, caída de Resend y cuerpo que no es JSON', async () => {
  const caso = async (p: Programada) => fallo(await mailConFalsos([p]).mail.enviar(MAIL)).motivo;
  assert.match(await caso({ status: 401, body: { name: 'missing_api_key', message: 'Missing API key in the authorization header' } }), /revisá RESEND_API_KEY/);
  assert.match(await caso({ status: 403, body: { name: 'invalid_api_key', message: 'API key is invalid' } }), /revisá RESEND_API_KEY/);
  assert.match(await caso({ status: 409, body: { name: 'concurrent_idempotent_requests', message: 'x' } }), /envío en curso/);
  assert.match(await caso({ status: 503, body: { name: 'service_unavailable', message: 'x' } }), /no está disponible .*503/);
  assert.equal(await caso({ status: 400, body: '<html>Bad gateway</html>' }), 'Resend rechazó el mail: <html>Bad gateway</html>');
  assert.equal(await caso({ status: 400, body: '' }), 'Resend rechazó el mail (HTTP 400)');
});

test('MailService: un 429 por rate limit se reintenta UNA vez, esperando lo que pide Retry-After', async () => {
  const { mail, llamadas, esperas } = mailConFalsos([
    { status: 429, body: { name: 'rate_limit_exceeded', message: 'Too many requests' }, headers: { 'retry-after': '2' } },
    { status: 200, body: { id: 'abc' } },
  ]);
  assert.deepEqual(await mail.enviar(MAIL), { ok: true });
  assert.equal(llamadas.length, 2);
  assert.deepEqual(esperas, [2000]);
  // El reintento es el mismo pedido (misma Idempotency-Key): si el primero había entrado no se duplica.
  assert.equal(llamadas[1].init.headers['Idempotency-Key'], 'resultado-r-1');
  assert.deepEqual(llamadas[1].cuerpo, llamadas[0].cuerpo);
});

test('MailService: rate limit sin Retry-After espera 1 s, un Retry-After enorme se acota a 5 s y no se reintenta más de una vez', async () => {
  const sinHeader = mailConFalsos([{ status: 429, body: { name: 'rate_limit_exceeded', message: 'x' } }]);
  const r = fallo(await sinHeader.mail.enviar(MAIL));
  assert.equal(sinHeader.llamadas.length, 2); // el original y un solo reintento
  assert.deepEqual(sinHeader.esperas, [1000]);
  assert.equal(r.cuota, undefined, 'rate limit no es cuota: el lote sigue');
  assert.match(r.motivo, /limitó el ritmo/);

  const largo = mailConFalsos([{ status: 429, body: { name: 'rate_limit_exceeded', message: 'x' }, headers: { 'retry-after': '120' } }, { status: 200 }]);
  assert.deepEqual(await largo.mail.enviar(MAIL), { ok: true });
  assert.deepEqual(largo.esperas, [5000]);
});

test('MailService: un 429 por cuota diaria o mensual NO se reintenta y se marca cuota: true', async () => {
  for (const name of ['daily_quota_exceeded', 'monthly_quota_exceeded']) {
    const { mail, llamadas, esperas } = mailConFalsos([{ status: 429, body: { statusCode: 429, name, message: 'You have exceeded your quota.' }, headers: { 'retry-after': '1' } }]);
    const r = fallo(await mail.enviar(MAIL));
    assert.equal(r.cuota, true, name);
    assert.equal(r.motivo, MOTIVO_CUOTA);
    assert.equal(llamadas.length, 1, `${name}: reintentar solo gastaría pedidos`);
    assert.deepEqual(esperas, []);
  }
  assert.equal(MOTIVO_CUOTA, 'Se alcanzó el límite de envíos de tu plan de Resend; reintentá más tarde.');

  // Si el reintento por rate limit se topa con la cuota, también se detecta.
  const { mail } = mailConFalsos([
    { status: 429, body: { name: 'rate_limit_exceeded', message: 'x' } },
    { status: 429, body: { name: 'daily_quota_exceeded', message: 'x' } },
  ]);
  assert.equal(fallo(await mail.enviar(MAIL)).cuota, true);
});

test('MailService: timeout y errores de red devuelven un motivo y no tiran', async () => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const r = fallo(await mailConFalsos([timeout]).mail.enviar(MAIL));
  assert.match(r.motivo, /no respondió a tiempo/);
  assert.equal(r.cuota, undefined);

  const red = fallo(await mailConFalsos([new TypeError('fetch failed')]).mail.enviar(MAIL));
  assert.equal(red.motivo, 'No se pudo conectar con Resend: fetch failed');
});

test('MailService: en modo prueba el mail va a EMAIL_REDIRECT_TO y el asunto avisa a quién iba', async () => {
  const { mail, llamadas } = mailConFalsos([{ status: 200 }], { ...ENV, EMAIL_REDIRECT_TO: ' yo@prueba.com ' });
  assert.equal(mail.modoPrueba, 'yo@prueba.com');
  await mail.enviar(MAIL);
  assert.deepEqual(llamadas[0].cuerpo.to, ['yo@prueba.com']);
  assert.equal(llamadas[0].cuerpo.subject, '[PRUEBA → ana@mail.com] Tu nota en "Parcial 1"');
  assert.equal(llamadas[0].cuerpo.reply_to, 'docente@facu.edu.ar'); // lo demás queda igual

  const normal = mailConFalsos([{ status: 200 }]);
  assert.equal(normal.mail.modoPrueba, null);
  await normal.mail.enviar(MAIL);
  assert.deepEqual(normal.llamadas[0].cuerpo.to, ['ana@mail.com']);
  assert.equal(normal.llamadas[0].cuerpo.subject, 'Tu nota en "Parcial 1"');
});

test('MailService: la API key nunca aparece en un motivo ni en un log, ni siquiera si Resend o la red la repiten', async () => {
  const hostiles: Programada[] = [
    { status: 401, body: { name: 'invalid_api_key', message: `API key ${KEY} is invalid` } },
    { status: 422, body: { name: 'validation_error', message: `Bearer ${KEY} rechazado` } },
    { status: 500, body: `error interno con ${KEY}` },
    new TypeError(`fetch failed (Authorization: Bearer ${KEY})`),
    Object.assign(new Error(`timeout ${KEY}`), { name: 'TimeoutError' }),
    { status: 429, body: { name: 'daily_quota_exceeded', message: KEY } },
  ];
  for (const p of hostiles) {
    const { mail, logs } = mailConFalsos([p]);
    const r = await mail.enviar(MAIL);
    const todo = JSON.stringify(r) + logs.join('\n');
    assert.ok(!todo.includes(KEY), `se filtró la key: ${todo}`);
    assert.ok(!/re_SECRETA/.test(todo));
  }
  // Ni siquiera en un éxito se loguea nada con la clave.
  const ok = mailConFalsos([{ status: 200 }]);
  await ok.mail.enviar(MAIL);
  assert.ok(!ok.logs.join('').includes(KEY));
});

// ---------------------------------------------------------------------------
// 2. Contenido del mail
// ---------------------------------------------------------------------------
const resultadoBase = {
  titulo: 'Parcial 1',
  notaFinal: 7.5,
  escala: { min: 0, max: 10 },
  feedback: 'Muy buen trabajo.\nRepasá normalización.',
  porPregunta: [
    { enunciado: '¿Qué es un índice?', notaFinal: 4, puntajeMaximo: 4 },
    { enunciado: 'Explicá la normalización', notaFinal: 3.5, puntajeMaximo: 6 },
  ],
};
const datosBase = { nombreAlumno: 'Ana Pérez', nombreDocente: 'Prof. Gómez', nombreCurso: 'Bases de Datos' };

test('armarMailResultado: asunto, saludo, nota destacada en formato es-AR, feedback, tabla y pie', () => {
  const { subject, html, text } = armarMailResultado(resultadoBase, datosBase);
  assert.equal(subject, 'Tu nota en "Parcial 1"');
  for (const contenido of [html, text]) {
    assert.match(contenido, /Hola Ana Pérez,/);
    assert.match(contenido, /7,5 sobre 10/);
    assert.match(contenido, /Muy buen trabajo\./);
    assert.match(contenido, /Este mail lo envió AI Teaching Assistant en nombre de Prof\. Gómez\. Si tenés dudas sobre tu nota, respondé a este mail: le llega a tu docente\./);
    assert.match(contenido, /Bases de Datos/);
  }
  assert.match(html, /¿Qué es un índice\?/);
  assert.match(html, />4 \/ 4</);
  assert.match(html, />3,5 \/ 6</);
  assert.match(text, /- ¿Qué es un índice\?: 4 de 4/);
  assert.match(text, /- Explicá la normalización: 3,5 de 6/);
});

test('armarMailResultado: el feedback respeta los saltos de línea (<br> en HTML, \\n en texto)', () => {
  const { html, text } = armarMailResultado({ ...resultadoBase, feedback: 'Línea 1\r\nLínea 2\n\nLínea 4' }, datosBase);
  assert.match(html, /Línea 1<br>Línea 2<br><br>Línea 4/);
  assert.match(text, /Línea 1\nLínea 2\n\nLínea 4/);
});

test('armarMailResultado: formato de la nota (coma decimal, sin ceros de más, escala que no arranca en 0)', () => {
  const sobre = (nota: number, min = 0, max = 10) => armarMailResultado({ ...resultadoBase, notaFinal: nota, escala: { min, max }, porPregunta: [] }, datosBase).text;
  assert.match(sobre(7.5), /: 7,5 sobre 10$/m);
  assert.match(sobre(10), /: 10 sobre 10$/m);
  assert.match(sobre(4.25), /: 4,25 sobre 10$/m);
  assert.match(sobre(0), /: 0 sobre 10$/m);
  assert.match(sobre(6, 1, 10), /: 6 sobre 10 \(escala de 1 a 10\)$/m);
  assert.match(sobre(85, 0, 100), /: 85 sobre 100$/m);
});

test('armarMailResultado: escapa TODO texto variable contra inyección de HTML (nombre, título, enunciado, feedback, docente, curso)', () => {
  const ataque = '<script>alert(1)</script><img src=x onerror=alert(2)>"&\'';
  const { subject, html } = armarMailResultado(
    {
      titulo: `Parcial ${ataque}`,
      notaFinal: 5,
      escala: { min: 0, max: 10 },
      feedback: `Feedback ${ataque}\n<b>negrita</b>`,
      porPregunta: [{ enunciado: `Pregunta ${ataque}`, notaFinal: 5, puntajeMaximo: 10 }],
    },
    { nombreAlumno: `Ana ${ataque}`, nombreDocente: `Doc ${ataque}`, nombreCurso: `Curso ${ataque}` },
  );
  assert.ok(!html.includes('<script'), html);
  assert.ok(!html.includes('<img'), html);
  assert.ok(!html.includes('<b>'), html);
  assert.ok(!/onerror=alert\(2\)>/.test(html));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;b&gt;negrita&lt;/b&gt;'));
  assert.ok(html.includes('&quot;&amp;&#39;'));
  // Cada texto variable aparece escapado en su lugar.
  assert.ok(html.includes('Hola Ana &lt;script&gt;'));
  assert.ok(html.includes('Pregunta &lt;script&gt;'));
  assert.ok(html.includes('en nombre de Doc &lt;script&gt;'));
  assert.ok(html.includes('Curso &lt;script&gt;'));
  // El asunto es texto plano (no HTML): va tal cual, pero en una sola línea.
  assert.ok(subject.startsWith('Tu nota en "Parcial <script>'));
  assert.equal(armarMailResultado({ ...resultadoBase, titulo: 'Parcial\n1\r\n  final' }, datosBase).subject, 'Tu nota en "Parcial 1 final"');
});

test('armarMailResultado: HTML compatible con clientes de mail (sin imágenes, links ni scripts; estilos en línea)', () => {
  const { html } = armarMailResultado(resultadoBase, datosBase);
  assert.ok(!/<img|<a |href=|src=|<script|<link|<style|https?:\/\//i.test(html), html);
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<table role="presentation"/);
  assert.match(html, /style="/);
});

test('armarMailResultado: la tabla por pregunta solo va si la suma coincide con la nota total (±0,01)', () => {
  const conTabla = (r: Parameters<typeof armarMailResultado>[0]) => {
    const { html, text } = armarMailResultado(r, datosBase);
    assert.equal(html.includes('Detalle por pregunta'), text.includes('Detalle por pregunta'));
    return text.includes('Detalle por pregunta');
  };
  assert.equal(conTabla(resultadoBase), true); // 4 + 3,5 = 7,5

  // El docente editó la nota total a mano o hay una vara: no suma, se omite.
  assert.equal(conTabla({ ...resultadoBase, notaFinal: 8 }), false);
  assert.equal(conTabla({ ...resultadoBase, notaFinal: 7.52 }), false);
  // Dentro de la tolerancia (redondeos).
  assert.equal(conTabla({ ...resultadoBase, notaFinal: 7.51 }), true);
  assert.equal(conTabla({ ...resultadoBase, notaFinal: 7.49 }), true);
  // Sin preguntas no hay nada que mostrar.
  assert.equal(conTabla({ ...resultadoBase, notaFinal: 0, porPregunta: [] }), false);

  assert.equal(detalleSumaLaNota(resultadoBase), true);
  assert.equal(detalleSumaLaNota({ ...resultadoBase, notaFinal: 9 }), false);
});

test('armarMailResultado: sin feedback no sale la sección de comentarios; sin nombre ni curso el saludo y el pie se arreglan solos', () => {
  const { html, text } = armarMailResultado({ ...resultadoBase, feedback: '  \n ' }, { nombreAlumno: '', nombreDocente: '' });
  for (const c of [html, text]) {
    assert.ok(!c.includes('Comentarios de tu docente'));
    assert.match(c, /Hola,/);
    assert.match(c, /en nombre de tu docente\./);
  }
});

test('armarMailResultado: un enunciado larguísimo se acorta en la tabla', () => {
  const { text } = armarMailResultado({ ...resultadoBase, porPregunta: [{ enunciado: 'x'.repeat(5000), notaFinal: 7.5, puntajeMaximo: 10 }] }, datosBase);
  assert.ok(text.length < 1000, `largo ${text.length}`);
  assert.match(text, /x{200}…: 7,5 de 10/);
});

test('el mail armado desde la respuesta no filtra clave, nota sugerida/con vara ni criterios de la IA', () => {
  const examen = { titulo: 'Parcial 1', escalaMin: new Prisma.Decimal(0), escalaMax: new Prisma.Decimal(10) };
  const preguntas = [
    { id: 'p1', enunciado: '¿Qué es un índice?', puntajeMaximo: new Prisma.Decimal(4), opciones: [{ id: 'a', texto: 'OPCION_CLAVE', correcta: true }] },
    { id: 'p2', enunciado: 'Explicá la normalización', puntajeMaximo: new Prisma.Decimal(6), criterios: [{ nombre: 'CRITERIO_INTERNO' }] },
  ];
  const respuesta = {
    notaTotalFinal: new Prisma.Decimal('7.5'),
    feedbackGeneralFinal: 'Muy buen trabajo.',
    notaTotalSugerida: new Prisma.Decimal('3.3'),
    notaConVara: new Prisma.Decimal('9.99'),
    feedbackGeneralSugerido: 'SUGERIDO_IA',
    modeloIa: 'MODELO_IA',
    respuestasPorPregunta: [
      { preguntaId: 'p1', contenidoRespuesta: 'RESPUESTA_ALUMNO', notaSugerida: 1, notaFinal: 4, correcta: true },
      { preguntaId: 'p2', notaSugerida: 2.5, notaFinal: 3.5, notaPorCriterio: [{ nombre: 'CRITERIO_INTERNO', comentario: 'COMENTARIO_IA' }] },
    ],
  };
  const { subject, html, text } = armarMailResultado(armarResultadoParaAlumno(examen, preguntas, respuesta), datosBase);
  const todo = `${subject}\n${html}\n${text}`;
  for (const prohibido of ['OPCION_CLAVE', 'correcta', 'CRITERIO_INTERNO', 'COMENTARIO_IA', 'SUGERIDO_IA', 'MODELO_IA', 'RESPUESTA_ALUMNO', '9,99', '9.99', '3,3', 'notaSugerida']) {
    assert.ok(!todo.includes(prohibido), `el mail filtra "${prohibido}"`);
  }
  assert.match(text, /7,5 sobre 10/);
});

// ---------------------------------------------------------------------------
// 3. NotificacionesService
// ---------------------------------------------------------------------------
const EXAMEN_BASE = {
  id: 'ex-1',
  titulo: 'Parcial 1',
  escalaMin: 0,
  escalaMax: 10,
  feedbackModo: 'manual',
  feedbackLiberadoEn: new Date('2030-01-01T10:00:00Z'),
};
const PREGUNTAS = [
  { id: 'p1', enunciado: 'Q1', puntajeMaximo: 4, orden: 0 },
  { id: 'p2', enunciado: 'Q2', puntajeMaximo: 6, orden: 1 },
];

function fila(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    examenId: 'ex-1',
    alumnoId: `al-${id}`,
    alumno: { nombre: `Alumno ${id}`, email: `${id}@mail.com` },
    estadoRevision: 'aceptada',
    notificadoEn: null as Date | null,
    notificacionError: null as string | null,
    notaTotalFinal: 7.5,
    feedbackGeneralFinal: 'Bien.',
    respuestasPorPregunta: [
      { preguntaId: 'p1', notaFinal: 4 },
      { preguntaId: 'p2', notaFinal: 3.5 },
    ],
    createdAt: new Date(2030, 0, 1, 0, 0, Number(id.replace(/\D/g, '')) || 0),
    ...extra,
  } as Record<string, any>;
}

/** Prisma de mentira que entiende los filtros simples (igualdad, `in`, `not`) y arma las relaciones como la base. */
function prismaNotif(filas: Array<Record<string, any>>, examen: Record<string, any> = { ...EXAMEN_BASE }) {
  const escrituras: any[] = [];
  const coincide = (f: Record<string, any>, where: Record<string, any> = {}) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === 'object' && 'in' in v ? v.in.includes(f[k]) : v && typeof v === 'object' && 'not' in v ? f[k] !== v.not : f[k] === v,
    );
  const prisma = {
    examen: { findUnique: async ({ where }: any) => (where.id === examen.id ? { ...examen } : null) },
    respuestaExamen: {
      findUnique: async ({ where }: any) => {
        const f = filas.find((x) => x.id === where.id);
        return f
          ? { ...f, examen: { ...examen, preguntas: PREGUNTAS, curso: { nombre: 'Bases de Datos', docente: { nombre: 'Prof. Gómez', email: 'gomez@facu.edu.ar' } } } }
          : null;
      },
      findMany: async ({ where, orderBy }: any) =>
        filas.filter((f) => coincide(f, where)).sort((a, b) => (orderBy ? a.createdAt.getTime() - b.createdAt.getTime() : 0)).map((f) => ({ ...f })),
      update: async ({ where, data }: any) => {
        escrituras.push({ id: where.id, data });
        return Object.assign(filas.find((x) => x.id === where.id)!, data);
      },
      updateMany: async ({ where, data }: any) => {
        const mias = filas.filter((f) => coincide(f, where));
        mias.forEach((f) => Object.assign(f, data));
        escrituras.push({ ids: mias.map((f) => f.id), data });
        return { count: mias.length };
      },
    },
  };
  return { prisma, filas, escrituras, examen };
}

/** MailService de mentira: registra lo que se manda, cuántos envíos corrían a la vez y responde lo que diga `resultado`. */
function mailFalso(
  opciones: { configurado?: boolean; modoPrueba?: string | null; resultado?: (mail: MailParaEnviar, n: number) => Promise<ResultadoEnvio> | ResultadoEnvio } = {},
) {
  const enviados: MailParaEnviar[] = [];
  let simultaneos = 0;
  let maximo = 0;
  return {
    configurado: opciones.configurado ?? true,
    modoPrueba: opciones.modoPrueba ?? null,
    enviados,
    get maximoSimultaneo() {
      return maximo;
    },
    enviar: async (mail: MailParaEnviar): Promise<ResultadoEnvio> => {
      enviados.push(mail);
      simultaneos += 1;
      maximo = Math.max(maximo, simultaneos);
      try {
        await turno();
        return (await opciones.resultado?.(mail, enviados.length)) ?? { ok: true };
      } finally {
        simultaneos -= 1;
      }
    },
  };
}

function servicioNotif(filas: Array<Record<string, any>>, mail = mailFalso(), examen?: Record<string, any>) {
  const { prisma, escrituras, examen: examenDb } = prismaNotif(filas, examen);
  const svc = new NotificacionesService(prisma as any, mail as any);
  svc.pausaEntreEnviosMs = 0; // en los tests no se espera de verdad
  const logs: string[] = [];
  (svc as any).logger = loggerMudo(logs);
  return { svc, mail, filas, escrituras, logs, examen: examenDb };
}

const terminoElLote = (svc: NotificacionesService) => esperarHasta(() => svc.enCursoDe('ex-1') === 0);
const por = (filas: Array<Record<string, any>>, id: string) => filas.find((f) => f.id === id)!;

test('notificarRespuesta: manda el mail al alumno con el contenido del resultado y marca notificadoEn', async () => {
  const { svc, mail, filas } = servicioNotif([fila('r1', { notificacionError: 'falló antes' })]);
  assert.equal(await svc.notificarRespuesta('r1'), 'enviado');

  assert.equal(mail.enviados.length, 1);
  const m = mail.enviados[0];
  assert.equal(m.to, 'r1@mail.com');
  assert.equal(m.replyTo, 'gomez@facu.edu.ar');
  assert.equal(m.subject, 'Tu nota en "Parcial 1"');
  assert.match(m.text, /Hola Alumno r1,/);
  assert.match(m.text, /7,5 sobre 10/);
  assert.match(m.text, /en nombre de Prof\. Gómez/);
  assert.match(m.text, /Bases de Datos/);
  assert.match(m.idempotencyKey!, /^resultado-r1-[0-9a-f]{12}$/);

  assert.ok(por(filas, 'r1').notificadoEn instanceof Date);
  assert.equal(por(filas, 'r1').notificacionError, null, 'un envío exitoso limpia el error anterior');
});

test('notificarRespuesta: manda UNA sola vez, aunque se pida de nuevo o se pida dos veces a la vez', async () => {
  const puerta = compuerta();
  const { svc, mail, filas } = servicioNotif([fila('r1')], mailFalso({ resultado: async () => (await puerta.abierta, { ok: true }) }));

  // Dos pedidos simultáneos: el segundo ve que el primero ya está enviando y no hace nada.
  const a = svc.notificarRespuesta('r1');
  const b = svc.notificarRespuesta('r1');
  puerta.abrir();
  assert.deepEqual([await a, await b].sort(), ['enviado', 'omitido']);
  assert.equal(mail.enviados.length, 1);

  // Ya notificada: pedirlo de nuevo no manda nada, ni siquiera tras re-revisar (notificadoEn no se toca).
  assert.equal(await svc.notificarRespuesta('r1'), 'omitido');
  filas[0].estadoRevision = 'editada';
  assert.equal(await svc.notificarRespuesta('r1'), 'omitido');
  assert.equal(mail.enviados.length, 1);
});

test('notificarRespuesta: si el envío falla guarda el motivo, deja notificadoEn en null y un reintento lo limpia', async () => {
  let n = 0;
  const { svc, mail, filas } = servicioNotif(
    [fila('r1')],
    mailFalso({ resultado: () => (++n === 1 ? { ok: false, motivo: 'Resend rechazó el mail: dominio sin verificar' } : { ok: true }) }),
  );
  assert.equal(await svc.notificarRespuesta('r1'), 'error');
  assert.equal(por(filas, 'r1').notificadoEn, null);
  assert.equal(por(filas, 'r1').notificacionError, 'Resend rechazó el mail: dominio sin verificar');

  assert.equal(await svc.notificarRespuesta('r1'), 'enviado'); // el lugar en curso se liberó
  assert.ok(por(filas, 'r1').notificadoEn);
  assert.equal(por(filas, 'r1').notificacionError, null);
  assert.equal(mail.enviados.length, 2);
});

test('notificarRespuesta: la clave de idempotencia cambia si cambia el contenido (nota editada tras un envío fallido)', async () => {
  const { svc, mail, filas } = servicioNotif([fila('r1')], mailFalso({ resultado: (_m, n) => (n === 1 ? { ok: false, motivo: 'x' } : { ok: true }) }));
  await svc.notificarRespuesta('r1');
  await svc.notificarRespuesta('r1'); // mismo contenido: misma clave (Resend no duplica)
  assert.equal(mail.enviados[0].idempotencyKey, mail.enviados[1].idempotencyKey);

  const otro = servicioNotif([fila('r1', { notaTotalFinal: 9 })]);
  await otro.svc.notificarRespuesta('r1');
  assert.notEqual(otro.mail.enviados[0].idempotencyKey, mail.enviados[0].idempotencyKey);
  assert.ok(otro.mail.enviados[0].idempotencyKey!.startsWith('resultado-r1-'));
  assert.equal(filas.length, 1);
});

test('notificarRespuesta: no manda nada si no corresponde (sin revisar, notas sin publicar) y sí en feedback inmediato', async () => {
  const sinRevisar = servicioNotif([fila('r1', { estadoRevision: 'pendiente' })]);
  assert.equal(await sinRevisar.svc.notificarRespuesta('r1'), 'omitido');

  const sinPublicar = servicioNotif([fila('r1')], mailFalso(), { ...EXAMEN_BASE, feedbackLiberadoEn: null });
  assert.equal(await sinPublicar.svc.notificarRespuesta('r1'), 'omitido');

  const inmediato = servicioNotif([fila('r1')], mailFalso(), { ...EXAMEN_BASE, feedbackModo: 'inmediato', feedbackLiberadoEn: null });
  assert.equal(await inmediato.svc.notificarRespuesta('r1'), 'enviado');

  for (const s of [sinRevisar, sinPublicar]) {
    assert.equal(s.mail.enviados.length, 0);
    assert.equal(s.escrituras.length, 0, 'no toca la base');
    assert.equal(s.filas[0].notificadoEn, null);
  }
  assert.equal(inmediato.mail.enviados.length, 1);

  assert.equal(await servicioNotif([]).svc.notificarRespuesta('no-existe'), 'omitido');
});

test('notificarRespuesta: con el envío sin configurar se omite en silencio (sin error guardado)', async () => {
  const { svc, mail, escrituras } = servicioNotif([fila('r1')], mailFalso({ configurado: false }));
  assert.equal(svc.configurado, false);
  assert.equal(await svc.notificarRespuesta('r1'), 'omitido');
  assert.equal(mail.enviados.length, 0);
  assert.equal(escrituras.length, 0);
  assert.deepEqual(await svc.notificarExamen('ex-1'), { aEnviar: 0 });
});

test('notificarExamen: responde enseguida y manda en segundo plano solo a los que faltan (sin notificar y los que fallaron)', async () => {
  const puerta = compuerta();
  const filas = [
    fila('r1', { notificadoEn: new Date() }), // ya recibió: no se repite
    fila('r2'),
    fila('r3', { notificacionError: 'falló antes' }), // falló: se reintenta
    fila('r4', { estadoRevision: 'pendiente' }), // sin revisar: todavía no le toca
    fila('r5', { examenId: 'ex-2' }), // de otro examen
  ];
  const { svc, mail } = servicioNotif(filas, mailFalso({ resultado: async () => (await puerta.abierta, { ok: true }) }));

  assert.deepEqual(await svc.notificarExamen('ex-1'), { aEnviar: 2 });
  assert.equal(mail.enviados.length, 2, 'los envíos ya arrancaron...');
  assert.ok(filas.every((f) => f.id === 'r1' || !f.notificadoEn), '...pero el pedido no esperó a que terminen');
  assert.equal(svc.enCursoDe('ex-1'), 2);

  // Un segundo pedido las cuenta pero no las duplica.
  assert.deepEqual(await svc.notificarExamen('ex-1'), { aEnviar: 2 });

  puerta.abrir();
  await terminoElLote(svc);
  assert.deepEqual(mail.enviados.map((m) => m.to).sort(), ['r2@mail.com', 'r3@mail.com']);
  assert.ok(por(filas, 'r2').notificadoEn && por(filas, 'r3').notificadoEn);
  assert.equal(por(filas, 'r3').notificacionError, null);
  assert.equal(por(filas, 'r4').notificadoEn, null);
  assert.equal(por(filas, 'r5').notificadoEn, null);
});

test('notificarExamen: con las notas sin publicar (examen manual) no hay a quién mandarle', async () => {
  const { svc, mail } = servicioNotif([fila('r1'), fila('r2')], mailFalso(), { ...EXAMEN_BASE, feedbackLiberadoEn: null });
  assert.deepEqual(await svc.notificarExamen('ex-1'), { aEnviar: 0 });
  assert.equal(mail.enviados.length, 0);
  assert.deepEqual(await servicioNotif([]).svc.notificarExamen('otro'), { aEnviar: 0 });
});

test('notificarExamen: manda de a pocos (nunca más de 2 a la vez) y con una pausa entre uno y otro', async () => {
  const filas = Array.from({ length: 7 }, (_, i) => fila(`r${i + 1}`));
  const { svc, mail } = servicioNotif(filas);
  const pausas: number[] = [];
  svc.pausaEntreEnviosMs = 1000;
  svc.esperar = async (ms) => void pausas.push(ms);
  assert.equal(svc.enviosEnParalelo, 2);

  assert.deepEqual(await svc.notificarExamen('ex-1'), { aEnviar: 7 });
  await terminoElLote(svc);
  assert.equal(mail.enviados.length, 7);
  assert.equal(mail.maximoSimultaneo, 2);
  assert.ok(pausas.length >= 4 && pausas.every((ms) => ms === 1000), `pausas: ${pausas}`);
  assert.ok(filas.every((f) => f.notificadoEn));

  // La configuración por defecto es la que respeta el rate limit de Resend (≤ 2 envíos por segundo).
  const porDefecto = new NotificacionesService({} as any, {} as any);
  assert.equal(porDefecto.enviosEnParalelo, 2);
  assert.ok(porDefecto.pausaEntreEnviosMs >= 1000);
});

test('notificarExamen: un error en una respuesta no corta el lote (se guarda su motivo y siguen las demás)', async () => {
  const filas = [fila('r1'), fila('r2'), fila('r3')];
  const { svc, mail, logs } = servicioNotif(filas, mailFalso({ resultado: (m) => (m.to === 'r2@mail.com' ? { ok: false, motivo: 'Resend rechazó el mail: buzón inexistente' } : { ok: true }) }));
  (svc as any).prisma.respuestaExamen.findUnique = async ({ where }: any) => {
    if (where.id === 'r3') throw new Error('se cayó la base');
    return prismaNotif(filas).prisma.respuestaExamen.findUnique({ where });
  };
  await svc.notificarExamen('ex-1');
  await terminoElLote(svc);

  assert.ok(por(filas, 'r1').notificadoEn);
  assert.equal(por(filas, 'r2').notificacionError, 'Resend rechazó el mail: buzón inexistente');
  assert.equal(por(filas, 'r3').notificadoEn, null);
  assert.equal(mail.enviados.length, 2);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /r3/);
});

test('notificarExamen: si Resend avisa que se agotó la cuota, corta el lote y deja el motivo en las que quedan; después se reenvía a los que faltan', async () => {
  const filas = Array.from({ length: 6 }, (_, i) => fila(`r${i + 1}`));
  let hayCupo = true;
  const mail = mailFalso({ resultado: (_m, n) => (hayCupo && n >= 3 ? { ok: false, motivo: MOTIVO_CUOTA, cuota: true } : { ok: true }) });
  const { svc } = servicioNotif(filas, mail);
  svc.enviosEnParalelo = 1;

  assert.deepEqual(await svc.notificarExamen('ex-1'), { aEnviar: 6 });
  await terminoElLote(svc);

  // Salieron r1 y r2; r3 recibió la cuota agotada; de r4 a r6 ni se intentó, pero quedaron con el motivo.
  assert.equal(mail.enviados.length, 3, 'después de la cuota no se hace ningún pedido más');
  assert.deepEqual(filas.map((f) => !!f.notificadoEn), [true, true, false, false, false, false]);
  for (const id of ['r3', 'r4', 'r5', 'r6']) assert.equal(por(filas, id).notificacionError, MOTIVO_CUOTA, id);
  assert.equal(por(filas, 'r1').notificacionError, null);

  const resumen = await svc.resumen('ex-1');
  assert.equal(resumen.enviados, 2);
  assert.equal(resumen.conError, 4);
  assert.equal(resumen.ultimoError, MOTIVO_CUOTA);

  // Se renueva el cupo: "reenviar" va solo a los 4 que faltan; los 2 que ya recibieron no se repiten.
  hayCupo = false;
  mail.enviados.length = 0;
  assert.deepEqual(await svc.notificarExamen('ex-1'), { aEnviar: 4 });
  await terminoElLote(svc);
  assert.deepEqual(mail.enviados.map((m) => m.to).sort(), ['r3@mail.com', 'r4@mail.com', 'r5@mail.com', 'r6@mail.com']);
  assert.ok(filas.every((f) => f.notificadoEn && f.notificacionError === null));
});

test('notificarExamen: con 2 en paralelo, al llegar la cuota los demás frenan igual', async () => {
  const filas = Array.from({ length: 8 }, (_, i) => fila(`r${i + 1}`));
  const mail = mailFalso({ resultado: () => ({ ok: false, motivo: MOTIVO_CUOTA, cuota: true }) });
  const { svc } = servicioNotif(filas, mail);
  await svc.notificarExamen('ex-1');
  await terminoElLote(svc);
  assert.ok(mail.enviados.length <= 2, `se hicieron ${mail.enviados.length} pedidos con la cuota agotada`);
  assert.ok(filas.every((f) => f.notificadoEn === null && f.notificacionError === MOTIVO_CUOTA));
});

test('resumen: cuenta enviados, con error, sin enviar y sin revisar, e informa configuración y modo prueba', async () => {
  const filas = [
    fila('r1', { notificadoEn: new Date() }),
    fila('r2', { notificadoEn: new Date() }),
    fila('r3', { notificacionError: 'primer error' }),
    fila('r4', { notificacionError: 'último error' }),
    fila('r5'),
    fila('r6', { estadoRevision: 'pendiente' }),
    fila('r7', { estadoRevision: 'pendiente' }),
  ];
  const { svc } = servicioNotif(filas, mailFalso({ modoPrueba: 'yo@prueba.com' }));
  assert.deepEqual(await svc.resumen('ex-1'), {
    configurado: true,
    modoPrueba: 'yo@prueba.com',
    enviados: 2,
    conError: 2,
    sinEnviar: 1,
    sinRevisar: 2,
    enCurso: 0,
    ultimoError: 'último error',
  });

  // Notas sin publicar (examen manual): los revisados todavía no cuentan como "sin enviar" ni "con error".
  const sinPublicar = servicioNotif(filas.map((f) => ({ ...f, notificadoEn: null })), mailFalso({ configurado: false }), { ...EXAMEN_BASE, feedbackLiberadoEn: null });
  assert.deepEqual(await sinPublicar.svc.resumen('ex-1'), {
    configurado: false, modoPrueba: null, enviados: 0, conError: 0, sinEnviar: 0, sinRevisar: 2, enCurso: 0, ultimoError: null,
  });
  await assert.rejects(() => servicioNotif([]).svc.resumen('otro'), /no encontrado/);
});

// ---------------------------------------------------------------------------
// 4. Publicar las notas exige el envío configurado; endpoints del docente
// ---------------------------------------------------------------------------
function prismaLiberar(examen: Record<string, any>) {
  const escrituras: any[] = [];
  return {
    escrituras,
    prisma: {
      examen: {
        updateMany: async ({ where, data }: any) => {
          escrituras.push(data);
          if (examen.feedbackLiberadoEn === null) Object.assign(examen, data);
          return { count: 1 };
        },
        findUnique: async () => examen,
      },
      respuestaExamen: { count: async () => 3 },
    } as any,
  };
}

test('liberarFeedback: sin el envío de mails configurado se rechaza con 409 y NO marca el examen como publicado', async () => {
  const examen = { id: 'ex-1', feedbackLiberadoEn: null };
  const { prisma, escrituras } = prismaLiberar(examen);
  let lanzado = 0;
  const svc = new ExamenesService(prisma, { configurado: false, notificarExamen: async () => (lanzado++, { aEnviar: 0 }) } as any);

  await assert.rejects(
    () => svc.liberarFeedback('ex-1'),
    (err: unknown) =>
      err instanceof ConflictException &&
      (err.getResponse() as any).message === 'Para publicar las notas falta configurar el envío de mails en el servidor: RESEND_API_KEY y EMAIL_FROM.',
  );
  assert.equal(escrituras.length, 0, 'no escribió nada');
  assert.equal(examen.feedbackLiberadoEn, null);
  assert.equal(lanzado, 0);
});

test('liberarFeedback: con el envío configurado publica y dispara el envío en segundo plano (sin esperarlo); republicar reintenta', async () => {
  const examen = { id: 'ex-1', feedbackLiberadoEn: null as Date | null };
  const { prisma } = prismaLiberar(examen);
  const pedidos: string[] = [];
  const svc = new ExamenesService(prisma, { configurado: true, notificarExamen: async (id: string) => (pedidos.push(id), { aEnviar: 12 }) } as any);

  const r = await svc.liberarFeedback('ex-1');
  assert.ok(r.feedbackLiberadoEn instanceof Date);
  assert.equal(r.pendientesDeRevision, 3);
  assert.equal(r.aEnviar, 12);
  const original = r.feedbackLiberadoEn!.getTime();

  const otra = await svc.liberarFeedback('ex-1');
  assert.equal(otra.feedbackLiberadoEn!.getTime(), original, 'conserva la fecha original');
  assert.deepEqual(pedidos, ['ex-1', 'ex-1']);
});

test('liberarFeedback: si no se puede ni arrancar el envío, las notas quedan publicadas igual y se loguea', async () => {
  const examen = { id: 'ex-1', feedbackLiberadoEn: null as Date | null };
  const { prisma } = prismaLiberar(examen);
  const svc = new ExamenesService(prisma, { configurado: true, notificarExamen: async () => { throw new Error('base caída'); } } as any);
  const logs: string[] = [];
  (svc as any).logger = loggerMudo(logs);
  const r = await svc.liberarFeedback('ex-1');
  assert.ok(r.feedbackLiberadoEn);
  assert.equal(r.aEnviar, 0);
  assert.equal(logs.length, 1);
});

test('GET/POST /examenes/:id/notificaciones: chequean el acceso al examen; reenviar responde 409 sin configuración', async () => {
  const llamadas: string[] = [];
  const acceso = { examen: async (docenteId: string, examenId: string) => llamadas.push(`acceso:${docenteId}:${examenId}`) };
  const notif = {
    configurado: true,
    resumen: async (id: string) => (llamadas.push(`resumen:${id}`), { enviados: 1 }),
    notificarExamen: async (id: string) => (llamadas.push(`reenviar:${id}`), { aEnviar: 5 }),
  };
  const controller = new ExamenesController({} as any, {} as any, acceso as any, notif as any);

  assert.deepEqual(await controller.resumenNotificaciones('doc-1', 'ex-1'), { enviados: 1 });
  assert.deepEqual(await controller.reenviarNotificaciones('doc-1', 'ex-1'), { aEnviar: 5 });
  assert.deepEqual(llamadas, ['acceso:doc-1:ex-1', 'resumen:ex-1', 'acceso:doc-1:ex-1', 'reenviar:ex-1']);

  notif.configurado = false;
  llamadas.length = 0;
  await assert.rejects(() => controller.reenviarNotificaciones('doc-1', 'ex-1'), ConflictException);
  assert.deepEqual(llamadas, ['acceso:doc-1:ex-1'], 'no dispara nada');

  // Un docente ajeno no ve ni dispara nada.
  acceso.examen = async () => { throw new ForbiddenException(); };
  notif.configurado = true;
  llamadas.length = 0;
  await assert.rejects(() => controller.resumenNotificaciones('doc-2', 'ex-1'), ForbiddenException);
  await assert.rejects(() => controller.reenviarNotificaciones('doc-2', 'ex-1'), ForbiddenException);
  assert.deepEqual(llamadas, []);

  const resumen = ExamenesController.prototype.resumenNotificaciones;
  const reenviar = ExamenesController.prototype.reenviarNotificaciones;
  assert.equal(Reflect.getMetadata('path', resumen), ':id/notificaciones');
  assert.equal(Reflect.getMetadata('method', resumen), RequestMethod.GET);
  assert.equal(Reflect.getMetadata('path', reenviar), ':id/notificaciones/reenviar');
  assert.equal(Reflect.getMetadata('method', reenviar), RequestMethod.POST);
});

// ---------------------------------------------------------------------------
// 5. Disparadores al revisar: solo si corresponde notificar y el envío está configurado
// ---------------------------------------------------------------------------
function filaRevision(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    examenId: 'ex-1',
    estado: 'corregido',
    estadoRevision: 'pendiente',
    notaTotalSugerida: 7,
    notaConVara: null,
    notaTotalFinal: null,
    feedbackGeneralSugerido: 'fb',
    feedbackGeneralFinal: null,
    revisadoEn: null,
    notificadoEn: null,
    respuestasPorPregunta: [{ preguntaId: 'p', contenidoRespuesta: 'x', notaSugerida: 7, notaFinal: null }],
    ...extra,
  } as Record<string, any>;
}

function servicioRevision(
  filas: Array<Record<string, any>>,
  opciones: { configurado?: boolean; examen?: Record<string, any> | null; lanzarLote?: (examenId: string, ids: string[]) => void } = {},
) {
  const lanzados: Array<{ examenId: string; ids: string[] }> = [];
  const consultasExamen: any[] = [];
  const examen = opciones.examen === undefined ? { feedbackModo: 'manual', feedbackLiberadoEn: null } : opciones.examen;
  const updates: any[] = [];
  const prisma = {
    respuestaExamen: {
      // Las aceptables (lo que pide bulkAceptar) o, sin ese filtro, todas (lo que devuelve findAllByExamen).
      findMany: async ({ where }: any) =>
        filas.filter((f) => !('estado' in where) || (f.estado === 'corregido' && f.estadoRevision === 'pendiente' && f.notaTotalSugerida !== null)).map((f) => ({ ...f })),
      findUnique: async ({ where }: any) => filas.find((f) => f.id === where.id) ?? null,
      update: async ({ where, data }: any) => (updates.push(data), Object.assign(filas.find((f) => f.id === where.id)!, data)),
    },
    intentoExamen: { findMany: async () => [] },
    examen: { findUnique: async (args: any) => (consultasExamen.push(args), examen) },
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
  };
  const notificaciones = {
    configurado: opciones.configurado ?? true,
    lanzarLote: (examenId: string, ids: string[]) => {
      lanzados.push({ examenId, ids });
      opciones.lanzarLote?.(examenId, ids);
    },
  };
  const svc = new RespuestasExamenService(prisma as any, {} as any, {} as any, notificaciones as any);
  const logs: string[] = [];
  (svc as any).logger = loggerMudo(logs);
  return { svc, lanzados, consultasExamen, updates, logs, filas };
}

/** Las notificaciones salen en segundo plano: se deja correr lo pendiente antes de mirar. */
const asentar = async () => {
  for (let i = 0; i < 10; i++) await turno();
};

test('revisar: en feedback inmediato dispara el mail de esa respuesta (en segundo plano)', async () => {
  const { svc, lanzados } = servicioRevision([filaRevision('r-1')], { examen: { feedbackModo: 'inmediato', feedbackLiberadoEn: null } });
  await svc.revisar('ex-1', 'r-1', { estadoRevision: 'aceptada' });
  await asentar();
  assert.deepEqual(lanzados, [{ examenId: 'ex-1', ids: ['r-1'] }]);
});

test('revisar: si el examen ya tenía las notas publicadas también notifica (editada incluida); si no, no', async () => {
  const publicado = servicioRevision([filaRevision('r-1')], { examen: { feedbackModo: 'manual', feedbackLiberadoEn: new Date() } });
  await publicado.svc.revisar('ex-1', 'r-1', { estadoRevision: 'editada', notaTotalFinal: 5, feedbackGeneralFinal: 'x' });
  await asentar();
  assert.deepEqual(publicado.lanzados, [{ examenId: 'ex-1', ids: ['r-1'] }]);

  const sinPublicar = servicioRevision([filaRevision('r-1')], { examen: { feedbackModo: 'manual', feedbackLiberadoEn: null } });
  await sinPublicar.svc.revisar('ex-1', 'r-1', { estadoRevision: 'aceptada' });
  await asentar();
  assert.deepEqual(sinPublicar.lanzados, []);
});

test('revisar: con el envío sin configurar se omite en silencio y la revisión se guarda igual', async () => {
  const { svc, lanzados, consultasExamen, logs, filas } = servicioRevision([filaRevision('r-1')], {
    configurado: false,
    examen: { feedbackModo: 'inmediato', feedbackLiberadoEn: null },
  });
  const r = await svc.revisar('ex-1', 'r-1', { estadoRevision: 'aceptada' });
  await asentar();
  assert.equal(r.estadoRevision, 'aceptada');
  assert.equal(filas[0].estado, 'revisado');
  assert.deepEqual(lanzados, []);
  assert.equal(consultasExamen.length, 0);
  assert.deepEqual(logs, [], 'sin configurar no es un error');
});

test('revisar: si falla el disparador (o la consulta del examen) la revisión no se rompe y se loguea', async () => {
  const falla = servicioRevision([filaRevision('r-1')], {
    examen: { feedbackModo: 'inmediato', feedbackLiberadoEn: null },
    lanzarLote: () => { throw new Error('boom'); },
  });
  const r = await falla.svc.revisar('ex-1', 'r-1', { estadoRevision: 'aceptada' });
  await asentar();
  assert.equal(r.estadoRevision, 'aceptada');
  assert.equal(falla.logs.length, 1);

  const sinExamen = servicioRevision([filaRevision('r-1')], { examen: null });
  await sinExamen.svc.revisar('ex-1', 'r-1', { estadoRevision: 'aceptada' });
  await asentar();
  assert.deepEqual(sinExamen.lanzados, []);
});

test('revisar: re-revisar no toca notificadoEn ni el error de envío (una respuesta ya notificada no manda otro mail sola)', async () => {
  const { svc, updates } = servicioRevision([filaRevision('r-1', { notificadoEn: new Date() })], { examen: { feedbackModo: 'inmediato', feedbackLiberadoEn: null } });
  await svc.revisar('ex-1', 'r-1', { estadoRevision: 'aceptada' });
  assert.ok(!('notificadoEn' in updates[0]) && !('notificacionError' in updates[0]));
});

test('bulkAceptar: notifica a las que aceptó (una sola tanda) si corresponde; si no, nada', async () => {
  const filas = () => [filaRevision('r-1'), filaRevision('r-2'), filaRevision('r-3', { estado: 'pendiente_correccion', notaTotalSugerida: null })];

  const inmediato = servicioRevision(filas(), { examen: { feedbackModo: 'inmediato', feedbackLiberadoEn: null } });
  await inmediato.svc.bulkAceptar('ex-1');
  await asentar();
  assert.deepEqual(inmediato.lanzados, [{ examenId: 'ex-1', ids: ['r-1', 'r-2'] }]); // la que la IA no corrigió queda afuera

  const publicado = servicioRevision(filas(), { examen: { feedbackModo: 'manual', feedbackLiberadoEn: new Date() } });
  await publicado.svc.bulkAceptar('ex-1');
  await asentar();
  assert.equal(publicado.lanzados.length, 1);

  const sinPublicar = servicioRevision(filas());
  await sinPublicar.svc.bulkAceptar('ex-1');
  const sinConfig = servicioRevision(filas(), { configurado: false, examen: { feedbackModo: 'inmediato', feedbackLiberadoEn: null } });
  await sinConfig.svc.bulkAceptar('ex-1');
  const nadaAceptable = servicioRevision([filaRevision('r-3', { estado: 'pendiente_correccion', notaTotalSugerida: null })], { examen: { feedbackModo: 'inmediato', feedbackLiberadoEn: null } });
  await nadaAceptable.svc.bulkAceptar('ex-1');
  await asentar();
  assert.deepEqual([sinPublicar.lanzados, sinConfig.lanzados, nadaAceptable.lanzados], [[], [], []]);
});

test('bulkAceptar: un fallo del disparador no rompe la respuesta del endpoint', async () => {
  const { svc, logs } = servicioRevision([filaRevision('r-1')], {
    examen: { feedbackModo: 'inmediato', feedbackLiberadoEn: null },
    lanzarLote: () => { throw new Error('boom'); },
  });
  const r: any[] = await svc.bulkAceptar('ex-1');
  await asentar();
  assert.equal(r.length, 1);
  assert.equal(logs.length, 1);
});
