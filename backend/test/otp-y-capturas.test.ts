// Código de acceso (OTP), sesión única, seguimiento de origen, saltos de texto, latido y capturas de pantalla.
// Corre sin base de datos ni red: el prisma, el mail y el almacenamiento son falsos en memoria.
//   node --require ts-node/register --test test/otp-y-capturas.test.ts   (o `npm test`)
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CodigosAccesoService,
  ESPERA_ENTRE_CODIGOS_MS,
  MAX_CODIGOS_10MIN_POR_EMAIL,
  MAX_INTENTOS_POR_CODIGO,
  emailEnDominio,
  generarCodigo,
  hashCodigo,
  normalizarDominio,
} from '../src/respuestas-examen/codigos-acceso.service';
import { armarMailCodigo } from '../src/mail/mail-codigo.util';
import { IntentosService, SALTO_MIN_CARACTERES, saltosDeTexto } from '../src/respuestas-examen/intentos.service';
import {
  ESPERA_CAPTURA_MS,
  HUECO_LATIDO_MS,
  IntegridadService,
  MAX_CAPTURAS_DE_EVENTO,
  MAX_CAPTURAS_POR_INTENTO,
  MAX_EVENTOS_POR_INTENTO,
  decodificarJpeg,
  generarMarca,
} from '../src/respuestas-examen/integridad.service';
import { AlmacenCapturasLocal, AlmacenCapturasSupabase } from '../src/respuestas-examen/almacen-capturas';
import { AlmacenFallosMemoria } from '../src/respuestas-examen/limitador-intentos.util';
import { CapturaDto, EventoIntegridadDto, IniciarIntentoDto } from '../src/respuestas-examen/dto/intento.dto';
import { PublicarComisionDto } from '../src/examenes/dto/publicar-comision.dto';

const SECRETO = 'x'.repeat(40);
const PUB = { id: 'pub-1', accesoAbierto: false, comisionId: 'com-1', dominioPermitido: null as string | null, examen: { titulo: 'Parcial 1' }, comision: { nombre: 'Comisión A' } };
const ANTICHEAT = { pantallaCompleta: true, cambioPestana: true, pegado: true, pantallaCompartida: true };
const JPEG = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7)]).toString('base64');

// ---------------------------------------------------------------------------------------------------------------- helpers puros
test('generarCodigo: siempre 6 dígitos (con ceros a la izquierda) y no se repite siempre el mismo', () => {
  const codigos = new Set(Array.from({ length: 200 }, generarCodigo));
  for (const c of codigos) assert.match(c, /^\d{6}$/);
  assert.ok(codigos.size > 150);
});

test('hashCodigo: depende del secreto, de la publicación, del mail y del código; el mail no distingue mayúsculas', () => {
  const base = hashCodigo(SECRETO, 'pub-1', 'ana@mail.com', '123456');
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(hashCodigo(SECRETO, 'pub-1', 'ANA@mail.com', '123456'), base);
  for (const otro of [hashCodigo('y'.repeat(40), 'pub-1', 'ana@mail.com', '123456'), hashCodigo(SECRETO, 'pub-2', 'ana@mail.com', '123456'), hashCodigo(SECRETO, 'pub-1', 'luis@mail.com', '123456'), hashCodigo(SECRETO, 'pub-1', 'ana@mail.com', '123457')]) {
    assert.notEqual(otro, base);
  }
});

test('dominio permitido: normaliza, acepta subdominios y rechaza parecidos', () => {
  assert.equal(normalizarDominio(' @Alumnos.Edu.AR '), 'alumnos.edu.ar');
  assert.equal(normalizarDominio('   '), null);
  assert.equal(normalizarDominio(null), null);
  assert.equal(emailEnDominio('ana@alumnos.edu.ar', 'alumnos.edu.ar'), true);
  assert.equal(emailEnDominio('ANA@Alumnos.Edu.Ar', '@alumnos.edu.ar'), true);
  assert.equal(emailEnDominio('ana@mail.alumnos.edu.ar', 'alumnos.edu.ar'), true, 'un subdominio del dominio vale');
  assert.equal(emailEnDominio('ana@evilalumnos.edu.ar', 'alumnos.edu.ar'), false, 'un dominio que solo termina parecido no vale');
  assert.equal(emailEnDominio('ana@alumnos.edu.ar.evil.com', 'alumnos.edu.ar'), false);
  assert.equal(emailEnDominio('ana@gmail.com', 'alumnos.edu.ar'), false);
  assert.equal(emailEnDominio('ana@gmail.com', null), true, 'sin dominio configurado entra cualquiera');
});

test('armarMailCodigo: el código va en el asunto, el texto y el HTML, y lo que viene del docente se escapa', () => {
  const m = armarMailCodigo({ codigo: '048213', tituloExamen: 'Parcial <b>1</b>', nombreComision: 'A & B', validezMinutos: 10 });
  assert.ok(m.subject.includes('048213'));
  assert.ok(m.text.includes('048213') && m.text.includes('10 minutos'));
  assert.ok(m.html.includes('048213'));
  assert.ok(!m.html.includes('<b>1</b>'), 'el título no se mete tal cual en el HTML');
  assert.ok(m.html.includes('&lt;b&gt;'));
});

