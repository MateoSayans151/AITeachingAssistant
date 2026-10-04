// Tests de las invitaciones por mail (el docente le manda a cada alumno el link para rendir): el contenido del mail
// (función pura), el servicio (lote en segundo plano con concurrencia baja, cuota, un solo lote por examen, modo prueba),
// y el controller (acceso al examen y sesión de docente). Corren sin base de datos ni red (el `fetch` es falso):
//   npm test
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ConflictException, ForbiddenException, NotFoundException, RequestMethod, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SignJWT } from 'jose';
import { AuthGuard } from '../src/auth/auth.guard';
import { IS_PUBLIC_KEY } from '../src/auth/public.decorator';
import { VerificadorSesion } from '../src/auth/verificador-sesion';
import { MailService, MOTIVO_CUOTA, MailParaEnviar, ResultadoEnvio } from '../src/mail/mail.service';
import { armarMailInvitacion, fechaLegible, urlDeRendir, DatosMailInvitacion } from '../src/mail/mail-invitacion.util';
import {
  InvitacionesService,
  MENSAJE_INVITACIONES_EN_CURSO,
  MENSAJE_PUBLICACION_AJENA,
  MENSAJE_SIN_ALUMNOS,
  MENSAJE_SIN_MAIL_PARA_INVITAR,
  MENSAJE_SIN_PUBLICACIONES,
  MENSAJE_VENTANA_CERRADA,
} from '../src/mail/invitaciones.service';
import { InvitacionesController } from '../src/mail/invitaciones.controller';
import { InvitarAlumnosDto } from '../src/mail/dto/invitar-alumnos.dto';

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
// 1. armarMailInvitacion (función pura)
// ---------------------------------------------------------------------------
// 2026-10-06 21:30 UTC = martes 6 de octubre, 18:30 en Buenos Aires (UTC-3).
const AHORA = new Date('2026-10-01T12:00:00Z');
const datosBase: DatosMailInvitacion = {
  nombreAlumno: 'Ana Pérez',
  emailAlumno: 'ana@mail.com',
  tituloExamen: 'Parcial 1',
  nombreCurso: 'Bases de Datos',
  nombreDocente: 'Prof. Gómez',
  slugAcceso: 'slug-abc-123',
  frontendOrigin: 'https://app.ejemplo.com',
  ahora: AHORA,
};
const URL_BASE = 'https://app.ejemplo.com/rendir/slug-abc-123';

test('armarMailInvitacion: asunto, saludo, título, curso, docente, link, email con el que ingresar y pie', () => {
  const { subject, html, text } = armarMailInvitacion(datosBase);
  assert.equal(subject, 'Te invitaron a rendir "Parcial 1"');

  for (const cuerpo of [html, text]) {
    assert.match(cuerpo, /Hola Ana Pérez,/);
    assert.match(cuerpo, /Parcial 1/);
    assert.match(cuerpo, /Bases de Datos/);
    assert.match(cuerpo, /Prof\. Gómez/);
    assert.ok(cuerpo.includes(URL_BASE), 'lleva el link del examen');
    assert.match(cuerpo, /Ingresá con este mismo email: ana@mail\.com/);
    assert.match(cuerpo, /Este mail lo envió AI Teaching Assistant en nombre de Prof\. Gómez\. Si tenés dudas, respondé a este mail: le llega a tu docente\./);
  }
  assert.match(text, /^Hola Ana Pérez,\n\nProf\. Gómez te invitó a rendir "Parcial 1" \(Bases de Datos\)\./);
});

test('armarMailInvitacion: sin nombre, sin curso ni docente el saludo y el pie se arreglan solos', () => {
  const { text, html } = armarMailInvitacion({ ...datosBase, nombreAlumno: '  ', nombreCurso: null, nombreDocente: '' });
  assert.ok(text.startsWith('Hola,\n'));
  assert.match(text, /tu docente te invitó a rendir "Parcial 1"\./);
  assert.doesNotMatch(text, /\(\)/);
  assert.match(text, /en nombre de tu docente\./);
  assert.doesNotMatch(html, /undefined|null/);
});

test('armarMailInvitacion: escapa TODO texto variable contra inyección de HTML (alumno, email, título, curso, docente, slug, origen)', () => {
  const sucio = '<script>alert(1)</script><img src=x onerror=alert(2)>"\'&';
  const { html, subject, text } = armarMailInvitacion({
    ...datosBase,
    nombreAlumno: sucio,
    emailAlumno: `"><b>x</b>@mail.com`,
    tituloExamen: sucio,
    nombreCurso: sucio,
    nombreDocente: sucio,
    slugAcceso: '"><script>x</script>',
    frontendOrigin: 'https://app.ejemplo.com/"><script>y</script>',
  });
  assert.doesNotMatch(html, /<script>|<img |<b>x<\/b>|onerror=alert\(2\)>/i);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;@mail.com'));
  // En el texto plano no hay HTML que escapar: el contenido va tal cual (y el slug, codificado para ir en la URL).
  assert.ok(text.includes(sucio));
  assert.ok(text.includes(encodeURIComponent('"><script>x</script>')));
  assert.doesNotMatch(subject, /\n/);
});

