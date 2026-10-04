// Tests del link de entrega de trabajos prácticos (config del TP, token del alumno, ventana, modo seguro, cierre). Corren sin base de datos:
//   npm test
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IntentosService } from '../src/respuestas-examen/intentos.service';
import { IntentosTpService, TIPO_TOKEN_ENTREGA } from '../src/trabajos-practicos/intentos-tp.service';
import { MAX_DURACION_MINUTOS, resolverConfigLink } from '../src/trabajos-practicos/config-link.util';

const jwt = new JwtService({ secret: 'x'.repeat(40) });
const en = (ms: number) => new Date(Date.now() + ms);
const MIN = 60_000;

// ---------------------------------------------------------------------------
// Config del TP: qué se guarda según la modalidad elegida
// ---------------------------------------------------------------------------
test('ventana de tiempo: guarda la duración y ninguna fecha (aunque lleguen)', () => {
  const c = resolverConfigLink({ modalidad: 'ventana_tiempo', duracionMinutos: 90, modoSeguro: true, fechaInicio: '2030-01-01T10:00:00Z', fechaFin: '2030-01-02T10:00:00Z' });
  assert.deepEqual(c, { modoSeguro: true, duracionMinutos: 90, fechaInicio: null, fechaFin: null });
});

test('ventana de tiempo: sin duración o fuera de rango se rechaza', () => {
  for (const duracionMinutos of [undefined, 0, -5, MAX_DURACION_MINUTOS + 1]) {
    assert.throws(() => resolverConfigLink({ modalidad: 'ventana_tiempo', duracionMinutos }), BadRequestException);
  }
  assert.equal(resolverConfigLink({ modalidad: 'ventana_tiempo', duracionMinutos: MAX_DURACION_MINUTOS }).duracionMinutos, MAX_DURACION_MINUTOS);
});

test('horario fijo: guarda inicio y vencimiento, sin duración; el modo seguro es opcional (default no)', () => {
  const ahora = new Date('2030-01-01T00:00:00Z');
  const c = resolverConfigLink({ modalidad: 'horario_fijo', duracionMinutos: 30, fechaInicio: '2030-01-02T10:00:00Z', fechaFin: '2030-01-02T12:00:00Z' }, ahora);
  assert.equal(c.modoSeguro, false);
  assert.equal(c.duracionMinutos, null);
  assert.equal(c.fechaInicio?.toISOString(), '2030-01-02T10:00:00.000Z');
  assert.equal(c.fechaFin?.toISOString(), '2030-01-02T12:00:00.000Z');
});

test('horario fijo: pide las dos fechas, el vencimiento posterior al inicio y todavía no vencido', () => {
  const ahora = new Date('2030-01-01T00:00:00Z');
  const base = { modalidad: 'horario_fijo' as const };
  assert.throws(() => resolverConfigLink({ ...base, fechaFin: '2030-01-02T12:00:00Z' }, ahora), /inicio y de vencimiento/);
  assert.throws(() => resolverConfigLink({ ...base, fechaInicio: '2030-01-02T12:00:00Z' }, ahora), /inicio y de vencimiento/);
  assert.throws(() => resolverConfigLink({ ...base, fechaInicio: '2030-01-02T12:00:00Z', fechaFin: '2030-01-02T10:00:00Z' }, ahora), /posterior al inicio/);
  assert.throws(() => resolverConfigLink({ ...base, fechaInicio: '2029-01-01T10:00:00Z', fechaFin: '2029-01-02T10:00:00Z' }, ahora), /ya pasó/);
});

// ---------------------------------------------------------------------------
// Token del alumno: aislado del de exámenes y atado a su link
// ---------------------------------------------------------------------------
const tpServiceFalso = (prisma: any = {}, entregas: any = {}) => new IntentosTpService(prisma, jwt, entregas);

