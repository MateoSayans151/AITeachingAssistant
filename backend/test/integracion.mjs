// Integración contra un backend real + Postgres.
//   API=http://localhost:3999/api PG_CONTAINER=ata-test-pg node test/integracion.mjs
// El backend tiene que arrancar con el mismo SUPABASE_URL y SUPABASE_JWT_SECRET que se usan acá
// (valores de prueba por defecto, abajo): los logins de docente se simulan con tokens firmados con ese secreto.
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
const API = process.env.API ?? 'http://localhost:3001/api';
const PG = process.env.PG_CONTAINER ?? 'ata-test-pg';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://proyecto-test.supabase.co';
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? 's'.repeat(40);
// Para simular "pasó el tiempo" se edita la base directamente.
const sql = (q) => execFileSync('docker', ['exec', PG, 'psql', '-U', 'postgres', '-d', 'ata', '-t', '-A', '-c', q]).toString().trim();

// Access token como el que emite Supabase Auth (HS256 con el secreto compartido de prueba).
function tokenSupabase({ sub = randomUUID(), email, nombre, verificado = true, exp, aud = 'authenticated', iss = `${SUPABASE_URL}/auth/v1`, secreto = SUPABASE_JWT_SECRET }) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const ahora = Math.floor(Date.now() / 1000);
  const cuerpo = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    iss, aud, sub, email, iat: ahora, exp: exp ?? ahora + 3600,
    user_metadata: { email_verified: verificado, ...(nombre ? { nombre } : {}) },
  })}`;
  return `${cuerpo}.${createHmac('sha256', secreto).update(cuerpo).digest('base64url')}`;
}

let n = 0;
async function call(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, text };
}
const check = async (nombre, fn) => { try { await fn(); console.log('✔', nombre); n++; } catch (e) { console.log('✖', nombre, '\n  ', e.message); process.exitCode = 1; } };
const sufijo = Date.now();

// ------------------------------------------------------------------ setup
// Los docentes se crean solos en su primer pedido autenticado (con email confirmado).
const subA = randomUUID(), subB = randomUUID();
const tA = tokenSupabase({ sub: subA, email: `ana${sufijo}@x.com`, nombre: 'Ana' });
const tB = tokenSupabase({ sub: subB, email: `beto${sufijo}@x.com`, nombre: 'Beto' });

const curso = (await call('POST', '/cursos', { token: tA, body: { nombre: 'Álgebra' } })).json;
const alumnosIn = ['luz', 'tomi', 'ana', 'beto', 'cami'].map((n) => ({ nombre: n, email: `${n}@x.com` }));
const com = (await call('POST', `/cursos/${curso.id}/comisiones`, { token: tA, body: { nombre: 'K1', alumnos: alumnosIn } })).json;
const niveles = [1, 2, 3, 4, 5].map((o) => ({ orden: o, nombre: `N${o}`, colorHex: '#000000', porcentaje: o * 20 }));
const preguntasIn = [
  { tipo: 'opcion_multiple', enunciado: 'Elegí', puntajeMaximo: 5, opciones: [{ id: 'a', texto: 'A', correcta: true }, { id: 'b', texto: 'B', correcta: false }] },
  { tipo: 'verdadero_falso', enunciado: 'V/F', puntajeMaximo: 5, opciones: { correcta: true } },
];
const mkExamen = async (extra) => {
  const ex = (await call('POST', '/examenes', { token: tA, body: { cursoId: curso.id, titulo: 'Parcial', consigna: 'c', modalidad: 'sesion_tiempo', duracionMinutos: 60, escalaMin: 0, escalaMax: 10, niveles, feedbackModo: 'manual', preguntas: preguntasIn, ...extra } })).json;
  const pub = (await call('POST', `/examenes/${ex.id}/comisiones`, { token: tA, body: { comisionId: com.id } })).json;
  return { id: ex.id, slug: pub.slugAcceso };
};
const ex1 = await mkExamen({ antiCheat: { pantallaCompleta: false, cambioPestana: false, pegado: true } });
const ex2 = await mkExamen({ modalidad: 'ventana_dias', duracionMinutos: undefined });
await check('setup: exámenes publicados', () => { assert.ok(ex1.id && ex1.slug && ex2.id && ex2.slug); });

const iniciar = (slug, nombre, extra = {}) => call('POST', `/rendir/${slug}/iniciar`, { body: { alumnoEmail: `${nombre}@x.com`, ...extra } });
const P = (await call('GET', `/rendir/${ex1.slug}`)).json;

// ------------------------------------------------------------------ superficie pública
await check('info del link: sin preguntas ni ids ni clave; muestra anti-cheat y ventana', async () => {
  const r = await call('GET', `/rendir/${ex1.slug}`);
  assert.equal(r.status, 200);
  assert.ok(!('preguntas' in r.json.examen), 'no debe traer preguntas');
  assert.ok(!('id' in r.json.examen), 'no debe traer el id del examen');
  assert.deepEqual(r.json.examen.antiCheat, { pantallaCompleta: false, cambioPestana: false, pegado: true });
  assert.equal(r.json.ventana.estado, 'abierta');
  assert.ok(!/correcta|Elegí/.test(r.text));
  assert.equal((await call('GET', `/rendir/${ex2.slug}`)).json.examen.antiCheat, null);
});

await check('aula detrás de una misma IP: 200 pedidos seguidos no se bloquean entre sí', async () => {
  for (let i = 0; i < 200; i++) assert.equal((await call('GET', `/rendir/${ex1.slug}`)).status, 200);
});

await check('rutas de docente sin token: 401; con id ajeno: 404', async () => {
  for (const p of [`/examenes/${ex1.id}`, `/examenes/${ex1.id}/respuestas`, '/cursos']) assert.equal((await call('GET', p)).status, 401);
  for (const p of [`/examenes/${ex1.id}`, `/examenes/${ex1.id}/respuestas`, `/cursos/${curso.id}`, '/examenes/no-es-uuid']) assert.equal((await call('GET', p, { token: tB })).status, 404);
  assert.equal((await call('POST', `/examenes/${ex1.id}/comisiones`, { token: tB, body: { comisionId: com.id } })).status, 404);
});

// ------------------------------------------------------------------ iniciar
await check('iniciar: email que no está en la comisión → 401; no hace falta ningún código; un código mandado de más se rechaza', async () => {
  assert.equal((await iniciar(ex1.slug, 'nadie', { consentimiento: true })).status, 401);
  const conCodigo = await call('POST', `/rendir/${ex1.slug}/iniciar`, { body: { alumnoEmail: 'luz@x.com', codigoAcceso: 'abc', consentimiento: true } });
  assert.equal(conCodigo.status, 400, 'el campo ya no existe: la validación estricta lo rechaza');
});

await check('iniciar: con anti-cheat exige aceptar el aviso; no arranca el reloj sin él', async () => {
  const r = await iniciar(ex1.slug, 'luz');
  assert.equal(r.status, 400);
  assert.match(r.text, /aceptar el aviso/);
  assert.equal(sql(`select count(*) from intentos_examen where examen_id='${ex1.id}'`), '0');
});

let luz;
await check('iniciar OK: token, preguntas sin clave, vencimiento del servidor (~60 min)', async () => {
  const r = await iniciar(ex1.slug, 'luz', { consentimiento: true });
  assert.equal(r.status, 201, r.text);
  luz = r.json;
  assert.ok(luz.token && luz.preguntas.length === 2);
  assert.ok(!/"correcta"|respuestaCorrecta|paresCorrectos/.test(r.text), 'filtra la clave');
  const min = (new Date(luz.expiraEn) - new Date(luz.ahora)) / 60000;
  assert.ok(min > 59 && min <= 60, `expira en ${min} min`);
  assert.equal(sql(`select consentimiento_en is not null from intentos_examen where examen_id='${ex1.id}'`), 't');
});

await check('reiniciar no da más tiempo: devuelve el mismo vencimiento', async () => {
  const r = await iniciar(ex1.slug, 'luz', { consentimiento: true });
  assert.equal(r.status, 201);
  assert.equal(new Date(r.json.expiraEn).getTime(), new Date(luz.expiraEn).getTime());
  luz.token = r.json.token;
});

await check('fuerza bruta: probar emails al azar desde una IP la bloquea (429) y también frena un email correcto; pasada la ventana vuelve', async () => {
  sql(`delete from fallos_acceso`);
  let ultimo = 0;
  for (let i = 0; i < 61; i++) ultimo = (await iniciar(ex2.slug, `inexistente${i}`)).status;
  assert.equal(ultimo, 429);
  assert.equal((await iniciar(ex2.slug, 'cami')).status, 429);
  sql(`update fallos_acceso set ocurrido_en = now() - interval '11 minutes'`);
  assert.equal((await iniciar(ex2.slug, 'beto')).status, 201, 'pasada la ventana entra de nuevo');
  sql(`delete from fallos_acceso`);
});

// ------------------------------------------------------------------ tokens
await check('token del alumno: no sirve de docente; el de docente no sirve de alumno; el de otro examen tampoco', async () => {
  assert.equal((await call('GET', '/cursos', { token: luz.token })).status, 401);
  assert.equal((await call('GET', `/examenes/${ex1.id}`, { token: luz.token })).status, 401);
  assert.equal((await call('PUT', `/rendir/${ex1.slug}/borrador`, { token: tA, body: { respuestas: {} } })).status, 401);
  assert.equal((await call('PUT', `/rendir/${ex1.slug}/borrador`, { body: { respuestas: {} } })).status, 401);
  assert.equal((await call('PUT', `/rendir/${ex2.slug}/borrador`, { token: luz.token, body: { respuestas: {} } })).status, 403);
});

// ------------------------------------------------------------------ autoguardado
const [q1, q2] = luz.preguntas;
await check('autoguardado: guarda, descarta claves ajenas, y se recupera al retomar', async () => {
  const r = await call('PUT', `/rendir/${ex1.slug}/borrador`, { token: luz.token, body: { respuestas: { [q1.id]: 'a', [q2.id]: true, 'inventada': 'x' } } });
  assert.equal(r.status, 200, r.text);
  const est = await call('GET', `/rendir/${ex1.slug}/intento`, { token: luz.token });
  assert.equal(est.status, 200);
  assert.deepEqual(est.json.borrador, { [q1.id]: 'a', [q2.id]: true });
  assert.equal(est.json.preguntas.length, 2);
});
await check('tamaño: el autoguardado admite respuestas largas; pasado el tope es 400 con mensaje y pasado el cuerpo 413', async () => {
  const guardar = (texto) => call('PUT', `/rendir/${ex1.slug}/borrador`, { token: luz.token, body: { respuestas: { [q1.id]: texto } } });
  assert.equal((await guardar('x'.repeat(90_000))).status, 200);
  assert.equal((await guardar('x'.repeat(500_000))).status, 200, 'antes el tope de Express (100 KB) lo rechazaba');
  const grande = await guardar('x'.repeat(950_000));
  assert.equal(grande.status, 400);
  assert.match(grande.text, /demasiado grande/);
  assert.equal((await guardar('x'.repeat(1_300_000))).status, 413);
  await call('PUT', `/rendir/${ex1.slug}/borrador`, { token: luz.token, body: { respuestas: { [q1.id]: 'a', [q2.id]: true } } });
});
await check('tamaño: el resto de la API conserva el tope de 100 KB (incluso rutas públicas)', async () => {
  assert.equal((await call('POST', '/cursos', { body: { nombre: 'x'.repeat(200_000) } })).status, 413, 'el tope se aplica antes que la autenticación');
  assert.equal((await call('POST', `/rendir/${ex1.slug}/iniciar`, { body: { alumnoEmail: 'luz@x.com', codigoAcceso: 'x'.repeat(200_000) } })).status, 413);
  assert.equal((await call('PUT', `/rendir/${ex1.slug}/borrador`, { token: luz.token, body: { respuestas: { [q1.id]: 'x'.repeat(200_000) } } })).status, 200, 'solo borrador y entrega tienen más margen');
  await call('PUT', `/rendir/${ex1.slug}/borrador`, { token: luz.token, body: { respuestas: { [q1.id]: 'a', [q2.id]: true } } });
});

// ------------------------------------------------------------------ eventos
await check('eventos: solo se registra lo que el docente activó', async () => {
  assert.equal((await call('POST', `/rendir/${ex1.slug}/eventos`, { token: luz.token, body: { tipo: 'pegado', detalle: 'q1' } })).json.registrado, true);
  assert.equal((await call('POST', `/rendir/${ex1.slug}/eventos`, { token: luz.token, body: { tipo: 'cambio_pestana' } })).json.registrado, false);
  assert.equal((await call('POST', `/rendir/${ex1.slug}/eventos`, { token: luz.token, body: { tipo: 'inventado' } })).status, 400);
  assert.equal(sql(`select count(*) from eventos_integridad e join intentos_examen i on i.id=e.intento_id where i.examen_id='${ex1.id}'`), '1');
});

// ------------------------------------------------------------------ entrega
await check('entregar: acuse sin nota; segunda entrega → 409; volver a iniciar → 400', async () => {
  const r = await call('POST', `/rendir/${ex1.slug}/entregar`, { token: luz.token, body: { respuestas: { [q1.id]: 'a', [q2.id]: true } } });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(Object.keys(r.json).sort(), ['aTiempo', 'enviadoEn', 'recibida']);
  assert.equal(r.json.aTiempo, true);
  assert.equal((await call('POST', `/rendir/${ex1.slug}/entregar`, { token: luz.token, body: {} })).status, 409);
  assert.equal((await call('PUT', `/rendir/${ex1.slug}/borrador`, { token: luz.token, body: { respuestas: {} } })).status, 409);
  assert.equal((await iniciar(ex1.slug, 'luz', { consentimiento: true })).status, 400);
});

await check('la corrección corre en segundo plano y el docente ve nota + eventos de integridad', async () => {
  let lista;
  for (let i = 0; i < 20; i++) {
    lista = (await call('GET', `/examenes/${ex1.id}/respuestas`, { token: tA })).json;
    if (lista[0]?.notaTotalSugerida != null) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.equal(lista.length, 1);
  assert.equal(Number(lista[0].notaTotalSugerida), 10);
  assert.deepEqual(lista[0].intento, { estado: 'entregado', eventos: 1 });
  const det = (await call('GET', `/examenes/${ex1.id}/respuestas/${lista[0].id}`, { token: tA })).json;
  assert.equal(det.integridad.estado, 'entregado');
  assert.deepEqual(det.integridad.eventos.map((e) => [e.tipo, e.detalle]), [['pegado', 'q1']]);
  assert.ok(det.integridad.consentimientoEn);
  assert.equal((await call('GET', `/examenes/${ex1.id}/respuestas/${lista[0].id}`, { token: tB })).status, 404);
});

// ------------------------------------------------------------------ vencimientos
const tiempoAtras = (segundos) => `now() - interval '${segundos} seconds'`;
const intentoDe = (nombre, exId) => sql(`select i.id from intentos_examen i join alumnos a on a.id=i.alumno_id where a.email='${nombre}@x.com' and i.examen_id='${exId}'`);

await check('vencido y el alumno nunca vuelve: el docente ve entregado lo autoguardado (estado vencido)', async () => {
  const s = (await iniciar(ex1.slug, 'tomi', { consentimiento: true })).json;
  await call('PUT', `/rendir/${ex1.slug}/borrador`, { token: s.token, body: { respuestas: { [s.preguntas[1].id]: true } } });
  sql(`update intentos_examen set expira_en=${tiempoAtras(120)} where id='${intentoDe('tomi', ex1.id)}'`);
  const lista = (await call('GET', `/examenes/${ex1.id}/respuestas`, { token: tA })).json;
  const r = lista.find((x) => x.alumno.email === 'tomi@x.com');
  assert.ok(r, 'debería haberse entregado solo');
  assert.equal(r.intento.estado, 'vencido');
  const det = (await call('GET', `/examenes/${ex1.id}/respuestas/${r.id}`, { token: tA })).json;
  assert.deepEqual(det.respuestasPorPregunta.map((x) => x.contenidoRespuesta), [null, true]);
  assert.equal((await call('PUT', `/rendir/${ex1.slug}/borrador`, { token: s.token, body: { respuestas: {} } })).status, 409);
});

await check('entrega pasado el margen: se ignora lo que manda el cliente y vale el borrador', async () => {
  const s = (await iniciar(ex1.slug, 'ana', { consentimiento: true })).json;
  await call('PUT', `/rendir/${ex1.slug}/borrador`, { token: s.token, body: { respuestas: { [s.preguntas[0].id]: 'b' } } });
  sql(`update intentos_examen set expira_en=${tiempoAtras(60)} where id='${intentoDe('ana', ex1.id)}'`);
  const r = await call('POST', `/rendir/${ex1.slug}/entregar`, { token: s.token, body: { respuestas: { [s.preguntas[0].id]: 'a', [s.preguntas[1].id]: true } } });
  assert.ok([201, 409].includes(r.status), `${r.status} ${r.text}`);
  const lista = (await call('GET', `/examenes/${ex1.id}/respuestas`, { token: tA })).json;
  const resp = lista.find((x) => x.alumno.email === 'ana@x.com');
  const det = (await call('GET', `/examenes/${ex1.id}/respuestas/${resp.id}`, { token: tA })).json;
  assert.deepEqual(det.respuestasPorPregunta.map((x) => x.contenidoRespuesta), ['b', null], 'no debe valer lo enviado tarde');
});

await check('entrega justo al vencer (dentro del margen de gracia) se acepta con el contenido del cliente', async () => {
  const s = (await iniciar(ex1.slug, 'beto', { consentimiento: true })).json;
  sql(`update intentos_examen set expira_en=${tiempoAtras(5)} where id='${intentoDe('beto', ex1.id)}'`);
  const r = await call('POST', `/rendir/${ex1.slug}/entregar`, { token: s.token, body: { respuestas: { [s.preguntas[1].id]: true } } });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.aTiempo, true);
});

await check('ventana de fechas: examen todavía no abierto o ya cerrado no permite iniciar', async () => {
  const ex3 = await mkExamen({});
  const ec = sql(`select id from examen_comisiones where examen_id='${ex3.id}'`);
  sql(`update examen_comisiones set fecha_inicio=now() + interval '1 day' where id='${ec}'`);
  assert.equal((await call('GET', `/rendir/${ex3.slug}`)).json.ventana.estado, 'no_abierta');
  assert.equal((await iniciar(ex3.slug, 'luz')).status, 400);
  sql(`update examen_comisiones set fecha_inicio=null, fecha_fin=now() - interval '1 day' where id='${ec}'`);
  assert.equal((await call('GET', `/rendir/${ex3.slug}`)).json.ventana.estado, 'cerrada');
  assert.equal((await iniciar(ex3.slug, 'luz')).status, 400);
});

await check('fecha de cierre acota el tiempo: el intento vence a la fechaFin si es antes que la duración', async () => {
  const ex4 = await mkExamen({});
  const ec = sql(`select id from examen_comisiones where examen_id='${ex4.id}'`);
  sql(`update examen_comisiones set fecha_fin=now() + interval '10 minutes' where id='${ec}'`);
  const r = (await iniciar(ex4.slug, 'cami')).json;
  assert.ok(r.expiraEn, JSON.stringify(r));
  const min = (new Date(r.expiraEn) - new Date(r.ahora)) / 60000;
  assert.ok(min > 9 && min <= 10, `expira en ${min} min (duración 60)`);
});

await check('examen sin anti-cheat: no exige consentimiento y no registra eventos', async () => {
  const s = (await iniciar(ex2.slug, 'beto')).json;
  assert.ok(s.token);
  assert.equal((await call('POST', `/rendir/${ex2.slug}/eventos`, { token: s.token, body: { tipo: 'pegado' } })).json.registrado, false);
  assert.equal(s.expiraEn, null, 'ventana abierta sin duración ni cierre = sin límite');
});


// ------------------------------------------------------------------ Fase 2: vara auditable
const exV = await mkExamen({ distribucionEsperada: { umbralAprobacion: 6, aprobadosEsperadosPct: 60 } });
// Cada alumno acierta 2, 1 o 0 preguntas (5 puntos cada una) → notas 10, 5, 5, 0, 0. Son cerradas: sin IA.
const aciertos = { luz: 2, tomi: 1, ana: 1, beto: 0, cami: 0 };
for (const [nombre, ok] of Object.entries(aciertos)) {
  const s = (await iniciar(exV.slug, nombre)).json;
  const [pOpc, pVF] = s.preguntas;
  const r = await call('POST', `/rendir/${exV.slug}/entregar`, { token: s.token, body: { respuestas: { [pOpc.id]: ok >= 1 ? 'a' : 'b', [pVF.id]: ok >= 2 ? true : false } } });
  assert.equal(r.status, 201, r.text);
}
const listarV = async () => (await call('GET', `/examenes/${exV.id}/respuestas`, { token: tA })).json;
for (let i = 0; i < 40; i++) { if ((await listarV()).every((r) => r.estado === 'corregido')) break; await new Promise((r) => setTimeout(r, 250)); }
const porAlumnoV = async () => Object.fromEntries((await listarV()).map((r) => [r.alumno.nombre, r]));
const rid = async (nombre) => (await porAlumnoV())[nombre].id;
const reglaAprob = { modo: 'aprobados_esperados', valor: 60, umbral: 6 };

await check('vara: el examen guarda la distribución esperada y las respuestas quedan corregidas', async () => {
  const ex = (await call('GET', `/examenes/${exV.id}`, { token: tA })).json;
  assert.deepEqual(ex.distribucionEsperada, { umbralAprobacion: 6, aprobadosEsperadosPct: 60 });
  const r = await porAlumnoV();
  assert.deepEqual(Object.values(r).map((x) => Number(x.notaTotalSugerida)).sort((a, b) => b - a), [10, 5, 5, 0, 0]);
});

await check('vara: una expectativa fuera de la escala se rechaza al crear el examen', async () => {
  const base = { cursoId: curso.id, titulo: 'X', consigna: 'c', modalidad: 'ventana_dias', escalaMin: 0, escalaMax: 10, niveles, feedbackModo: 'manual', preguntas: preguntasIn };
  assert.equal((await call('POST', '/examenes', { token: tA, body: { ...base, distribucionEsperada: { umbralAprobacion: 11, aprobadosEsperadosPct: 60 } } })).status, 400);
  assert.equal((await call('POST', '/examenes', { token: tA, body: { ...base, distribucionEsperada: { umbralAprobacion: 6, aprobadosEsperadosPct: 160 } } })).status, 400);
  assert.equal((await call('POST', '/examenes', { token: tA, body: { ...base, escalaMin: 10, escalaMax: 0 } })).status, 400);
});

await check('vara: la vista previa calcula sin guardar nada', async () => {
  const p = await call('POST', `/examenes/${exV.id}/vara/preview`, { token: tA, body: reglaAprob });
  assert.equal(p.status, 201, p.text);
  assert.equal(p.json.desplazamiento, 1);
  assert.equal(p.json.resumen.aprobadosAntes, 1);
  assert.equal(p.json.resumen.aprobadosDespues, 3);
  assert.equal(p.json.resumen.alcanzable, true);
  assert.equal(p.json.filas.length, 5);
  assert.ok((await listarV()).every((r) => r.notaConVara === null && r.ajusteVaraId === null));
  assert.equal((await call('GET', `/examenes/${exV.id}/vara`, { token: tA })).json.length, 0);
});

await check('vara: validaciones de la regla (400)', async () => {
  for (const body of [
    { modo: 'aprobados_esperados', valor: 60 },
    { modo: 'aprobados_esperados', valor: 60, umbral: 11 },
    { modo: 'aprobados_esperados', valor: 160, umbral: 6 },
    { modo: 'porcentaje', valor: 150 },
    { modo: 'puntos', valor: 11 },
    { modo: 'inventado', valor: 1 },
    { valor: 1 },
  ]) {
    assert.equal((await call('POST', `/examenes/${exV.id}/vara`, { token: tA, body })).status, 400, JSON.stringify(body));
  }
});

await check('vara: sin sesión 401, token de alumno 401, y otro docente no ve ni toca nada (404)', async () => {
  assert.equal((await call('POST', `/examenes/${exV.id}/vara`, { body: reglaAprob })).status, 401);
  const alumnoTok = (await iniciar(ex2.slug, 'tomi')).json.token;
  assert.equal((await call('POST', `/examenes/${exV.id}/vara`, { token: alumnoTok, body: reglaAprob })).status, 401);
  const ajenas = [
    ['POST', `/examenes/${exV.id}/vara/preview`, reglaAprob],
    ['POST', `/examenes/${exV.id}/vara`, reglaAprob],
    ['GET', `/examenes/${exV.id}/vara`],
    ['POST', `/examenes/${exV.id}/vara/${exV.id}/revertir`],
    ['GET', `/examenes/${exV.id}/respuestas/${await rid('luz')}/vara`],
  ];
  for (const [m, path, body] of ajenas) assert.equal((await call(m, path, { token: tB, body })).status, 404, `${m} ${path}`);
  assert.ok((await listarV()).every((r) => r.notaConVara === null));
});

let ajuste1;
await check('vara: aplicar guarda notaConVara sin tocar la sugerida ni escribir la final', async () => {
  const a = await call('POST', `/examenes/${exV.id}/vara`, { token: tA, body: reglaAprob });
  assert.equal(a.status, 201, a.text);
  ajuste1 = a.json;
  assert.equal(ajuste1.estado, 'activo');
  const r = await porAlumnoV();
  const conVara = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v.notaConVara)]));
  assert.deepEqual(conVara, { luz: 10, tomi: 6, ana: 6, beto: 1, cami: 1 });
  for (const v of Object.values(r)) {
    assert.equal(v.notaTotalFinal, null, 'la final la escribe solo el docente');
    assert.equal(v.estadoRevision, 'pendiente');
    assert.equal(v.ajusteVaraId, ajuste1.id);
  }
  assert.deepEqual(Object.values(r).map((x) => Number(x.notaTotalSugerida)).sort((a, b) => b - a), [10, 5, 5, 0, 0]);
});

await check('vara: historial con regla, autor y resumen', async () => {
  const h = (await call('GET', `/examenes/${exV.id}/vara`, { token: tA })).json;
  assert.equal(h.length, 1);
  assert.deepEqual(h[0].regla, reglaAprob);
  assert.equal(h[0].autor, 'Ana');
  assert.equal(h[0].resumen.aprobadosDespues, 3);
  assert.match(h[0].descripcion, /al menos 60%/);
});

await check('vara: "por qué cambió esta nota" muestra sugerida, regla, vara y estado', async () => {
  const e = (await call('GET', `/examenes/${exV.id}/respuestas/${await rid('tomi')}/vara`, { token: tA })).json;
  assert.equal(e.notaSugerida, 5);
  assert.equal(e.notaConVara, 6);
  assert.equal(e.notaFinal, null);
  assert.equal(e.ajusteVigente.ajusteId, ajuste1.id);
  assert.equal(e.ajusteVigente.notaBase, 5);
  assert.equal(e.ajusteVigente.notaDespues, 6);
  assert.match(e.explicacion, /sugirió 5/);
  assert.match(e.explicacion, /5 → 6/);
  assert.match(e.explicacion, /Pendiente de revisión/);
});

await check('vara: aceptar una respuesta confirma la nota con vara', async () => {
  const r = await call('PATCH', `/examenes/${exV.id}/respuestas/${await rid('tomi')}`, { token: tA, body: { estadoRevision: 'aceptada' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(Number(r.json.notaTotalFinal), 6);
  const e = (await call('GET', `/examenes/${exV.id}/respuestas/${await rid('tomi')}/vara`, { token: tA })).json;
  assert.match(e.explicacion, /aceptó la sugerencia: nota final 6/);
});

let ajuste2;
await check('vara: un segundo ajuste reemplaza al primero y no toca lo ya revisado', async () => {
  const a = await call('POST', `/examenes/${exV.id}/vara`, { token: tA, body: { modo: 'puntos', valor: 2 } });
  assert.equal(a.status, 201, a.text);
  ajuste2 = a.json;
  const r = await porAlumnoV();
  assert.equal(Number(r.tomi.notaTotalFinal), 6, 'tomi ya estaba revisado');
  assert.equal(r.tomi.ajusteVaraId, ajuste1.id, 'tomi sigue ligado al ajuste bajo el que se revisó');
  assert.deepEqual(['luz', 'ana', 'beto', 'cami'].map((k) => Number(r[k].notaConVara)), [10, 7, 2, 2]);
  const h = (await call('GET', `/examenes/${exV.id}/vara`, { token: tA })).json;
  assert.deepEqual(h.map((x) => x.estado), ['activo', 'reemplazado']);
  const e = (await call('GET', `/examenes/${exV.id}/respuestas/${await rid('ana')}/vara`, { token: tA })).json;
  assert.equal(e.historial.length, 2);
  assert.equal(e.historial[1].notaConVaraAntes, 6, 'el snapshot guarda lo que había antes');
});

await check('vara: solo se revierte el ajuste vigente', async () => {
  assert.equal((await call('POST', `/examenes/${exV.id}/vara/${ajuste1.id}/revertir`, { token: tA })).status, 400);
});

await check('vara: revertir restaura el ajuste anterior y lo deja vigente', async () => {
  const r = await call('POST', `/examenes/${exV.id}/vara/${ajuste2.id}/revertir`, { token: tA });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(r.json, { restauradas: 4, omitidas: 0 });
  const rs = await porAlumnoV();
  assert.deepEqual(['luz', 'ana', 'beto', 'cami'].map((k) => Number(rs[k].notaConVara)), [10, 6, 1, 1]);
  assert.equal(rs.ana.ajusteVaraId, ajuste1.id);
  const h = (await call('GET', `/examenes/${exV.id}/vara`, { token: tA })).json;
  assert.deepEqual(h.map((x) => x.estado), ['revertido', 'activo']);
  assert.ok(h[0].revertidoEn);
});

await check('vara: revertir el primero deja las pendientes sin vara y no toca la respuesta revisada', async () => {
  const r = await call('POST', `/examenes/${exV.id}/vara/${ajuste1.id}/revertir`, { token: tA });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(r.json, { restauradas: 4, omitidas: 1 }); // tomi ya estaba revisada
  const rs = await porAlumnoV();
  assert.ok(['luz', 'ana', 'beto', 'cami'].every((k) => rs[k].notaConVara === null && rs[k].ajusteVaraId === null));
  assert.equal(Number(rs.tomi.notaTotalFinal), 6);
});

await check('vara: volver a aplicar y aceptar en bloque confirma la nota con vara', async () => {
  assert.equal((await call('POST', `/examenes/${exV.id}/vara`, { token: tA, body: reglaAprob })).status, 201);
  const r = await call('POST', `/examenes/${exV.id}/respuestas/bulk-aceptar`, { token: tA });
  assert.equal(r.status, 201, r.text);
  const rs = await porAlumnoV();
  assert.deepEqual(['luz', 'tomi', 'ana', 'beto', 'cami'].map((k) => Number(rs[k].notaTotalFinal)), [10, 6, 6, 1, 1]);
  assert.ok(Object.values(rs).every((x) => x.estadoRevision === 'aceptada'));
  // Con todo revisado ya no hay nada que ajustar.
  assert.equal((await call('POST', `/examenes/${exV.id}/vara`, { token: tA, body: { modo: 'puntos', valor: 1 } })).status, 400);
});

await check('vara: re-corregir descarta la vara de esa respuesta (la base cambió)', async () => {
  const exR = await mkExamen({});
  const s = (await iniciar(exR.slug, 'luz')).json;
  const [pOpc, pVF] = s.preguntas;
  await call('POST', `/rendir/${exR.slug}/entregar`, { token: s.token, body: { respuestas: { [pOpc.id]: 'b', [pVF.id]: false } } });
  const lista = async () => (await call('GET', `/examenes/${exR.id}/respuestas`, { token: tA })).json;
  for (let i = 0; i < 40; i++) { if ((await lista())[0]?.estado === 'corregido') break; await new Promise((r) => setTimeout(r, 250)); }
  assert.equal((await call('POST', `/examenes/${exR.id}/vara`, { token: tA, body: { modo: 'puntos', valor: 1 } })).status, 201);
  assert.equal(Number((await lista())[0].notaConVara), 1);
  const id = (await lista())[0].id;
  assert.equal((await call('POST', `/examenes/${exR.id}/respuestas/${id}/recorregir`, { token: tA })).status, 201);
  const r = (await lista())[0];
  assert.equal(r.notaConVara, null);
  assert.equal(r.ajusteVaraId, null);
});

await check('migración: la nota final que dejaba la vara vieja en pendientes pasa a nota con vara (y es idempotente)', async () => {
  const exM = await mkExamen({});
  const s = (await iniciar(exM.slug, 'luz')).json;
  const [pOpc, pVF] = s.preguntas;
  await call('POST', `/rendir/${exM.slug}/entregar`, { token: s.token, body: { respuestas: { [pOpc.id]: 'a', [pVF.id]: false } } });
  for (let i = 0; i < 40; i++) { if (sql(`select estado from respuestas_examen where examen_id='${exM.id}'`) === 'corregido') break; await new Promise((r) => setTimeout(r, 250)); }
  sql(`update respuestas_examen set nota_total_final=5.5 where examen_id='${exM.id}'`); // estado de la vara vieja
  const archivo = new URL('../../supabase/migrations/20261001_fase2_vara_auditable.sql', import.meta.url);
  const migrar = () => execFileSync('docker', ['exec', '-i', PG, 'psql', '-U', 'postgres', '-d', 'ata', '-v', 'ON_ERROR_STOP=1', '-q'], { input: readFileSync(archivo), stdio: ['pipe', 'pipe', 'pipe'] });
  migrar();
  assert.equal(sql(`select coalesce(nota_con_vara::text,'null') || '|' || coalesce(nota_total_final::text,'null') from respuestas_examen where examen_id='${exM.id}'`), '5.5|null');
  migrar();
  assert.equal(sql(`select coalesce(nota_con_vara::text,'null') || '|' || coalesce(nota_total_final::text,'null') from respuestas_examen where examen_id='${exM.id}'`), '5.5|null');
});


// ------------------------------------------------------------------ endurecimiento: freno de fallos en la base
await check('freno: los fallos quedan en la base (valen con varias instancias) y el barrido los purga pasada la ventana', async () => {
  sql(`delete from fallos_acceso`);
  const exL = await mkExamen({});
  for (let i = 0; i < 3; i++) await iniciar(exL.slug, `nadie${i}`);
  assert.equal(sql(`select count(*) from fallos_acceso where clave like 'ip|%'`), '3', 'quedan en la base, por IP');
  assert.equal(sql(`select count(*) from fallos_acceso where clave not like 'ip|%'`), '0', 'ya no se cuentan por alumno');
  assert.equal((await iniciar(exL.slug, 'tomi')).status, 201, 'un acierto no se frena con pocos fallos');
  sql(`delete from fallos_acceso`);
});

// ------------------------------------------------------------------ vara que también baja notas
const exB = await mkExamen({
  distribucionEsperada: { umbralAprobacion: 6, aprobadosEsperadosPct: 40 },
  preguntas: [4, 3, 2, 1].map((p) => ({ tipo: 'verdadero_falso', enunciado: `VF ${p}`, puntajeMaximo: p, opciones: { correcta: true } })),
});
// Notas: luz 10, tomi 8, ana 6, beto 4, cami 0 (acierta las preguntas de 4,3,2,1 / 4,3,1 / 4,2 / 3,1 / ninguna).
const correctas = { luz: [1, 1, 1, 1], tomi: [1, 1, 0, 1], ana: [1, 0, 1, 0], beto: [0, 1, 0, 1], cami: [0, 0, 0, 0] };
for (const [nombre, ok] of Object.entries(correctas)) {
  const s = (await iniciar(exB.slug, nombre)).json;
  const respuestas = Object.fromEntries(s.preguntas.map((p, i) => [p.id, ok[i] === 1]));
  assert.equal((await call('POST', `/rendir/${exB.slug}/entregar`, { token: s.token, body: { respuestas } })).status, 201);
}
const listarB = async () => (await call('GET', `/examenes/${exB.id}/respuestas`, { token: tA })).json;
for (let i = 0; i < 40; i++) { if ((await listarB()).every((r) => r.estado === 'corregido')) break; await new Promise((r) => setTimeout(r, 250)); }
const notasB = async (campo) => { const r = Object.fromEntries((await listarB()).map((x) => [x.alumno.nombre, x[campo] === null ? null : Number(x[campo])])); return ['luz', 'tomi', 'ana', 'beto', 'cami'].map((k) => r[k]); };
const reglaBaja = { modo: 'aprobados_esperados', valor: 40, umbral: 6, permitirBajar: true };

await check('vara que baja: sin permitirBajar no toca nada aunque aprueben más de lo esperado', async () => {
  assert.deepEqual(await notasB('notaTotalSugerida'), [10, 8, 6, 4, 0]);
  const p = (await call('POST', `/examenes/${exB.id}/vara/preview`, { token: tA, body: { modo: 'aprobados_esperados', valor: 40, umbral: 6 } })).json;
  assert.equal(p.desplazamiento, 0);
  assert.equal(p.resumen.aprobadosAntes, 3);
  assert.equal(p.resumen.aprobadosDespues, 3);
});

await check('vara que baja: con permitirBajar baja lo mínimo para llegar al objetivo', async () => {
  const p = await call('POST', `/examenes/${exB.id}/vara/preview`, { token: tA, body: reglaBaja });
  assert.equal(p.status, 201, p.text);
  assert.equal(p.json.desplazamiento, -0.01, 'alcanza con dejar en 5.99 al que aprueba más justo');
  assert.equal(p.json.resumen.aprobadosAntes, 3);
  assert.equal(p.json.resumen.aprobadosDespues, 2);
  assert.equal(p.json.resumen.alcanzable, true);
  assert.deepEqual(p.json.filas.map((f) => f.notaConVara), [9.99, 7.99, 5.99, 3.99, 0]);
});

await check('vara que baja: permitirBajar no vale en los otros modos, y aplicar guarda la regla con su descripción', async () => {
  assert.equal((await call('POST', `/examenes/${exB.id}/vara/preview`, { token: tA, body: { modo: 'puntos', valor: -1, permitirBajar: true } })).status, 400);
  assert.equal((await call('POST', `/examenes/${exB.id}/vara/preview`, { token: tA, body: { ...reglaBaja, permitirBajar: 'si' } })).status, 400);
  const a = await call('POST', `/examenes/${exB.id}/vara`, { token: tA, body: reglaBaja });
  assert.equal(a.status, 201, a.text);
  assert.match(a.json.descripcion, /alrededor de 40%.*-0\.01/);
  assert.deepEqual(await notasB('notaConVara'), [9.99, 7.99, 5.99, 3.99, 0]);
  assert.deepEqual(await notasB('notaTotalSugerida'), [10, 8, 6, 4, 0], 'la sugerida no se toca nunca');
  assert.deepEqual(await notasB('notaTotalFinal'), [null, null, null, null, null]);
  const e = (await call('GET', `/examenes/${exB.id}/respuestas/${(await listarB()).find((x) => x.alumno.nombre === 'ana').id}/vara`, { token: tA })).json;
  assert.match(e.explicacion, /6 → 5\.99/);
});

await check('vara que baja: revertir devuelve las notas', async () => {
  const h = (await call('GET', `/examenes/${exB.id}/vara`, { token: tA })).json;
  assert.equal((await call('POST', `/examenes/${exB.id}/vara/${h[0].id}/revertir`, { token: tA })).status, 201);
  assert.deepEqual(await notasB('notaConVara'), [null, null, null, null, null]);
});


// ------------------------------------------------------------------ login con Supabase Auth
await check('auth: no hay login ni registro propios (eso es de Supabase); /auth/me devuelve al docente de la sesión', async () => {
  assert.equal((await call('POST', '/auth/login', { body: { email: 'a@x.com', password: 'x' } })).status, 404);
  assert.equal((await call('POST', '/auth/registro', { body: { nombre: 'x', email: 'a@x.com', password: 'x'.repeat(10) } })).status, 404);
  const me = (await call('GET', '/auth/me', { token: tA })).json;
  assert.equal(me.nombre, 'Ana');
  assert.equal(me.email, `ana${sufijo}@x.com`);
  assert.equal(sql(`select count(*) from docentes where auth_user_id='${subA}'`), '1', 'una sola fila aunque haga varios pedidos');
  assert.equal((await call('GET', '/auth/me', { token: tokenSupabase({ email: 'x@x.com' }) })).status, 200);
});

await check('auth: token inválido, vencido, de otro proyecto, de otra audiencia o firmado por otro → 401', async () => {
  const casos = [
    tokenSupabase({ email: 'a@x.com', exp: Math.floor(Date.now() / 1000) - 60 }),
    tokenSupabase({ email: 'a@x.com', iss: 'https://otro.supabase.co/auth/v1' }),
    tokenSupabase({ email: 'a@x.com', aud: 'anon' }),
    tokenSupabase({ email: 'a@x.com', secreto: 'otro-secreto-distinto-de-40-caracteres!' }),
    'basura',
  ];
  for (const t of casos) assert.equal((await call('GET', '/auth/me', { token: t })).status, 401);
  assert.equal((await call('GET', '/auth/me')).status, 401);
});

await check('auth: sin email confirmado no se crea el docente ni se entra', async () => {
  const sub = randomUUID();
  const r = await call('GET', '/auth/me', { token: tokenSupabase({ sub, email: `sinconfirmar${sufijo}@x.com`, verificado: false }) });
  assert.equal(r.status, 401);
  assert.match(r.text, /Confirmá tu email/);
  assert.equal(sql(`select count(*) from docentes where auth_user_id='${sub}' or email='sinconfirmar${sufijo}@x.com'`), '0');
});

await check('auth: un docente anterior a Supabase Auth se vincula por email confirmado y conserva sus datos', async () => {
  const email = `legacy${sufijo}@x.com`;
  const id = sql(`insert into docentes (nombre, email) values ('Legacy', '${email.toUpperCase()}') returning id`).split('\n')[0];
  sql(`insert into cursos (docente_id, nombre) values ('${id}', 'Curso de antes')`);

  // Quien conoce el email pero no lo confirmó, no se queda con la cuenta.
  const intruso = await call('GET', '/cursos', { token: tokenSupabase({ email, verificado: false }) });
  assert.equal(intruso.status, 401);
  assert.equal(sql(`select coalesce(auth_user_id::text,'null') from docentes where id='${id}'`), 'null');

  const sub = randomUUID();
  const t = tokenSupabase({ sub, email, nombre: 'Otro Nombre' });
  const cursos = await call('GET', '/cursos', { token: t });
  assert.equal(cursos.status, 200, cursos.text);
  assert.deepEqual(cursos.json.map((c) => c.nombre), ['Curso de antes']);
  assert.equal(sql(`select auth_user_id::text from docentes where id='${id}'`), sub);
  assert.equal(sql(`select nombre from docentes where id='${id}'`), 'Legacy', 'no pisa el nombre que ya tenía');
  assert.equal(sql(`select count(*) from docentes where lower(email)='${email}'`), '1');

  // Otro usuario de Supabase con ese mismo email (aunque confirmado) no puede tomar la cuenta ya vinculada.
  assert.equal((await call('GET', '/cursos', { token: tokenSupabase({ email }) })).status, 409);
  // Y el vinculado sigue entrando.
  assert.equal((await call('GET', '/cursos', { token: t })).status, 200);
});

await check('auth: el token de un alumno (firmado por el backend) no vale como sesión de docente', async () => {
  const s = (await iniciar(ex2.slug, 'ana')).json;
  assert.ok(s.token);
  for (const path of ['/auth/me', '/cursos', `/examenes/${ex2.id}`]) assert.equal((await call('GET', path, { token: s.token })).status, 401, path);
});


// ------------------------------------------------------------------ rúbrica simple (como en trabajos prácticos)
await check('rúbrica: un criterio es nombre + qué se espera + puntos; los 5 niveles son opcionales', async () => {
  const crear = (criterios) => call('POST', '/examenes', { token: tA, body: { cursoId: curso.id, titulo: 'Abierto', consigna: 'c', modalidad: 'ventana_dias', escalaMin: 0, escalaMax: 10, niveles, feedbackModo: 'manual', preguntas: [{ tipo: 'desarrollo', enunciado: 'Explicá', puntajeMaximo: 10, criterios }] } });
  const simple = await crear([{ nombre: 'Claridad', descripcion: 'Se entiende', puntajeMaximo: 6 }, { nombre: 'Precisión', descripcion: 'Sin errores', puntajeMaximo: 4 }]);
  assert.equal(simple.status, 201, simple.text);
  const guardados = (await call('GET', `/examenes/${simple.json.id}`, { token: tA })).json.preguntas[0].criterios;
  assert.deepEqual(guardados.map((c) => [c.nombre, Number(c.puntajeMaximo), c.nivelesDescripcion]), [['Claridad', 6, []], ['Precisión', 4, []]]);

  const cinco = [1, 2, 3, 4, 5].map((o) => ({ orden: o, nombre: `N${o}`, descripcion: `Nivel ${o} implica…` }));
  assert.equal((await crear([{ nombre: 'Con niveles', descripcion: 'd', puntajeMaximo: 5, nivelesDescripcion: cinco }])).status, 201, 'los niveles detallados siguen valiendo');
  assert.equal((await crear([{ nombre: 'A medias', descripcion: 'd', puntajeMaximo: 5, nivelesDescripcion: cinco.slice(0, 3) }])).status, 400, 'o son los 5 o ninguno');
  assert.equal((await crear([{ nombre: 'Sin qué se espera', puntajeMaximo: 5 }])).status, 400);
  assert.equal((await crear([])).status, 400, 'una pregunta abierta necesita al menos un criterio');
});

await check('flujo simple: curso nuevo + comisión con alumnos pegados + publicar, todo con la API que usa el asistente', async () => {
  const c = (await call('POST', '/cursos', { token: tA, body: { nombre: 'Curso creado desde el asistente' } })).json;
  const ex = (await call('POST', '/examenes', { token: tA, body: { cursoId: c.id, titulo: 'Rápido', consigna: 'c', modalidad: 'ventana_dias', escalaMin: 0, escalaMax: 10, niveles, feedbackModo: 'manual', preguntas: preguntasIn } })).json;
  const com2 = (await call('POST', `/cursos/${c.id}/comisiones`, { token: tA, body: { nombre: 'Grupo', alumnos: [{ nombre: 'Ana Pérez', email: 'ana.perez@x.com' }, { nombre: 'luis', email: 'luis@x.com' }] } })).json;
  const pub = await call('POST', `/examenes/${ex.id}/comisiones`, { token: tA, body: { comisionId: com2.id } });
  assert.equal(pub.status, 201, pub.text);
  assert.match(pub.json.urlAcceso, /\/rendir\//);
  const det = (await call('GET', `/comisiones/${com2.id}`, { token: tA })).json;
  assert.equal(det.alumnos.length, 2);
  const dentro = await call('POST', `/rendir/${pub.json.urlAcceso.split('/rendir/')[1]}/iniciar`, { body: { alumnoEmail: 'ana.perez@x.com' } });
  assert.equal(dentro.status, 201, dentro.text); // entra solo con su email
});

console.log(`\n${n} checks OK${process.exitCode ? ' — HAY FALLAS' : ''}`);