test('saltosDeTexto: solo marca lo que crece mucho y más rápido de lo que se tipea', () => {
  const grande = 'x'.repeat(SALTO_MIN_CARACTERES + 500);
  assert.deepEqual(saltosDeTexto({ p1: '' }, { p1: grande }, 3000), [{ preguntaId: 'p1', caracteres: grande.length }]);
  assert.deepEqual(saltosDeTexto({}, { p1: grande }, 3000).length, 1, 'una respuesta nueva cuenta desde cero');
  assert.deepEqual(saltosDeTexto({ p1: '' }, { p1: grande }, 10 * 60_000), [], 'si pasó mucho tiempo (corte de internet, retomar) no es un salto');
  assert.deepEqual(saltosDeTexto({ p1: 'a'.repeat(100) }, { p1: 'a'.repeat(160) }, 2000), [], 'escribir 60 caracteres en 2 s es tipear');
  assert.deepEqual(saltosDeTexto({}, { p1: ['a', 'b'], p2: 5, p3: null }, 1000), [], 'solo cuentan las respuestas de texto');
  assert.deepEqual(saltosDeTexto({ p1: grande }, { p1: grande }, 1000), [], 'lo que no cambió no cuenta');
});

test('decodificarJpeg: acepta un JPEG y rechaza lo demás', () => {
  assert.ok(decodificarJpeg(JPEG).length > 200);
  assert.throws(() => decodificarJpeg('data:image/png;base64,AAAA'), /JPEG/);
  assert.throws(() => decodificarJpeg('data:image/jpeg;base64,' + Buffer.alloc(500, 1).toString('base64')), /no es una imagen válida/);
  assert.throws(() => decodificarJpeg('data:image/jpeg;base64,AAAA'), /no es una imagen válida/);
  const enorme = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(400_000, 1)]).toString('base64');
  assert.throws(() => decodificarJpeg(enorme), /demasiado grande/);
});

test('generarMarca: 4 caracteres legibles (sin 0, O, 1, I)', () => {
  for (let i = 0; i < 100; i++) assert.match(generarMarca(), /^[A-HJ-NP-Z2-9]{4}$/);
});

// ---------------------------------------------------------------------------------------------------------------- DTOs
test('DTOs: el código tiene 6 dígitos, los eventos del cliente son una lista cerrada y el dominio se valida', async () => {
  const ini = (o: object) => plainToInstance(IniciarIntentoDto, o);
  assert.equal((await validate(ini({ alumnoEmail: 'ana@mail.com', codigo: '123456' }))).length, 0);
  assert.equal((await validate(ini({ alumnoEmail: 'ana@mail.com', codigo: '123 456' }))).length, 0, 'se toleran espacios al pegar');
  assert.ok((await validate(ini({ alumnoEmail: 'ana@mail.com', codigo: '12345' }))).length > 0);
  assert.ok((await validate(ini({ alumnoEmail: 'ana@mail.com', codigo: 'abcdef' }))).length > 0);
  const ev = (tipo: string) => plainToInstance(EventoIntegridadDto, { tipo });
  assert.equal((await validate(ev('monitor_extendido'))).length, 0);
  for (const servidor of ['salto_de_texto', 'cambio_de_origen', 'captura_omitida', 'latido_perdido']) {
    assert.ok((await validate(ev(servidor))).length > 0, `el cliente no puede mandar ${servidor}`);
  }
  const pub = (o: object) => plainToInstance(PublicarComisionDto, { comisionId: randomUUID(), ...o });
  assert.equal((await validate(pub({ verificarEmail: true, dominioPermitido: '@Alumnos.Edu.AR' }))).length, 0);
  assert.equal(pub({ dominioPermitido: ' @Alumnos.Edu.AR ' }).dominioPermitido, 'alumnos.edu.ar');
  assert.ok((await validate(pub({ dominioPermitido: 'no es un dominio' }))).length > 0);
  assert.ok((await validate(pub({ dominioPermitido: 'x.com; drop table' }))).length > 0);
  const cap = (o: object) => plainToInstance(CapturaDto, { motivo: 'muestreo', imagen: JPEG, ...o });
  assert.equal((await validate(cap({}))).length, 0);
  assert.ok((await validate(cap({ motivo: 'inventado' }))).length > 0);
  assert.ok((await validate(cap({ pedidoId: 'no-uuid' }))).length > 0);
});