test('armarMailInvitacion: el asunto es de una sola línea y se acorta si el título es larguísimo', () => {
  const { subject } = armarMailInvitacion({ ...datosBase, tituloExamen: 'Parcial\r\nBcc: otro@x.com ' + 'x'.repeat(400) });
  assert.doesNotMatch(subject, /[\r\n]/);
  assert.ok(subject.length < 220, `${subject.length}`);
  assert.ok(subject.startsWith('Te invitaron a rendir "Parcial Bcc: otro@x.com'));
});

test('armarMailInvitacion: sin fechas dice que ya está disponible; no inventa vencimiento', () => {
  for (const sinFechas of [{}, { fechaInicio: null, fechaFin: null }, { fechaInicio: 'no-es-una-fecha', fechaFin: '' }]) {
    const { text, html } = armarMailInvitacion({ ...datosBase, ...sinFechas });
    for (const cuerpo of [text, html]) {
      assert.match(cuerpo, /Ya está disponible\./);
      assert.doesNotMatch(cuerpo, /Se habilita|Podés rendirlo hasta/);
    }
  }
});

test('armarMailInvitacion: con fechas, dice cuándo se habilita y hasta cuándo se puede rendir (hora de Buenos Aires)', () => {
  const futuro = armarMailInvitacion({ ...datosBase, fechaInicio: new Date('2026-10-06T21:30:00Z'), fechaFin: '2026-10-08T02:05:00Z' });
  assert.match(futuro.text, /Se habilita el martes 6 de octubre de 2026, 18:30 h\./);
  // 02:05 UTC del 8 es todavía el 7 a las 23:05 en Buenos Aires.
  assert.match(futuro.text, /Podés rendirlo hasta el miércoles 7 de octubre de 2026, 23:05 h\./);
  assert.doesNotMatch(futuro.text, /Ya está disponible/);
  assert.match(futuro.html, /Se habilita el martes 6 de octubre de 2026, 18:30 h\./);

  // Ya abierta (inicio en el pasado) pero con cierre: disponible + hasta cuándo.
  const abierta = armarMailInvitacion({ ...datosBase, fechaInicio: new Date('2026-09-30T00:00:00Z'), fechaFin: new Date('2026-10-08T02:05:00Z') });
  assert.match(abierta.text, /Ya está disponible\.\nPodés rendirlo hasta el miércoles 7 de octubre de 2026, 23:05 h\./);
  assert.doesNotMatch(abierta.text, /Se habilita/);

  // Solo inicio en el futuro, sin cierre.
  const soloInicio = armarMailInvitacion({ ...datosBase, fechaInicio: new Date('2026-10-06T21:30:00Z') });
  assert.match(soloInicio.text, /Se habilita el .*\./);
  assert.doesNotMatch(soloInicio.text, /Podés rendirlo hasta/);

  assert.equal(fechaLegible(new Date('2026-10-07T03:00:00Z')), 'miércoles 7 de octubre de 2026, 00:00 h');
});

test('armarMailInvitacion: la duración solo sale si el examen la tiene ("Tenés N minutos desde que empezás")', () => {
  assert.match(armarMailInvitacion({ ...datosBase, duracionMinutos: 90 }).text, /Tenés 90 minutos desde que empezás\./);
  assert.match(armarMailInvitacion({ ...datosBase, duracionMinutos: 90 }).html, /Tenés 90 minutos desde que empezás\./);
  assert.match(armarMailInvitacion({ ...datosBase, duracionMinutos: 1 }).text, /Tenés 1 minuto desde que empezás\./);
  for (const sin of [null, undefined, 0, -5]) {
    assert.doesNotMatch(armarMailInvitacion({ ...datosBase, duracionMinutos: sin }).text, /minuto|Tenés/, String(sin));
  }
});

test('armarMailInvitacion: avisa del monitoreo solo si hay señales activas, y dice cuáles y que no bajan la nota', () => {
  const todas = armarMailInvitacion({ ...datosBase, antiCheat: { pantallaCompleta: true, cambioPestana: true, pegado: true } });
  for (const cuerpo of [todas.text, todas.html]) {
    assert.match(cuerpo, /salís de la pantalla completa/);
    assert.match(cuerpo, /cambiás de pestaña o de ventana/);
    assert.match(cuerpo, /pegás texto en una respuesta/);
    assert.match(cuerpo, /información para tu docente: no te bajan la nota automáticamente/);
  }

  const solo = armarMailInvitacion({ ...datosBase, antiCheat: { pantallaCompleta: false, cambioPestana: true, pegado: false } });
  assert.match(solo.text, /cambiás de pestaña/);
  assert.doesNotMatch(solo.text, /pantalla completa|pegás/);

  for (const sin of [null, undefined, {}, { pantallaCompleta: false, cambioPestana: false, pegado: false }, 'si', 5]) {
    const { text, html } = armarMailInvitacion({ ...datosBase, antiCheat: sin });
    assert.doesNotMatch(text, /señales|registra/, JSON.stringify(sin));
    assert.doesNotMatch(html, /señales|registra/, JSON.stringify(sin));
  }
});