test('el token de un examen no sirve en un link de TP, ni al revés', async () => {
  const tokenExamen = await jwt.signAsync({ sub: 'i-1', typ: 'intento' });
  await assert.rejects(() => tpServiceFalso().intentoDeToken(`Bearer ${tokenExamen}`, 'slug'), UnauthorizedException);

  const tokenTp = await jwt.signAsync({ sub: 'i-1', typ: TIPO_TOKEN_ENTREGA });
  const examenes = new IntentosService({} as any, jwt, {} as any);
  await assert.rejects(() => examenes.intentoDeToken(`Bearer ${tokenTp}`, 'slug'), UnauthorizedException);
});

test('sin token, con basura o sin typ no se entra', async () => {
  const svc = tpServiceFalso();
  await assert.rejects(() => svc.intentoDeToken(undefined, 'slug'), UnauthorizedException);
  await assert.rejects(() => svc.intentoDeToken('Bearer basura', 'slug'), UnauthorizedException);
  const sinTyp = await jwt.signAsync({ sub: 'i-1' });
  await assert.rejects(() => svc.intentoDeToken(`Bearer ${sinTyp}`, 'slug'), UnauthorizedException);
});

test('el token de un intento no se puede usar contra el link de otro TP', async () => {
  const token = await jwt.signAsync({ sub: 'i-1', typ: TIPO_TOKEN_ENTREGA });
  const prisma = {
    trabajoPractico: { findUnique: async () => ({ id: 'tp-B' }) },
    intentoEntrega: { findUnique: async () => ({ id: 'i-1', trabajoPracticoId: 'tp-A' }) },
  };
  await assert.rejects(() => tpServiceFalso(prisma).intentoDeToken(`Bearer ${token}`, 'slug-B'), ForbiddenException);
  prisma.intentoEntrega.findUnique = async () => ({ id: 'i-1', trabajoPracticoId: 'tp-B' });
  assert.equal(await tpServiceFalso(prisma).intentoDeToken(`Bearer ${token}`, 'slug-B'), 'i-1');
});

// ---------------------------------------------------------------------------
// Iniciar: ventana, modo seguro y vencimiento que fija el servidor
// ---------------------------------------------------------------------------
function prismaIniciar(tp: any, creados: any[] = []) {
  return {
    trabajoPractico: { findUnique: async () => ({ id: 'tp-1', titulo: 'TP', consigna: 'c', materia: null, modoSeguro: false, duracionMinutos: null, fechaInicio: null, fechaFin: null, ...tp }) },
    intentoEntrega: {
      findUnique: async () => null,
      create: async ({ data }: any) => {
        creados.push(data);
        return { id: 'i-1', estado: 'en_curso', borrador: '', ...data };
      },
    },
  };
}
const dtoAlumno = { alumnoNombre: ' Ana ', alumnoEmail: ' Ana@Mail.com ' };

test('iniciar (ventana de tiempo): el vencimiento es ahora + duración, y el email se guarda normalizado', async () => {
  const creados: any[] = [];
  const svc = tpServiceFalso(prismaIniciar({ duracionMinutos: 60 }, creados));
  (svc as any).estadoIntento = async () => ({});
  const antes = Date.now();
  await svc.iniciar('slug', dtoAlumno);
  assert.equal(creados.length, 1);
  assert.equal(creados[0].alumnoEmail, 'ana@mail.com');
  assert.equal(creados[0].alumnoNombre, 'Ana');
  const dur = creados[0].expiraEn.getTime() - antes;
  assert.ok(dur >= 60 * MIN && dur < 60 * MIN + 5_000, `duración inesperada: ${dur}`);
});

test('iniciar (horario fijo): el vencimiento es el de la fecha fija', async () => {
  const creados: any[] = [];
  const fin = en(2 * 60 * MIN);
  const svc = tpServiceFalso(prismaIniciar({ fechaInicio: en(-MIN), fechaFin: fin }, creados));
  (svc as any).estadoIntento = async () => ({});
  await svc.iniciar('slug', dtoAlumno);
  assert.equal(creados[0].expiraEn.getTime(), fin.getTime());
});