// ---------------------------------------------------------------------------------------------------------------- CodigosAccesoService
function servicioDeCodigos(opciones: { alumnos?: { email: string }[]; mailFalla?: boolean; mailConfigurado?: boolean } = {}) {
  const codigos: any[] = [];
  const fallos: { clave: string; ocurridoEn: Date }[] = [];
  const enviados: any[] = [];
  const cumple = (c: any, where: any) =>
    Object.entries(where).every(([k, v]: [string, any]) => {
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('gte' in v) return c[k] >= v.gte;
        if ('gt' in v) return c[k] > v.gt;
        if ('lt' in v) return c[k] < v.lt;
        return true;
      }
      return c[k] === v;
    });
  const prisma: any = {
    codigoAcceso: {
      count: async ({ where }: any) => codigos.filter((c) => cumple(c, where)).length,
      findFirst: async ({ where, orderBy }: any) => {
        const l = codigos.filter((c) => cumple(c, where));
        return (orderBy ? l.sort((a, b) => b.createdAt - a.createdAt) : l)[0] ?? null;
      },
      create: async ({ data }: any) => {
        const c = { id: `c${codigos.length}`, intentos: 0, consumidoEn: null, createdAt: new Date(), ...data };
        codigos.push(c);
        return c;
      },
      update: async ({ where, data }: any) => {
        const c = codigos.find((x) => x.id === where.id);
        if (data.intentos?.increment) c.intentos += data.intentos.increment;
        return c;
      },
      updateMany: async ({ where, data }: any) => {
        const l = codigos.filter((c) => c.id === where.id && c.consumidoEn === where.consumidoEn);
        l.forEach((c) => Object.assign(c, data));
        return { count: l.length };
      },
      delete: async ({ where }: any) => void codigos.splice(codigos.findIndex((c) => c.id === where.id), 1),
    },
    alumno: { findFirst: async ({ where }: any) => (opciones.alumnos ?? []).find((a) => a.email.toLowerCase() === where.email.equals.toLowerCase()) ?? null },
    falloAcceso: {
      count: async ({ where }: any) => fallos.filter((f) => f.clave === where.clave && f.ocurridoEn >= where.ocurridoEn.gte).length,
      create: async ({ data }: any) => void fallos.push(data),
      deleteMany: async ({ where }: any) => void fallos.splice(0, fallos.length, ...fallos.filter((f) => f.clave !== where.clave)),
    },
  };
  const mail: any = {
    configurado: opciones.mailConfigurado ?? true,
    enviar: async (m: any) => {
      enviados.push(m);
      return opciones.mailFalla ? { ok: false, motivo: 'caído' } : { ok: true };
    },
  };
  const svc = new CodigosAccesoService(prisma, mail, { get: (k: string) => (k === 'JWT_SECRET' ? SECRETO : undefined) } as any);
  const envejecer = (ms: number) => codigos.forEach((c) => (c.createdAt = new Date(c.createdAt.getTime() - ms)));
  const codigoEnviado = () => enviados[enviados.length - 1]?.text.match(/\d{6}/)?.[0] as string;
  return { svc, codigos, enviados, envejecer, codigoEnviado, fallos };
}

test('solicitar: manda el código al mail de un alumno de la lista y guarda solo su HMAC', async () => {
  const { svc, codigos, enviados, codigoEnviado } = servicioDeCodigos({ alumnos: [{ email: 'Ana@Mail.com' }] });
  await svc.solicitar(PUB, 'ana@mail.com', '1.1.1.1');
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].to, 'ana@mail.com');
  assert.equal(codigos.length, 1);
  assert.ok(!JSON.stringify(codigos[0]).includes(codigoEnviado()), 'el código en claro no se guarda');
  assert.equal(codigos[0].codigoHash, hashCodigo(SECRETO, PUB.id, 'ana@mail.com', codigoEnviado()));
});

test('solicitar: un mail que no está en la lista no recibe nada, pero la respuesta es la misma y queda anotado', async () => {
  const { svc, codigos, enviados } = servicioDeCodigos({ alumnos: [{ email: 'ana@mail.com' }] });
  await svc.solicitar(PUB, 'otro@mail.com', '1.1.1.1'); // no tira: no revela quién cursa
  assert.equal(enviados.length, 0);
  assert.equal(codigos.length, 1, 'se anota igual: así el límite frena el sondeo de mails');
});

test('solicitar: con acceso abierto se manda a cualquier mail; con dominio, solo a los de ese dominio (y eso sí se le dice)', async () => {
  const { svc, enviados } = servicioDeCodigos();
  await svc.solicitar({ ...PUB, accesoAbierto: true }, 'nuevo@mail.com', '1.1.1.1');
  assert.equal(enviados.length, 1);
  const conDominio = { ...PUB, accesoAbierto: true, dominioPermitido: 'alumnos.edu.ar' };
  await assert.rejects(() => svc.solicitar(conDominio, 'nuevo@gmail.com', '1.1.1.1'), /@alumnos\.edu\.ar/);
  assert.equal(enviados.length, 1);
  await svc.solicitar(conDominio, 'nuevo@alumnos.edu.ar', '1.1.1.2');
  assert.equal(enviados.length, 2);
});

test('solicitar: espera de un minuto entre códigos, y tope de códigos por mail', async () => {
  const { svc, envejecer } = servicioDeCodigos({ alumnos: [{ email: 'ana@mail.com' }] });
  await svc.solicitar(PUB, 'ana@mail.com', '1.1.1.1');
  await assert.rejects(() => svc.solicitar(PUB, 'ana@mail.com', '1.1.1.1'), /Esperá un minuto/);
  for (let i = 1; i < MAX_CODIGOS_10MIN_POR_EMAIL; i++) {
    envejecer(ESPERA_ENTRE_CODIGOS_MS + 1000);
    await svc.solicitar(PUB, 'ana@mail.com', '1.1.1.1');
  }
  envejecer(ESPERA_ENTRE_CODIGOS_MS + 1000);
  await assert.rejects(() => svc.solicitar(PUB, 'ana@mail.com', '1.1.1.1'), /demasiados códigos/);
});

test('solicitar: si el mail no se puede mandar avisa (503) y no deja un código huérfano', async () => {
  const { svc, codigos } = servicioDeCodigos({ alumnos: [{ email: 'ana@mail.com' }], mailFalla: true });
  await assert.rejects(() => svc.solicitar(PUB, 'ana@mail.com', '1.1.1.1'), /No pudimos enviarte el código/);
  assert.equal(codigos.length, 0);
});