test('armarMailInvitacion: el link es FRONTEND_ORIGIN/rendir/<slug> (barra final y origen vacío incluidos) y es el único link del HTML', () => {
  assert.equal(urlDeRendir('https://app.ejemplo.com/', 'abc'), 'https://app.ejemplo.com/rendir/abc');
  assert.equal(urlDeRendir('https://app.ejemplo.com///', 'abc'), 'https://app.ejemplo.com/rendir/abc');
  assert.equal(urlDeRendir(undefined, 'abc'), 'http://localhost:3000/rendir/abc');
  assert.equal(urlDeRendir('  ', 'abc'), 'http://localhost:3000/rendir/abc');

  const { html, text } = armarMailInvitacion({ ...datosBase, frontendOrigin: undefined, slugAcceso: '0b1c2d3e-aaaa-bbbb-cccc-1234567890ab' });
  const link = 'http://localhost:3000/rendir/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab';
  assert.ok(text.includes(link));
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 1);
  assert.ok(hrefs.every((h) => h === link), `hrefs: ${hrefs}`);
  assert.doesNotMatch(html, /<img|<script|<link|src=/i);
  assert.doesNotMatch(html.split(link).join(''), /https?:\/\//, 'ninguna otra URL en el HTML');
});

// ---------------------------------------------------------------------------
// 2. InvitacionesService
// ---------------------------------------------------------------------------
const EC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EC_AJENA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const alumno = (id: string, extra: Record<string, unknown> = {}) => ({ id: `al-${id}`, nombre: `Alumno ${id}`, email: `${id}@mail.com`, ...extra });
const alumnos = (n: number, desde = 1) => Array.from({ length: n }, (_, i) => alumno(`a${i + desde}`));
const publicacion = (id: string, slug: string, listado: Array<Record<string, any>>, extra: Record<string, unknown> = {}) => ({
  id,
  slugAcceso: slug,
  fechaInicio: null as Date | null,
  fechaFin: null as Date | null,
  createdAt: new Date(2026, 8, 1, 0, 0, id === EC_A ? 0 : 1),
  comision: { alumnos: listado },
  ...extra,
});

function examenBase(comisiones: Array<Record<string, any>>, extra: Record<string, unknown> = {}) {
  return {
    id: 'ex-1',
    titulo: 'Parcial 1',
    duracionMinutos: 60 as number | null,
    antiCheat: null as unknown,
    curso: { nombre: 'Bases de Datos', docente: { nombre: 'Prof. Gómez', email: 'gomez@facu.edu.ar' } },
    comisiones,
    ...extra,
  };
}