test('iniciar: antes de abrir o después de vencer el horario fijo se rechaza', async () => {
  const antesDeAbrir = tpServiceFalso(prismaIniciar({ fechaInicio: en(MIN), fechaFin: en(60 * MIN) }));
  await assert.rejects(() => antesDeAbrir.iniciar('slug', dtoAlumno), /Todavía no se abrió/);
  const vencido = tpServiceFalso(prismaIniciar({ fechaInicio: en(-60 * MIN), fechaFin: en(-MIN) }));
  await assert.rejects(() => vencido.iniciar('slug', dtoAlumno), /ya cerró/);
});

test('iniciar con modo seguro exige haber aceptado el aviso; sin modo seguro no', async () => {
  const creados: any[] = [];
  const seguro = tpServiceFalso(prismaIniciar({ modoSeguro: true, duracionMinutos: 30 }, creados));
  (seguro as any).estadoIntento = async () => ({});
  await assert.rejects(() => seguro.iniciar('slug', dtoAlumno), /aceptar el aviso/);
  await assert.rejects(() => seguro.iniciar('slug', { ...dtoAlumno, consentimiento: false }), /aceptar el aviso/);
  assert.equal(creados.length, 0);
  await seguro.iniciar('slug', { ...dtoAlumno, consentimiento: true });
  assert.ok(creados[0].consentimientoEn instanceof Date);

  const libre = tpServiceFalso(prismaIniciar({ modoSeguro: false, duracionMinutos: 30 }, creados));
  (libre as any).estadoIntento = async () => ({});
  await libre.iniciar('slug', dtoAlumno);
  assert.equal(creados[1].consentimientoEn, null);
});

test('iniciar un link sin tiempo ni vencimiento (config rota) no crea intentos sin tope', async () => {
  const creados: any[] = [];
  await assert.rejects(() => tpServiceFalso(prismaIniciar({}, creados)).iniciar('slug', dtoAlumno), /no tiene tiempo ni vencimiento/);
  assert.equal(creados.length, 0);
});

test('iniciar con un intento ya entregado se rechaza; con uno en curso se retoma sin crear otro', async () => {
  const creados: any[] = [];
  const prisma: any = prismaIniciar({ duracionMinutos: 60 }, creados);
  prisma.intentoEntrega.findUnique = async () => ({ id: 'i-9', estado: 'entregado', expiraEn: en(60 * MIN) });
  await assert.rejects(() => tpServiceFalso(prisma).iniciar('slug', dtoAlumno), /Ya entregaste/);

  prisma.intentoEntrega.findUnique = async () => ({ id: 'i-9', estado: 'en_curso', expiraEn: en(10 * MIN) });
  const svc = tpServiceFalso(prisma);
  (svc as any).estadoIntento = async () => ({ borrador: 'lo que había' });
  const r: any = await svc.iniciar('slug', dtoAlumno);
  assert.equal(creados.length, 0);
  assert.equal(r.borrador, 'lo que había');
  assert.equal((await jwt.verifyAsync(r.token)).sub, 'i-9');
});

// ---------------------------------------------------------------------------
// Cierre: una sola entrega por intento, sin entrega vacía, corrección en segundo plano
// ---------------------------------------------------------------------------
function prismaCierre(intento: any, update: (args: any) => Promise<any>) {
  return { intentoEntrega: { findUnique: async () => intento, update } };
}
const intentoBase = { id: 'i-1', trabajoPracticoId: 'tp-1', alumnoNombre: 'Ana', alumnoEmail: 'ana@mail.com', borrador: 'texto guardado' };

test('finalizar crea la entrega con lo del intento en una sola operación y la manda a corregir', async () => {
  const llamadas: any[] = [];
  const corregidas: string[] = [];
  const prisma = prismaCierre(intentoBase, async (args) => {
    llamadas.push(args);
    return { ...intentoBase, estado: args.data.estado, entregadoEn: new Date(), entrega: { id: 'e-1' } };
  });
  const svc = tpServiceFalso(prisma, { corregir: async (id: string) => corregidas.push(id) });
  await svc.finalizar('i-1', undefined, 'entregado');
  await new Promise((r) => setImmediate(r));

  assert.equal(llamadas.length, 1);
  assert.deepEqual(llamadas[0].where, { id: 'i-1', estado: 'en_curso' }); // el reclamo atómico
  assert.deepEqual(llamadas[0].data.entrega.create, { trabajoPracticoId: 'tp-1', alumnoNombre: 'Ana', alumnoEmail: 'ana@mail.com', textoTrabajo: 'texto guardado' });
  assert.deepEqual(corregidas, ['e-1']);
});