test('solicitar: sin Resend configurado (desarrollo) no manda mail: el código queda en el log del servidor', async () => {
  const { svc, enviados, codigos } = servicioDeCodigos({ alumnos: [{ email: 'ana@mail.com' }], mailConfigurado: false });
  await svc.solicitar(PUB, 'ana@mail.com', '1.1.1.1');
  assert.equal(enviados.length, 0);
  assert.equal(codigos.length, 1);
});

test('consumir: el código correcto sirve una sola vez', async () => {
  const { svc, codigoEnviado } = servicioDeCodigos({ alumnos: [{ email: 'ana@mail.com' }] });
  await svc.solicitar(PUB, 'ana@mail.com', '1.1.1.1');
  const c = codigoEnviado();
  await svc.consumir(PUB, 'ana@mail.com', c, '1.1.1.1');
  await assert.rejects(() => svc.consumir(PUB, 'ana@mail.com', c, '1.1.1.1'), /incorrecto o venció/);
});

test('consumir: código equivocado, de otro mail, de otra publicación o ausente responden lo mismo (401)', async () => {
  const { svc, codigoEnviado } = servicioDeCodigos({ alumnos: [{ email: 'ana@mail.com' }, { email: 'luis@mail.com' }] });
  await svc.solicitar(PUB, 'ana@mail.com', '1.1.1.1');
  const c = codigoEnviado();
  const mal = c === '000000' ? '111111' : '000000';
  for (const intento of [() => svc.consumir(PUB, 'ana@mail.com', mal, 'ip'), () => svc.consumir(PUB, 'luis@mail.com', c, 'ip'), () => svc.consumir({ id: 'otra' }, 'ana@mail.com', c, 'ip'), () => svc.consumir(PUB, 'ana@mail.com', undefined, 'ip')]) {
    await assert.rejects(intento, (e: any) => e.getStatus?.() === 401 && /incorrecto o venció/.test(e.message));
  }
  await svc.consumir(PUB, 'ana@mail.com', c, 'ip'); // el código bueno sigue valiendo después de los intentos fallidos (mientras queden)
});

test('consumir: un código vencido no sirve', async () => {
  const { svc, codigoEnviado, codigos } = servicioDeCodigos({ alumnos: [{ email: 'ana@mail.com' }] });
  await svc.solicitar(PUB, 'ana@mail.com', '1.1.1.1');
  codigos[0].expiraEn = new Date(Date.now() - 1000);
  await assert.rejects(() => svc.consumir(PUB, 'ana@mail.com', codigoEnviado(), 'ip'), /incorrecto o venció/);
});

test('consumir: tras demasiados intentos con un código, ese código muere aunque después se acierte', async () => {
  const { svc, codigoEnviado } = servicioDeCodigos({ alumnos: [{ email: 'ana@mail.com' }] });
  await svc.solicitar(PUB, 'ana@mail.com', '1.1.1.1');
  const c = codigoEnviado();
  const mal = c === '000000' ? '111111' : '000000';
  for (let i = 0; i < MAX_INTENTOS_POR_CODIGO; i++) await assert.rejects(() => svc.consumir(PUB, 'ana@mail.com', mal, 'ip'));
  await assert.rejects(() => svc.consumir(PUB, 'ana@mail.com', c, 'ip'), /incorrecto o venció/);
});

test('consumir: los fallos acumulados por mail frenan la fuerza bruta (429) aunque se pidan códigos nuevos', async () => {
  const { svc, envejecer } = servicioDeCodigos({ alumnos: [{ email: 'ana@mail.com' }] });
  const respuestas: number[] = [];
  for (let i = 0; i < 16; i++) {
    if (i % 4 === 0) {
      envejecer(ESPERA_ENTRE_CODIGOS_MS + 1000);
      await svc.solicitar(PUB, 'ana@mail.com', '1.1.1.1').catch(() => undefined);
    }
    await svc.consumir(PUB, 'ana@mail.com', '999999', 'ip').catch((e: any) => respuestas.push(e.getStatus()));
  }
  assert.ok(respuestas.includes(429), `se corta con 429: ${respuestas.join(',')}`);
});

test('consumir: los fallos de un aula entera detrás de la misma IP no se bloquean entre sí', async () => {
  const { svc } = servicioDeCodigos({ alumnos: [] });
  const estados = new Set<number>();
  for (let i = 0; i < 40; i++) await svc.consumir(PUB, `alumno${i}@mail.com`, '999999', 'misma-ip').catch((e: any) => estados.add(e.getStatus()));
  assert.deepEqual([...estados], [401], 'cada uno recibe su 401; ninguno recibe un 429 por culpa de los demás');
});