/** Prisma de mentira: devuelve el examen y filtra sus publicaciones como lo haría `where` de la relación. */
function prismaInvit(examen: Record<string, any> | null) {
  const consultas: any[] = [];
  const prisma = {
    examen: {
      findUnique: async (args: any) => {
        consultas.push(args);
        if (!examen || args.where.id !== examen.id) return null;
        const filtro = args.select.comisiones.where;
        return { ...examen, comisiones: examen.comisiones.filter((c: any) => !filtro || c.id === filtro.id).map((c: any) => ({ ...c })) };
      },
    },
  };
  return { prisma, consultas };
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

function servicio(examen: Record<string, any> | null, mail: any = mailFalso(), env: Record<string, string | undefined> = { FRONTEND_ORIGIN: 'https://app.ejemplo.com' }) {
  const { prisma, consultas } = prismaInvit(examen);
  const svc = new InvitacionesService(prisma as any, mail as any, { get: (k: string) => env[k] } as any);
  svc.pausaEntreEnviosMs = 0; // en los tests no se espera de verdad
  svc.ahora = () => AHORA;
  const logs: string[] = [];
  (svc as any).logger = loggerMudo(logs);
  return { svc, mail, consultas, logs };
}

const terminoElLote = (svc: InvitacionesService, examenId = 'ex-1') => esperarHasta(() => !svc.estado(examenId).enCurso);
const unaComision = (n = 3) => examenBase([publicacion(EC_A, 'slug-a', alumnos(n))]);

test('estado: si nunca se mandó, ceros y enCurso false; informa configuración y modo prueba', () => {
  const { svc } = servicio(unaComision(), mailFalso({ modoPrueba: 'yo@prueba.com' }));
  assert.deepEqual(svc.estado('ex-1'), { configurado: true, modoPrueba: 'yo@prueba.com', total: 0, enviados: 0, conError: 0, enCurso: false, ultimoError: null });
  assert.deepEqual(servicio(unaComision(), mailFalso({ configurado: false })).svc.estado('ex-1'), {
    configurado: false, modoPrueba: null, total: 0, enviados: 0, conError: 0, enCurso: false, ultimoError: null,
  });
});

test('invitar: responde enseguida con cuántos salen y manda a TODOS los alumnos de la comisión con su link y su email', async () => {
  const { svc, mail } = servicio(
    examenBase([publicacion(EC_A, 'slug-a', alumnos(3), { fechaFin: new Date('2026-10-08T02:05:00Z') })], { antiCheat: { pegado: true } }),
  );
  assert.deepEqual(await svc.invitar('ex-1'), { aEnviar: 3 });
  assert.equal(svc.estado('ex-1').total, 3);
  await terminoElLote(svc);

  assert.deepEqual(mail.enviados.map((m: MailParaEnviar) => m.to).sort(), ['a1@mail.com', 'a2@mail.com', 'a3@mail.com']);
  const m = mail.enviados.find((x: MailParaEnviar) => x.to === 'a2@mail.com')!;
  assert.equal(m.subject, 'Te invitaron a rendir "Parcial 1"');
  assert.equal(m.replyTo, 'gomez@facu.edu.ar', 'las dudas le llegan al docente');
  for (const cuerpo of [m.html, m.text]) {
    assert.ok(cuerpo.includes('https://app.ejemplo.com/rendir/slug-a'));
    assert.match(cuerpo, /Hola Alumno a2,/);
    assert.match(cuerpo, /Ingresá con este mismo email: a2@mail\.com/);
    assert.match(cuerpo, /Prof\. Gómez/);
    assert.match(cuerpo, /Tenés 60 minutos/);
    assert.match(cuerpo, /pegás texto/);
    assert.match(cuerpo, /Podés rendirlo hasta el miércoles 7 de octubre de 2026, 23:05 h\./);
  }
  assert.deepEqual(svc.estado('ex-1'), { configurado: true, modoPrueba: null, total: 3, enviados: 3, conError: 0, enCurso: false, ultimoError: null });
});

test('invitar: sin examenComisionId manda a todas las comisiones donde está publicado, cada alumno con el link de la suya', async () => {
  const { svc, mail } = servicio(examenBase([publicacion(EC_A, 'slug-a', alumnos(2)), publicacion(EC_B, 'slug-b', alumnos(2, 10))]));
  assert.deepEqual(await svc.invitar('ex-1'), { aEnviar: 4 });
  await terminoElLote(svc);

  const linkDe = (to: string) => mail.enviados.find((m: MailParaEnviar) => m.to === to)!.text.match(/https:\/\/\S+/)![0];
  assert.equal(linkDe('a1@mail.com'), 'https://app.ejemplo.com/rendir/slug-a');
  assert.equal(linkDe('a2@mail.com'), 'https://app.ejemplo.com/rendir/slug-a');
  assert.equal(linkDe('a10@mail.com'), 'https://app.ejemplo.com/rendir/slug-b');
  assert.equal(linkDe('a11@mail.com'), 'https://app.ejemplo.com/rendir/slug-b');
  assert.equal(svc.estado('ex-1').enviados, 4);
});

test('invitar: con examenComisionId manda solo a esa publicación; si no es de este examen (o no es un id) responde 404 y no manda nada', async () => {
  const examen = examenBase([publicacion(EC_A, 'slug-a', alumnos(2)), publicacion(EC_B, 'slug-b', alumnos(2, 10))]);
  const { svc, mail, consultas } = servicio(examen);
  assert.deepEqual(await svc.invitar('ex-1', EC_B), { aEnviar: 2 });
  await terminoElLote(svc);
  assert.deepEqual(mail.enviados.map((m: MailParaEnviar) => m.to).sort(), ['a10@mail.com', 'a11@mail.com']);
  assert.deepEqual(consultas[0].select.comisiones.where, { id: EC_B }, 'filtra en la consulta por la publicación pedida');

  mail.enviados.length = 0;
  await assert.rejects(() => svc.invitar('ex-1', EC_AJENA), (e: any) => e instanceof NotFoundException && e.message === MENSAJE_PUBLICACION_AJENA);
  await assert.rejects(() => svc.invitar('ex-1', 'no-es-un-uuid'), NotFoundException);
  assert.equal(mail.enviados.length, 0);
  assert.equal(svc.estado('ex-1').enCurso, false, 'un pedido rechazado no deja el examen "en curso"');
  assert.equal(svc.estado('ex-1').total, 2, 'ni borra el estado del último envío');

  await assert.rejects(() => servicio(null).svc.invitar('ex-1'), NotFoundException);
});

test('invitar: un mismo email no recibe dos mails en el mismo lote (mayúsculas y espacios no cuentan; ni entre comisiones)', async () => {
  const { svc, mail } = servicio(
    examenBase([
      publicacion(EC_A, 'slug-a', [alumno('x', { email: 'Ana@Mail.com' }), alumno('y', { email: ' ana@mail.com ' }), alumno('z', { email: 'otra@mail.com' }), alumno('v', { email: '  ' })]),
      publicacion(EC_B, 'slug-b', [alumno('w', { email: 'ANA@mail.com' }), alumno('u', { email: 'nueva@mail.com' })]),
    ]),
  );
  assert.deepEqual(await svc.invitar('ex-1'), { aEnviar: 3 });
  await terminoElLote(svc);
  assert.deepEqual(mail.enviados.map((m: MailParaEnviar) => m.to).sort(), ['Ana@Mail.com', 'nueva@mail.com', 'otra@mail.com']);
  assert.ok(mail.enviados[0].text.includes('slug-a'), 'gana la primera publicación en la que aparece');
  assert.equal(svc.estado('ex-1').total, 3);
});

test('invitar: manda de a pocos (nunca más de 2 a la vez) y con una pausa entre uno y otro', async () => {
  const { svc, mail } = servicio(unaComision(7));
  const pausas: number[] = [];
  svc.pausaEntreEnviosMs = 1000;
  svc.esperar = async (ms) => void pausas.push(ms);
  assert.equal(svc.enviosEnParalelo, 2);

  assert.deepEqual(await svc.invitar('ex-1'), { aEnviar: 7 });
  await terminoElLote(svc);
  assert.equal(mail.enviados.length, 7);
  assert.equal(mail.maximoSimultaneo, 2);
  assert.ok(pausas.length >= 4 && pausas.every((ms) => ms === 1000), `pausas: ${pausas}`);

  // La configuración por defecto es la que respeta el rate limit de Resend (≤ 2 envíos por segundo).
  const porDefecto = new InvitacionesService({} as any, {} as any, {} as any);
  assert.equal(porDefecto.enviosEnParalelo, 2);
  assert.ok(porDefecto.pausaEntreEnviosMs >= 1000);
});

test('invitar: si Resend avisa que se agotó la cuota, corta el lote y deja el motivo en ultimoError', async () => {
  const mail = mailFalso({ resultado: (_m, n) => (n >= 3 ? { ok: false, motivo: MOTIVO_CUOTA, cuota: true } : { ok: true }) });
  const { svc } = servicio(unaComision(6), mail);
  svc.enviosEnParalelo = 1;

  assert.deepEqual(await svc.invitar('ex-1'), { aEnviar: 6 });
  await terminoElLote(svc);

  // Salieron 2; el 3º recibió la cuota agotada y de ahí en más ni se intentó.
  assert.equal(mail.enviados.length, 3, 'después de la cuota no se hace ningún pedido más');
  assert.deepEqual(svc.estado('ex-1'), { configurado: true, modoPrueba: null, total: 6, enviados: 2, conError: 1, enCurso: false, ultimoError: MOTIVO_CUOTA });
  assert.match(svc.estado('ex-1').ultimoError!, /límite de envíos de tu plan de Resend; reintentá más tarde\./);
});

test('invitar: con 2 en paralelo, al llegar la cuota los demás frenan igual', async () => {
  const mail = mailFalso({ resultado: () => ({ ok: false, motivo: MOTIVO_CUOTA, cuota: true }) });
  const { svc } = servicio(unaComision(8), mail);
  await svc.invitar('ex-1');
  await terminoElLote(svc);
  assert.ok(mail.enviados.length <= 2, `se hicieron ${mail.enviados.length} pedidos con la cuota agotada`);
  assert.equal(svc.estado('ex-1').ultimoError, MOTIVO_CUOTA);
  assert.equal(svc.estado('ex-1').enviados, 0);
});

test('invitar: un envío fallido (o una excepción) no corta el lote: suma conError, guarda el motivo y sigue con los demás', async () => {
  const mail = mailFalso({
    resultado: (m) => {
      if (m.to === 'a2@mail.com') return { ok: false, motivo: 'Resend rechazó el mail: buzón inexistente' };
      if (m.to === 'a4@mail.com') throw new Error('se cayó todo');
      return { ok: true };
    },
  });
  const { svc, logs } = servicio(unaComision(5), mail);
  await svc.invitar('ex-1');
  await terminoElLote(svc);

  assert.equal(mail.enviados.length, 5, 'se intentó con todos');
  const e = svc.estado('ex-1');
  assert.equal(e.enviados, 3);
  assert.equal(e.conError, 2);
  assert.equal(e.total, 5);
  assert.equal(e.enCurso, false);
  assert.ok(e.ultimoError, 'queda un motivo para mostrarle al docente');
  assert.equal(logs.length, 1);
  assert.match(logs[0], /al-a4/);

  // Un error que NO es de cuota no deja un motivo de cuota.
  const sinCuota = servicio(unaComision(2), mailFalso({ resultado: () => ({ ok: false, motivo: 'Resend rechazó el mail: dominio no verificado' }) }));
  await sinCuota.svc.invitar('ex-1');
  await terminoElLote(sinCuota.svc);
  assert.deepEqual(sinCuota.svc.estado('ex-1'), { configurado: true, modoPrueba: null, total: 2, enviados: 0, conError: 2, enCurso: false, ultimoError: 'Resend rechazó el mail: dominio no verificado' });
});

test('invitar: no permite dos lotes a la vez para el mismo examen (409), ni siquiera dos pedidos simultáneos; después sí', async () => {
  const puerta = compuerta();
  const mail = mailFalso({ resultado: async () => (await puerta.abierta, { ok: true }) });
  const { svc } = servicio(unaComision(3), mail);

  assert.deepEqual(await svc.invitar('ex-1'), { aEnviar: 3 });
  assert.equal(svc.estado('ex-1').enCurso, true);
  await assert.rejects(() => svc.invitar('ex-1'), (e: any) => e instanceof ConflictException && e.message === MENSAJE_INVITACIONES_EN_CURSO);
  await assert.rejects(() => svc.invitar('ex-1', EC_A), ConflictException);
  await esperarHasta(() => mail.enviados.length === 2);
  assert.equal(mail.enviados.length, 2, 'el segundo pedido no lanzó otro lote');

  puerta.abrir();
  await terminoElLote(svc);
  assert.equal(mail.enviados.length, 3);
  assert.equal(svc.estado('ex-1').enviados, 3);

  // Terminado el lote, se puede volver a invitar.
  assert.deepEqual(await svc.invitar('ex-1'), { aEnviar: 3 });
  await terminoElLote(svc);
  assert.equal(mail.enviados.length, 6);

  // Dos pedidos que llegan JUNTOS (los dos pasan antes de que el primero termine de leer la base): sale uno solo.
  const { svc: otro, mail: mail2 } = servicio(unaComision(2));
  const resultados = await Promise.allSettled([otro.invitar('ex-1'), otro.invitar('ex-1')]);
  assert.deepEqual(resultados.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  await terminoElLote(otro);
  assert.equal(mail2.enviados.length, 2);
});

test('invitar: el bloqueo es por examen: un lote en curso de otro examen no impide invitar a este', async () => {
  const puerta = compuerta();
  const mail = mailFalso({ resultado: async () => (await puerta.abierta, { ok: true }) });
  const { svc } = servicio(unaComision(2), mail);
  (svc as any).estados.set('otro-examen', { total: 5, enviados: 1, conError: 0, enCurso: true, ultimoError: null });

  assert.deepEqual(await svc.invitar('ex-1'), { aEnviar: 2 });
  assert.equal(svc.estado('otro-examen').enCurso, true);
  assert.equal(svc.estado('otro-examen').total, 5);
  puerta.abrir();
  await terminoElLote(svc);
});

test('invitar: sin el envío de mails configurado responde 409 con el motivo y no consulta ni manda nada', async () => {
  const { svc, mail, consultas } = servicio(unaComision(), mailFalso({ configurado: false }));
  await assert.rejects(
    () => svc.invitar('ex-1'),
    (e: any) =>
      e instanceof ConflictException &&
      e.message === 'Para mandar invitaciones falta configurar el envío de mails en el servidor: RESEND_API_KEY y EMAIL_FROM.' &&
      e.message === MENSAJE_SIN_MAIL_PARA_INVITAR,
  );
  assert.equal(consultas.length, 0);
  assert.equal(mail.enviados.length, 0);
  assert.equal(svc.estado('ex-1').enCurso, false);
});

test('invitar: 409 si el examen no está publicado en ninguna comisión, si no hay alumnos con email o si la ventana ya cerró', async () => {
  await assert.rejects(() => servicio(examenBase([])).svc.invitar('ex-1'), (e: any) => e instanceof ConflictException && e.message === MENSAJE_SIN_PUBLICACIONES);

  const sinAlumnos = servicio(examenBase([publicacion(EC_A, 'slug-a', []), publicacion(EC_B, 'slug-b', [alumno('x', { email: '' }), alumno('y', { email: '   ' })])]));
  await assert.rejects(() => sinAlumnos.svc.invitar('ex-1'), (e: any) => e instanceof ConflictException && e.message === MENSAJE_SIN_ALUMNOS);
  assert.equal(sinAlumnos.mail.enviados.length, 0);
  assert.equal(sinAlumnos.svc.estado('ex-1').enCurso, false, 'tras el 409 se puede volver a intentar');

  // Ventana cerrada: no se invita (el mail diría "podés rendirlo hasta" una fecha pasada). Las vigentes sí.
  const cerrada = { fechaFin: new Date('2026-09-20T00:00:00Z') };
  const todasCerradas = servicio(examenBase([publicacion(EC_A, 'slug-a', alumnos(2), cerrada)]));
  await assert.rejects(() => todasCerradas.svc.invitar('ex-1'), (e: any) => e instanceof ConflictException && e.message === MENSAJE_VENTANA_CERRADA);
  await assert.rejects(() => todasCerradas.svc.invitar('ex-1', EC_A), ConflictException);

  const mezcla = servicio(examenBase([publicacion(EC_A, 'slug-a', alumnos(2), cerrada), publicacion(EC_B, 'slug-b', alumnos(2, 10))]));
  assert.deepEqual(await mezcla.svc.invitar('ex-1'), { aEnviar: 2 });
  await terminoElLote(mezcla.svc);
  assert.deepEqual(mezcla.mail.enviados.map((m: MailParaEnviar) => m.to).sort(), ['a10@mail.com', 'a11@mail.com']);
});

test('invitar: si falla la lectura de la base, el error sale tal cual y el examen no queda "en curso"', async () => {
  const { svc } = servicio(unaComision());
  (svc as any).prisma.examen.findUnique = async () => {
    throw new Error('se cayó la base');
  };
  await assert.rejects(() => svc.invitar('ex-1'), /se cayó la base/);
  assert.equal(svc.estado('ex-1').enCurso, false);
});

test('invitar: la Idempotency-Key es invitacion-<publicación>-<alumno>-<tanda>: igual en un doble clic, distinta en un reenvío más tarde', async () => {
  const { svc, mail } = servicio(unaComision(2));
  const claves = () => mail.enviados.map((m: MailParaEnviar) => m.idempotencyKey);
  const fmt = /^invitacion-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-al-a[12]-[0-9a-f]{8}$/;

  await svc.invitar('ex-1');
  await terminoElLote(svc);
  const primera = claves().slice();
  assert.ok(primera.every((k: string) => fmt.test(k)), primera.join(' | '));
  assert.notEqual(primera[0], primera[1], 'una clave por alumno');

  // Un segundo clic apenas termina el primero: misma tanda, mismas claves (Resend descarta los repetidos).
  svc.ahora = () => new Date(AHORA.getTime() + 60_000);
  await svc.invitar('ex-1');
  await terminoElLote(svc);
  assert.deepEqual(claves().slice(2).sort(), primera.slice().sort());

  // Un reenvío intencional media hora después: otra tanda, otras claves (no choca con la de las 24 h de Resend).
  svc.ahora = () => new Date(AHORA.getTime() + 30 * 60_000);
  await svc.invitar('ex-1');
  await terminoElLote(svc);
  const tardia = claves().slice(4);
  assert.ok(tardia.every((k: string) => fmt.test(k)));
  assert.ok(tardia.every((k: string) => !primera.includes(k)));
});

test('modo prueba: el mail va a EMAIL_REDIRECT_TO (no al alumno) y el asunto avisa a quién iba; el estado lo informa', async () => {
  // Con el MailService de verdad y un fetch falso: nunca se llama a Resend.
  const llamadas: any[] = [];
  const fetchFalso = (async (_url: unknown, init: any) => {
    llamadas.push(JSON.parse(init.body));
    return new Response('{"id":"abc"}', { status: 200 });
  }) as unknown as typeof fetch;
  const env: Record<string, string> = { RESEND_API_KEY: 're_SECRETA_abc', EMAIL_FROM: 'AI Teaching Assistant <notas@mail.ejemplo.com>', EMAIL_REDIRECT_TO: 'yo@prueba.com', FRONTEND_ORIGIN: 'https://app.ejemplo.com' };
  const mail = new MailService({ get: (k: string) => env[k] } as any, { fetch: fetchFalso, esperar: async () => undefined });
  const { svc } = servicio(unaComision(2), mail, env);

  assert.equal(svc.estado('ex-1').modoPrueba, 'yo@prueba.com');
  await svc.invitar('ex-1');
  await terminoElLote(svc);

  assert.equal(llamadas.length, 2);
  for (const c of llamadas) assert.deepEqual(c.to, ['yo@prueba.com']);
  assert.deepEqual(llamadas.map((c) => c.subject).sort(), [
    '[PRUEBA → a1@mail.com] Te invitaron a rendir "Parcial 1"',
    '[PRUEBA → a2@mail.com] Te invitaron a rendir "Parcial 1"',
  ]);
  assert.ok(llamadas.every((c) => c.reply_to === 'gomez@facu.edu.ar'));
  assert.equal(svc.estado('ex-1').enviados, 2);
});

test('con el MailService real, una cuota diaria agotada de Resend corta el lote de invitaciones', async () => {
  const llamadas: any[] = [];
  const fetchFalso = (async (_url: unknown, init: any) => {
    llamadas.push(init);
    return new Response(JSON.stringify({ name: 'daily_quota_exceeded', message: 'You have reached your daily email sending quota.' }), { status: 429 });
  }) as unknown as typeof fetch;
  const env: Record<string, string> = { RESEND_API_KEY: 're_SECRETA_abc', EMAIL_FROM: 'AI Teaching Assistant <notas@mail.ejemplo.com>' };
  const mail = new MailService({ get: (k: string) => env[k] } as any, { fetch: fetchFalso, esperar: async () => undefined });
  (mail as any).logger = loggerMudo();
  const { svc } = servicio(unaComision(10), mail, env);
  svc.enviosEnParalelo = 1;

  await svc.invitar('ex-1');
  await terminoElLote(svc);
  assert.equal(llamadas.length, 1, 'después de la cuota no se hace ningún pedido más');
  assert.equal(svc.estado('ex-1').ultimoError, MOTIVO_CUOTA);
  assert.equal(svc.estado('ex-1').conError, 1);
});

// ---------------------------------------------------------------------------
// 3. Controller: acceso al examen y sesión de docente
// ---------------------------------------------------------------------------
test('GET/POST /examenes/:id/invitaciones: chequean el acceso al examen ANTES de leer o mandar nada', async () => {
  const llamadas: string[] = [];
  const acceso = { examen: async (docenteId: string, examenId: string) => void llamadas.push(`acceso:${docenteId}:${examenId}`) };
  const invitaciones = {
    estado: (id: string) => (llamadas.push(`estado:${id}`), { total: 3 }),
    invitar: async (id: string, ec?: string) => (llamadas.push(`invitar:${id}:${ec}`), { aEnviar: 5 }),
  };
  const controller = new InvitacionesController(invitaciones as any, acceso as any);

  assert.deepEqual(await controller.estado('doc-1', 'ex-1'), { total: 3 });
  assert.deepEqual(await controller.invitar('doc-1', 'ex-1', {}), { aEnviar: 5 });
  assert.deepEqual(await controller.invitar('doc-1', 'ex-1', { examenComisionId: EC_B }), { aEnviar: 5 });
  assert.deepEqual(await controller.invitar('doc-1', 'ex-1', undefined), { aEnviar: 5 }, 'el body es opcional');
  assert.deepEqual(llamadas, [
    'acceso:doc-1:ex-1', 'estado:ex-1',
    'acceso:doc-1:ex-1', 'invitar:ex-1:undefined',
    'acceso:doc-1:ex-1', `invitar:ex-1:${EC_B}`,
    'acceso:doc-1:ex-1', 'invitar:ex-1:undefined',
  ]);

  // Un docente ajeno no ve ni dispara nada: el servicio ni se entera.
  acceso.examen = async () => {
    throw new ForbiddenException();
  };
  llamadas.length = 0;
  await assert.rejects(() => controller.estado('doc-2', 'ex-1'), ForbiddenException);
  await assert.rejects(() => controller.invitar('doc-2', 'ex-1', { examenComisionId: EC_B }), ForbiddenException);
  assert.deepEqual(llamadas, []);
});

test('rutas: GET y POST de examenes/:id/invitaciones, protegidas por sesión de docente (no son públicas)', () => {
  const { estado, invitar } = InvitacionesController.prototype;
  assert.equal(Reflect.getMetadata('path', InvitacionesController), 'examenes');
  assert.equal(Reflect.getMetadata('path', estado), ':id/invitaciones');
  assert.equal(Reflect.getMetadata('method', estado), RequestMethod.GET);
  assert.equal(Reflect.getMetadata('path', invitar), ':id/invitaciones');
  assert.equal(Reflect.getMetadata('method', invitar), RequestMethod.POST);
  for (const h of [estado, invitar]) {
    assert.ok(!Reflect.getMetadata(IS_PUBLIC_KEY, h) && !Reflect.getMetadata(IS_PUBLIC_KEY, InvitacionesController));
  }
});

test('sin sesión de docente: 401; con un token válido pasa y el docenteId sale del token (nunca del body)', async () => {
  const SUPABASE_URL = 'https://proyecto-test.supabase.co';
  const SECRETO = 's'.repeat(40);
  const verificador = new VerificadorSesion({ get: (k: string) => ({ SUPABASE_URL, SUPABASE_JWT_SECRET: SECRETO })[k] } as any);
  const guard = new AuthGuard(verificador, { resolver: async (claims: any) => `doc:${claims.sub}` } as any, new Reflector());
  const ctx = (handler: string, authorization?: string) => {
    const req: any = { headers: authorization ? { authorization } : {}, body: { docenteId: 'otro-docente' } };
    return {
      req,
      getHandler: () => (InvitacionesController.prototype as any)[handler],
      getClass: () => InvitacionesController,
      switchToHttp: () => ({ getRequest: () => req }),
    } as any;
  };
  const token = await new SignJWT({ email: 'doc@x.com', user_metadata: { email_verified: true } })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('user-1')
    .setIssuer(`${SUPABASE_URL}/auth/v1`)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRETO));

  for (const handler of ['estado', 'invitar']) {
    await assert.rejects(() => guard.canActivate(ctx(handler)), UnauthorizedException, handler);
    await assert.rejects(() => guard.canActivate(ctx(handler, 'Bearer basura')), UnauthorizedException, handler);
  }
  const c = ctx('invitar', `Bearer ${token}`);
  assert.equal(await guard.canActivate(c), true);
  assert.equal(c.req.docenteId, 'doc:user-1');
});

test('el body de POST /invitaciones es opcional: acepta {} o un examenComisionId UUID y rechaza cualquier otra cosa', async () => {
  // La misma ValidationPipe que usa main.ts.
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const validar = (body: unknown) => pipe.transform(body, { type: 'body', metatype: InvitarAlumnosDto });

  assert.deepEqual({ ...(await validar({})) }, {});
  assert.equal((await validar({ examenComisionId: EC_A })).examenComisionId, EC_A);
  await assert.rejects(() => validar({ examenComisionId: 'no-es-uuid' }));
  await assert.rejects(() => validar({ examenComisionId: 5 }));
  await assert.rejects(() => validar({ comisionId: EC_A }), undefined, 'campos que no existen se rechazan');
});