test('finalizar con el texto que manda el alumno usa ese texto, no el borrador viejo', async () => {
  let args: any;
  const prisma = prismaCierre(intentoBase, async (a) => ((args = a), { ...intentoBase, entrega: { id: 'e-1' } }));
  await tpServiceFalso(prisma, { corregir: async () => undefined }).finalizar('i-1', 'versión final', 'entregado');
  assert.equal(args.data.entrega.create.textoTrabajo, 'versión final');
});

test('finalizar sin nada escrito cierra el intento pero no crea entrega ni llama a la IA', async () => {
  let args: any;
  let corrigio = false;
  const prisma = prismaCierre({ ...intentoBase, borrador: '   \n ' }, async (a) => ((args = a), { ...intentoBase, entrega: null }));
  await tpServiceFalso(prisma, { corregir: async () => (corrigio = true) }).finalizar('i-1');
  assert.equal(args.data.estado, 'vencido');
  assert.equal('entrega' in args.data, false);
  assert.equal(corrigio, false);
});

test('finalizar dos veces a la vez: el que pierde el reclamo (P2025) no crea nada ni corrige', async () => {
  let corrigio = false;
  const prisma = prismaCierre(intentoBase, async () => {
    throw Object.assign(new Error('Record to update not found'), { code: 'P2025' });
  });
  const r = await tpServiceFalso(prisma, { corregir: async () => (corrigio = true) }).finalizar('i-1');
  assert.equal(r, null);
  assert.equal(corrigio, false);
});

test('finalizar: otro error de base se propaga (no se traga)', async () => {
  const prisma = prismaCierre(intentoBase, async () => {
    throw Object.assign(new Error('conexión caída'), { code: 'P1001' });
  });
  await assert.rejects(() => tpServiceFalso(prisma, {}).finalizar('i-1'), /conexión caída/);
});

test('un fallo de la IA no rompe la entrega del alumno', async () => {
  const prisma = prismaCierre(intentoBase, async () => ({ ...intentoBase, entrega: { id: 'e-1' } }));
  const svc = tpServiceFalso(prisma, { corregir: async () => Promise.reject(new Error('IA caída')) });
  (svc as any).logger = { error: () => undefined };
  assert.ok(await svc.finalizar('i-1', undefined, 'entregado'));
  await new Promise((r) => setImmediate(r)); // el rechazo queda capturado, no sube como "unhandled"
});

// ---------------------------------------------------------------------------
// Entregar: texto vacío, fuera de tiempo y tamaño
// ---------------------------------------------------------------------------
function svcEntregar(intento: any) {
  const cierres: any[] = [];
  const svc = tpServiceFalso({ intentoEntrega: { findUnique: async () => intento } });
  (svc as any).finalizar = async (...a: any[]) => (cierres.push(a), { entregadoEn: new Date() });
  return { svc, cierres };
}

test('entregar sin escribir nada se rechaza (el texto manda, o en su defecto el borrador)', async () => {
  const { svc, cierres } = svcEntregar({ id: 'i-1', estado: 'en_curso', expiraEn: en(10 * MIN), borrador: '' });
  await assert.rejects(() => svc.entregar('i-1', '   '), /Escribí tu trabajo/);
  await assert.rejects(() => svc.entregar('i-1'), /Escribí tu trabajo/);
  assert.equal(cierres.length, 0);
});

test('entregar a tiempo con el borrador guardado alcanza (sin texto nuevo)', async () => {
  const { svc, cierres } = svcEntregar({ id: 'i-1', estado: 'en_curso', expiraEn: en(10 * MIN), borrador: 'guardado' });
  const r = await svc.entregar('i-1');
  assert.equal(r.aTiempo, true);
  assert.deepEqual(cierres[0], ['i-1', undefined, 'entregado']);
});