// ---------------------------------------------------------------------------------------------------------------- IntegridadService
function servicioDeIntegridad() {
  const intentos = new Map<string, any>();
  const eventos: any[] = [];
  const capturas: any[] = [];
  const guardadas = new Map<string, Buffer>();
  const cumple = (c: any, where: any) =>
    Object.entries(where).every(([k, v]: [string, any]) => {
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('gte' in v) return c[k] >= v.gte;
        if ('lt' in v) return c[k] < v.lt;
        if ('not' in v) return c[k] !== v.not;
        return true;
      }
      return c[k] === v;
    });
  const prisma: any = {
    intentoExamen: { update: async ({ where, data }: any) => Object.assign(intentos.get(where.id), data) },
    eventoIntegridad: {
      count: async ({ where }: any) => eventos.filter((e) => cumple(e, where)).length,
      createMany: async ({ data }: any) => void eventos.push(...data.map((d: any) => ({ ocurridoEn: new Date(), ...d }))),
    },
    capturaIntegridad: {
      count: async ({ where }: any) => capturas.filter((c) => cumple(c, where)).length,
      create: async ({ data }: any) => void capturas.push({ id: `cap${capturas.length}`, ...data }),
      findMany: async ({ where, take }: any) => capturas.filter((c) => cumple(c, where)).slice(0, take),
      delete: async ({ where }: any) => void capturas.splice(capturas.findIndex((c) => c.id === where.id), 1),
    },
  };
  const almacen: any = {
    guardar: async (r: string, d: Buffer) => void guardadas.set(r, d),
    leer: async (r: string) => guardadas.get(r) ?? null,
    borrar: async (r: string) => void guardadas.delete(r),
  };
  const svc = new IntegridadService(prisma, { get: () => undefined } as any, almacen);
  const nuevoIntento = (o: object = {}) => {
    const i = { id: 'i1', ultimoLatidoEn: null, proximaCapturaEn: null, capturaPedidaId: null, capturaPedidaEn: null, marcaActual: null, marcaAnterior: null, ...o };
    intentos.set(i.id, i);
    return i;
  };
  return { svc, intentos, eventos, capturas, guardadas, nuevoIntento };
}
const LATIDO = { foco: true, visible: true, compartiendo: true };
const ahora = new Date('2026-10-28T12:00:00Z');
const en = (ms: number) => new Date(ahora.getTime() + ms);