test('entregar pasado el margen no acepta texto nuevo: vale lo autoguardado y queda como vencido', async () => {
  const { svc, cierres } = svcEntregar({ id: 'i-1', estado: 'en_curso', expiraEn: en(-5 * MIN), borrador: 'guardado' });
  const r = await svc.entregar('i-1', 'texto escrito después de que se acabó');
  assert.equal(r.aTiempo, false);
  assert.deepEqual(cierres[0], ['i-1', undefined, 'vencido']);
});

test('entregar un intento ya cerrado responde 409', async () => {
  const { svc } = svcEntregar({ id: 'i-1', estado: 'entregado', expiraEn: en(10 * MIN), borrador: 'x' });
  await assert.rejects(() => svc.entregar('i-1', 'x'), ConflictException);
});

test('un texto demasiado grande se rechaza al guardar y al entregar', async () => {
  const enorme = 'a'.repeat(900_001);
  const { svc } = svcEntregar({ id: 'i-1', estado: 'en_curso', expiraEn: en(10 * MIN), borrador: 'x' });
  await assert.rejects(() => svc.entregar('i-1', enorme), /demasiado grande/);
  (svc as any).intentoActivo = async () => ({});
  await assert.rejects(() => svc.guardarBorrador('i-1', enorme), /demasiado grande/);
});

// ---------------------------------------------------------------------------
// Señales de integridad: solo con modo seguro
// ---------------------------------------------------------------------------
function svcEventos(trabajoPractico: { modoSeguro: boolean }, consentimientoEn: Date | null) {
  const updates: any[] = [];
  const prisma = {
    intentoEntrega: {
      findUnique: async () => ({ id: 'i-1', estado: 'en_curso', expiraEn: en(10 * MIN), consentimientoEn, trabajoPractico }),
      update: async (a: any) => updates.push(a),
    },
  };
  return { svc: tpServiceFalso(prisma), updates };
}

test('con modo seguro cada tipo de evento suma uno a su contador', async () => {
  const { svc, updates } = svcEventos({ modoSeguro: true }, new Date());
  for (const tipo of ['salida_pantalla_completa', 'cambio_pestana', 'pegado'] as const) {
    assert.deepEqual(await svc.registrarEvento('i-1', { tipo }), { registrado: true });
  }
  assert.deepEqual(updates.map((u) => u.data), [{ salidasPantalla: { increment: 1 } }, { cambiosPestana: { increment: 1 } }, { pegados: { increment: 1 } }]);
});

test('sin modo seguro (o sin aviso aceptado) no se registra nada', async () => {
  const sinModo = svcEventos({ modoSeguro: false }, null);
  assert.deepEqual(await sinModo.svc.registrarEvento('i-1', { tipo: 'pegado' }), { registrado: false });
  const sinAviso = svcEventos({ modoSeguro: true }, null);
  assert.deepEqual(await sinAviso.svc.registrarEvento('i-1', { tipo: 'pegado' }), { registrado: false });
  assert.equal(sinModo.updates.length + sinAviso.updates.length, 0);
});

test('la consigna no se expone en la info pública del link', async () => {
  const svc = tpServiceFalso(prismaIniciar({ duracionMinutos: 45, modoSeguro: true, consigna: 'SECRETA' }));
  const info = await svc.info('slug');
  assert.equal(JSON.stringify(info).includes('SECRETA'), false);
  assert.deepEqual(info.trabajo, { titulo: 'TP', materia: null, modoSeguro: true, duracionMinutos: 45 });
  assert.equal(info.ventana.estado, 'abierta');
});

test('info marca la ventana: no abierta, abierta o cerrada', async () => {
  const estado = async (tp: any) => (await tpServiceFalso(prismaIniciar(tp)).info('s')).ventana.estado;
  assert.equal(await estado({ fechaInicio: en(MIN), fechaFin: en(60 * MIN) }), 'no_abierta');
  assert.equal(await estado({ fechaInicio: en(-MIN), fechaFin: en(60 * MIN) }), 'abierta');
  assert.equal(await estado({ fechaInicio: en(-60 * MIN), fechaFin: en(-MIN) }), 'cerrada');
});