test('latido: rota la marca (la anterior sigue valiendo) y programa la primera captura entre 4 y 10 minutos', async () => {
  const { svc, nuevoIntento, intentos } = servicioDeIntegridad();
  const i = nuevoIntento();
  const r1 = await svc.latido(i, ANTICHEAT, LATIDO, ahora);
  assert.match(r1.marca, /^[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(r1.capturaPedida, null);
  const espera = intentos.get('i1').proximaCapturaEn.getTime() - ahora.getTime();
  assert.ok(espera >= 4 * 60_000 && espera <= 10 * 60_000, `programada a ${espera / 60_000} min`);
  const r2 = await svc.latido(intentos.get('i1'), ANTICHEAT, LATIDO, en(15_000));
  assert.equal(intentos.get('i1').marcaAnterior, r1.marca);
  assert.equal(intentos.get('i1').marcaActual, r2.marca);
});

test('latido: al vencer la hora el servidor pide una captura, y sigue pidiendo la misma hasta que llegue', async () => {
  const { svc, nuevoIntento, intentos } = servicioDeIntegridad();
  const i = nuevoIntento({ proximaCapturaEn: en(-1000) });
  const r1 = await svc.latido(i, ANTICHEAT, LATIDO, ahora);
  assert.ok(r1.capturaPedida?.id);
  const r2 = await svc.latido(intentos.get('i1'), ANTICHEAT, LATIDO, en(15_000));
  assert.equal(r2.capturaPedida?.id, r1.capturaPedida.id, 'mientras no llegue, el pedido sigue en pie (por si falló la red)');
});

test('latido: si el cliente ignora el pedido, queda captura_omitida y se reprograma', async () => {
  const { svc, nuevoIntento, intentos, eventos } = servicioDeIntegridad();
  const i = nuevoIntento({ proximaCapturaEn: en(-1000), capturaPedidaId: randomUUID(), capturaPedidaEn: ahora });
  const r = await svc.latido(i, ANTICHEAT, LATIDO, en(ESPERA_CAPTURA_MS + 1000));
  assert.equal(r.capturaPedida, null);
  assert.deepEqual(eventos.map((e) => e.tipo), ['captura_omitida']);
  assert.equal(intentos.get('i1').capturaPedidaId, null);
  assert.ok(intentos.get('i1').proximaCapturaEn.getTime() > ahora.getTime() + ESPERA_CAPTURA_MS);
});

test('latido: un hueco sin señales queda anotado, y un latido sin foco cuenta como cambio de pestaña (sin duplicar)', async () => {
  const { svc, nuevoIntento, intentos, eventos } = servicioDeIntegridad();
  const i = nuevoIntento({ ultimoLatidoEn: ahora });
  await svc.latido(i, ANTICHEAT, LATIDO, en(HUECO_LATIDO_MS + 5000));
  assert.deepEqual(eventos.map((e) => e.tipo), ['latido_perdido']);
  await svc.latido(intentos.get('i1'), ANTICHEAT, { ...LATIDO, foco: false }, en(HUECO_LATIDO_MS + 20_000));
  assert.equal(eventos.filter((e) => e.tipo === 'cambio_pestana').length, 1);
  await svc.latido(intentos.get('i1'), ANTICHEAT, { ...LATIDO, foco: false }, en(HUECO_LATIDO_MS + 30_000));
  assert.equal(eventos.filter((e) => e.tipo === 'cambio_pestana').length, 1, 'dentro de los 20 s no se anota otro');
});

test('latido: sin pantalla compartida en el examen no pide capturas; sin anti-cheat no anota nada', async () => {
  const { svc, nuevoIntento, eventos } = servicioDeIntegridad();
  const r = await svc.latido(nuevoIntento({ proximaCapturaEn: en(-1000), ultimoLatidoEn: en(-3_600_000) }), { ...ANTICHEAT, pantallaCompartida: false }, { ...LATIDO, foco: false }, ahora);
  assert.equal(r.capturaPedida, null);
  const sin = await svc.latido(nuevoIntento({ id: 'i2', ultimoLatidoEn: en(-3_600_000) }), null, { ...LATIDO, foco: false }, ahora);
  assert.equal(sin.capturaPedida, null);
  assert.equal(eventos.filter((e) => e.intentoId === 'i2').length, 0, 'sin consentimiento no se anota conducta');
});

test('anotar: respeta el tope de eventos por intento', async () => {
  const { svc, eventos } = servicioDeIntegridad();
  await svc.anotar('i1', Array.from({ length: MAX_EVENTOS_POR_INTENTO + 50 }, () => ({ tipo: 'salto_de_texto' as const })));
  assert.equal(eventos.length, MAX_EVENTOS_POR_INTENTO);
  await svc.anotar('i1', [{ tipo: 'salto_de_texto' }]);
  assert.equal(eventos.length, MAX_EVENTOS_POR_INTENTO);
});

test('captura de muestreo: solo se acepta la que el servidor pidió, una sola vez, y se valida la marca', async () => {
  const { svc, nuevoIntento, intentos, capturas, guardadas } = servicioDeIntegridad();
  const pedido = randomUUID();
  const i = nuevoIntento({ capturaPedidaId: pedido, capturaPedidaEn: ahora, marcaActual: 'ABCD', marcaAnterior: 'WXYZ' });
  assert.deepEqual(await svc.registrarCaptura(i, ANTICHEAT, { motivo: 'muestreo', imagen: JPEG } as CapturaDto, ahora), { registrada: false, motivo: 'sin_pedido' });
  assert.deepEqual(await svc.registrarCaptura(i, ANTICHEAT, { motivo: 'muestreo', pedidoId: randomUUID(), imagen: JPEG } as CapturaDto, ahora), { registrada: false, motivo: 'sin_pedido' });
  assert.deepEqual(await svc.registrarCaptura(i, ANTICHEAT, { motivo: 'muestreo', pedidoId: pedido, marca: 'WXYZ', imagen: JPEG } as CapturaDto, ahora), { registrada: true });
  assert.equal(capturas[0].marcaValida, true, 'la marca anterior también vale');
  assert.equal(guardadas.size, 1);
  assert.match([...guardadas.keys()][0], /^i1\/[0-9a-f-]{36}\.jpg$/);
  assert.equal(intentos.get('i1').capturaPedidaId, null, 'el pedido se consume');
  assert.equal((await svc.registrarCaptura(intentos.get('i1'), ANTICHEAT, { motivo: 'muestreo', pedidoId: pedido, imagen: JPEG } as CapturaDto, ahora)).registrada, false);
  const retencion = capturas[0].eliminarEn.getTime() - ahora.getTime();
  assert.equal(retencion, 7 * 24 * 3600_000, 'por defecto se borran a los 7 días');
});

test('captura: una marca que no coincide se guarda pero queda marcada como no válida', async () => {
  const { svc, nuevoIntento, capturas } = servicioDeIntegridad();
  const i = nuevoIntento({ marcaActual: 'ABCD', marcaAnterior: null });
  await svc.registrarCaptura(i, ANTICHEAT, { motivo: 'cambio_pestana', marca: 'ZZZZ', imagen: JPEG } as CapturaDto, ahora);
  await svc.registrarCaptura(i, ANTICHEAT, { motivo: 'salida_pantalla_completa', imagen: JPEG } as CapturaDto, ahora);
  assert.deepEqual(capturas.map((c) => c.marcaValida), [false, false]);
});

test('captura: solo con pantalla compartida activa, y no más de dos por evento cada 20 s', async () => {
  const { svc, nuevoIntento, capturas } = servicioDeIntegridad();
  const i = nuevoIntento({ marcaActual: 'ABCD' });
  assert.deepEqual(await svc.registrarCaptura(i, { ...ANTICHEAT, pantallaCompartida: false }, { motivo: 'cambio_pestana', imagen: JPEG } as CapturaDto, ahora), { registrada: false, motivo: 'no_activo' });
  assert.deepEqual(await svc.registrarCaptura(i, null, { motivo: 'cambio_pestana', imagen: JPEG } as CapturaDto, ahora), { registrada: false, motivo: 'no_activo' });
  const eventoDto = { motivo: 'cambio_pestana', imagen: JPEG } as CapturaDto;
  const r = [];
  for (let k = 0; k < 4; k++) r.push((await svc.registrarCaptura(i, ANTICHEAT, eventoDto, en(k * 1000))).registrada);
  assert.deepEqual(r, [true, true, false, false]);
  assert.equal((await svc.registrarCaptura(i, ANTICHEAT, eventoDto, en(25_000))).registrada, true, 'pasada la ventana vuelve a aceptar');
  assert.equal(capturas.length, 3);
});

test('captura: provocar eventos no llena el cupo; el resto queda reservado para el muestreo; hay un tope total', async () => {
  const { svc, nuevoIntento, capturas } = servicioDeIntegridad();
  const pedido = randomUUID();
  const i = nuevoIntento({ capturaPedidaId: pedido, capturaPedidaEn: ahora });
  for (let k = 0; k < MAX_CAPTURAS_DE_EVENTO; k++) capturas.push({ id: `e${k}`, intentoId: 'i1', motivo: 'cambio_pestana', ocurridoEn: en(-3_600_000) });
  assert.deepEqual(await svc.registrarCaptura(i, ANTICHEAT, { motivo: 'cambio_pestana', imagen: JPEG } as CapturaDto, ahora), { registrada: false, motivo: 'tope_eventos' });
  assert.equal((await svc.registrarCaptura(i, ANTICHEAT, { motivo: 'muestreo', pedidoId: pedido, imagen: JPEG } as CapturaDto, ahora)).registrada, true, 'el muestreo sigue entrando');
  for (let k = capturas.length; k < MAX_CAPTURAS_POR_INTENTO; k++) capturas.push({ id: `x${k}`, intentoId: 'i1', motivo: 'muestreo', ocurridoEn: en(-3_600_000) });
  assert.deepEqual(await svc.registrarCaptura(i, ANTICHEAT, { motivo: 'cambio_pestana', imagen: JPEG } as CapturaDto, ahora), { registrada: false, motivo: 'tope' });
});

test('purgarVencidas: borra imagen y fila de lo que ya cumplió su retención', async () => {
  const { svc, capturas, guardadas } = servicioDeIntegridad();
  guardadas.set('a', Buffer.from('x'));
  guardadas.set('b', Buffer.from('y'));
  capturas.push({ id: 'viejo', ruta: 'a', eliminarEn: new Date(Date.now() - 1000) }, { id: 'nuevo', ruta: 'b', eliminarEn: new Date(Date.now() + 1e9) });
  assert.equal(await svc.purgarVencidas(), 1);
  assert.deepEqual(capturas.map((c) => c.id), ['nuevo']);
  assert.deepEqual([...guardadas.keys()], ['b']);
});

// ---------------------------------------------------------------------------------------------------------------- almacenamiento
test('AlmacenCapturasLocal: guarda, lee y borra; rechaza rutas que no sean <uuid>/<uuid>.jpg (no hay path traversal)', async () => {
  const almacen = new AlmacenCapturasLocal(mkdtempSync(join(tmpdir(), 'caps-')));
  const ruta = `${randomUUID()}/${randomUUID()}.jpg`;
  await almacen.guardar(ruta, Buffer.from('hola'));
  assert.equal((await almacen.leer(ruta))?.toString(), 'hola');
  await almacen.borrar(ruta);
  assert.equal(await almacen.leer(ruta), null);
  for (const mala of ['../../etc/passwd', '/etc/passwd', `${randomUUID()}/../${randomUUID()}.jpg`, 'a/b.jpg', `${randomUUID()}/${randomUUID()}.png`]) {
    await assert.rejects(() => almacen.guardar(mala, Buffer.from('x')), /inválida/);
    await assert.rejects(() => almacen.leer(mala), /inválida/);
  }
});

test('AlmacenCapturasSupabase: usa la clave de servicio, el bucket privado "capturas" y la ruta pedida', async () => {
  const llamadas: any[] = [];
  const fetchFalso = (async (url: string, init: any) => {
    llamadas.push({ url, init });
    return init?.method === 'DELETE' ? { ok: true, status: 200 } : { ok: true, status: 200, arrayBuffer: async () => Buffer.from('img') };
  }) as any;
  const almacen = new AlmacenCapturasSupabase('https://p.supabase.co/', 'CLAVE-DE-SERVICIO', fetchFalso);
  const ruta = `${randomUUID()}/${randomUUID()}.jpg`;
  await almacen.guardar(ruta, Buffer.from('img'));
  assert.equal(llamadas[0].url, `https://p.supabase.co/storage/v1/object/capturas/${ruta}`);
  assert.equal(llamadas[0].init.method, 'POST');
  assert.equal(llamadas[0].init.headers.Authorization, 'Bearer CLAVE-DE-SERVICIO');
  assert.equal(llamadas[0].init.headers['Content-Type'], 'image/jpeg');
  assert.equal((await almacen.leer(ruta))?.toString(), 'img');
  assert.equal(llamadas[1].url, `https://p.supabase.co/storage/v1/object/authenticated/capturas/${ruta}`);
  await almacen.borrar(ruta);
  assert.equal(llamadas[2].init.method, 'DELETE');
  await assert.rejects(() => almacen.guardar('../x', Buffer.from('x')), /inválida/);
  const fallaGuardar = new AlmacenCapturasSupabase('https://p.supabase.co', 'K', (async () => ({ ok: false, status: 500 })) as any);
  await assert.rejects(() => fallaGuardar.guardar(ruta, Buffer.from('x')), /500/);
});

// ---------------------------------------------------------------------------------------------------------------- IntentosService: sesión única y origen
const jwt = new JwtService({ secret: SECRETO });
function intentosConIntento(intento: any, ec: any = {}) {
  const eventos: any[] = [];
  const actualizaciones: any[] = [];
  const prisma: any = {
    examenComision: { findUnique: async () => ({ examenId: 'ex-1', comisionId: 'com-1', verificarEmail: true, examen: { antiCheat: ANTICHEAT }, comision: {}, ...ec }) },
    intentoExamen: {
      findUnique: async () => ({ examenId: 'ex-1', alumno: { comisionId: 'com-1' }, ...intento }),
      update: async ({ data }: any) => void actualizaciones.push(data),
    },
  };
  const integridad: any = { anotar: async (_id: string, e: any[]) => void eventos.push(...e) };
  const svc = new IntentosService(prisma, jwt, {} as any, undefined, integridad);
  return { svc, eventos, actualizaciones };
}

test('sesión única: con verificación de mail, el token de una sesión anterior se rechaza con SESION_REEMPLAZADA', async () => {
  const { svc } = intentosConIntento({ id: 'i-1', sesion: 3 });
  const vigente = await jwt.signAsync({ sub: 'i-1', typ: 'intento', ses: 3 });
  const viejo = await jwt.signAsync({ sub: 'i-1', typ: 'intento', ses: 2 });
  assert.equal(await svc.intentoDeToken(`Bearer ${vigente}`, 'slug'), 'i-1');
  await assert.rejects(
    () => svc.intentoDeToken(`Bearer ${viejo}`, 'slug'),
    (e: any) => e.getStatus() === 401 && e.getResponse().codigo === 'SESION_REEMPLAZADA',
  );
});

test('sesión única: un token sin `ses` (anterior a esta versión) vale solo mientras el intento está en la sesión 0', async () => {
  const sinSes = await jwt.signAsync({ sub: 'i-1', typ: 'intento' });
  assert.equal(await intentosConIntento({ id: 'i-1', sesion: 0 }).svc.intentoDeToken(`Bearer ${sinSes}`, 'slug'), 'i-1');
  await assert.rejects(() => intentosConIntento({ id: 'i-1', sesion: 1 }).svc.intentoDeToken(`Bearer ${sinSes}`, 'slug'), /Abriste este examen en otro lugar/);
});

test('sesión única: sin verificación de mail no se aplica (si no, cualquiera que supiera un mail sacaría al alumno de su examen)', async () => {
  const { svc } = intentosConIntento({ id: 'i-1', sesion: 5 }, { verificarEmail: false });
  const viejo = await jwt.signAsync({ sub: 'i-1', typ: 'intento', ses: 1 });
  assert.equal(await svc.intentoDeToken(`Bearer ${viejo}`, 'slug'), 'i-1');
});

test('origen: un cambio de IP, navegador o pestaña queda anotado; el mismo origen no; y sin anti-cheat no se anota conducta', async () => {
  const token = await jwt.signAsync({ sub: 'i-1', typ: 'intento', ses: 0 });
  const base = { id: 'i-1', sesion: 0, ultimoOrigenIp: '1.1.1.1', ultimoOrigenUa: 'Chrome', ultimoClienteId: 'tab-A' };
  const mismo = intentosConIntento(base);
  await mismo.svc.intentoDeToken(`Bearer ${token}`, 'slug', { ip: '1.1.1.1', userAgent: 'Chrome', clienteId: 'tab-A' });
  assert.deepEqual(mismo.eventos, []);
  assert.deepEqual(mismo.actualizaciones, []);

  const otro = intentosConIntento(base);
  await otro.svc.intentoDeToken(`Bearer ${token}`, 'slug', { ip: '9.9.9.9', userAgent: 'Safari', clienteId: 'tab-B' });
  assert.equal(otro.eventos.length, 1);
  assert.equal(otro.eventos[0].tipo, 'cambio_de_origen');
  assert.match(otro.eventos[0].detalle, /IP.*navegador.*pestaña o dispositivo/);
  assert.equal(otro.actualizaciones[0].ultimoClienteId, 'tab-B', 'el nuevo origen pasa a ser la referencia (alternar dos equipos anota cada cambio)');

  const sinAntiCheat = intentosConIntento(base, { examen: { antiCheat: null } });
  await sinAntiCheat.svc.intentoDeToken(`Bearer ${token}`, 'slug', { ip: '9.9.9.9', userAgent: 'Safari', clienteId: 'tab-B' });
  assert.deepEqual(sinAntiCheat.eventos, [], 'sin monitoreo (ni consentimiento) no se anota');
});

test('origen: el primer pedido solo fija la referencia, sin anotar nada', async () => {
  const token = await jwt.signAsync({ sub: 'i-1', typ: 'intento', ses: 0 });
  const { svc, eventos, actualizaciones } = intentosConIntento({ id: 'i-1', sesion: 0, ultimoOrigenIp: null, ultimoOrigenUa: null, ultimoClienteId: null });
  await svc.intentoDeToken(`Bearer ${token}`, 'slug', { ip: '1.1.1.1', userAgent: 'Chrome', clienteId: 'tab-A' });
  assert.deepEqual(eventos, []);
  assert.equal(actualizaciones[0].ultimoOrigenIp, '1.1.1.1');
});

test('el almacén en memoria de fallos sigue siendo compatible con el limitador (sanidad del import)', () => {
  assert.ok(new AlmacenFallosMemoria());
  assert.ok(readFileSync(join(__dirname, '..', 'src', 'respuestas-examen', 'anticheat.util.ts'), 'utf8').includes('EVENTOS_DEL_SERVIDOR'));
});
