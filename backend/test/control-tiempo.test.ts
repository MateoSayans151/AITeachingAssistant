// Control del tiempo y los avisos durante el examen: cierre programado, duración editable (también para quienes ya rinden), tiempo extra por
// alumno, entrega a la fuerza y cartel de aviso. Sin base de datos ni red:
//   node --require ts-node/register --test test/control-tiempo.test.ts
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IntentosService } from '../src/respuestas-examen/intentos.service';
import { avisoDe, calcularExpiracion, estaCerrado, textoAvisoDuracion } from '../src/respuestas-examen/control-tiempo.util';
import { AvisoDto, CierreProgramadoDto, DuracionDto, TiempoExtraDto } from '../src/examenes/dto/control-tiempo.dto';

const EX = '11111111-1111-4111-8111-111111111111';
const I1 = 'a1111111-1111-4111-8111-111111111111';
const I2 = 'a2222222-2222-4222-8222-222222222222';
const min = (n: number) => n * 60_000;

// ---------------------------------------------------------------------------
// Funciones puras
// ---------------------------------------------------------------------------
test('calcularExpiracion: inicio + duración, sin pasarse del cierre del link, más el tiempo extra', () => {
  const inicio = new Date('2026-11-03T10:00:00Z');
  assert.equal(calcularExpiracion(inicio, 60, 0, null).toISOString(), '2026-11-03T11:00:00.000Z');
  assert.equal(calcularExpiracion(inicio, 60, 0, new Date('2026-11-03T10:30:00Z')).toISOString(), '2026-11-03T10:30:00.000Z', 'el cierre del link manda');
  assert.equal(calcularExpiracion(inicio, 60, 15, null).toISOString(), '2026-11-03T11:15:00.000Z');
  assert.equal(calcularExpiracion(inicio, 60, 15, new Date('2026-11-03T10:30:00Z')).toISOString(), '2026-11-03T10:45:00.000Z', 'el extra se suma después del tope');
  assert.equal(calcularExpiracion(inicio, 60, 0, new Date('2026-11-03T12:00:00Z')).toISOString(), '2026-11-03T11:00:00.000Z', 'un cierre más lejano no alarga');
});

test('estaCerrado: por el docente o porque llegó la hora del cierre programado', () => {
  const ahora = new Date('2026-11-03T12:00:00Z');
  assert.ok(estaCerrado({ estado: 'cerrado' }, ahora));
  assert.ok(estaCerrado({ estado: 'publicado', cierreProgramadoEn: new Date('2026-11-03T11:59:59Z') }, ahora));
  assert.ok(estaCerrado({ estado: 'publicado', cierreProgramadoEn: ahora }, ahora));
  assert.ok(!estaCerrado({ estado: 'publicado', cierreProgramadoEn: new Date('2026-11-03T12:00:01Z') }, ahora));
  assert.ok(!estaCerrado({ estado: 'publicado', cierreProgramadoEn: null }, ahora));
  assert.ok(!estaCerrado({ estado: 'borrador' }, ahora));
});

test('avisoDe y textoAvisoDuracion', () => {
  assert.equal(avisoDe(null), null);
  assert.equal(avisoDe({ avisoTexto: null, avisoEn: null }), null);
  assert.equal(avisoDe({ avisoTexto: 'Hay un error', avisoEn: null }), null);
  assert.deepEqual(avisoDe({ avisoTexto: 'Hay un error', avisoEn: new Date('2026-11-03T12:00:00Z') }), { texto: 'Hay un error', enviadoEn: '2026-11-03T12:00:00.000Z' });
  assert.match(textoAvisoDuracion(90), /ahora dura 1 h 30 min/);
  assert.match(textoAvisoDuracion(45), /ahora dura 45 min/);
  assert.match(textoAvisoDuracion(120), /ahora dura 2 h desde/);
});

test('DTOs: duración entre 1 y 1440, tiempo extra entre 1 y 240, aviso no vacío y con tope, cierre con fecha o null', async () => {
  const ok = async (Clase: any, body: unknown) => (await validate(plainToInstance(Clase, body))).length === 0;
  assert.ok(await ok(DuracionDto, { minutos: 60 }));
  assert.ok(await ok(DuracionDto, { minutos: '75' }), 'llega como texto desde un formulario');
  assert.ok(!(await ok(DuracionDto, { minutos: 0 })));
  assert.ok(!(await ok(DuracionDto, { minutos: 1441 })));
  assert.ok(!(await ok(DuracionDto, { minutos: 10.5 })));
  assert.ok(await ok(TiempoExtraDto, { minutos: 10 }));
  assert.ok(!(await ok(TiempoExtraDto, { minutos: 0 })));
  assert.ok(!(await ok(TiempoExtraDto, { minutos: 241 })));
  assert.ok(await ok(AvisoDto, { texto: 'Hay un error en la pregunta 3' }));
  assert.ok(!(await ok(AvisoDto, { texto: '   ' })));
  assert.ok(!(await ok(AvisoDto, { texto: 'x'.repeat(501) })));
  assert.ok(await ok(CierreProgramadoDto, { cierraEn: '2026-11-03T18:00:00Z', entregarEnCurso: true }));
  assert.ok(await ok(CierreProgramadoDto, { cierraEn: null, entregarEnCurso: false }));
  assert.ok(!(await ok(CierreProgramadoDto, { cierraEn: 'mañana', entregarEnCurso: true })));
  assert.ok(!(await ok(CierreProgramadoDto, { cierraEn: null })));
});

// ---------------------------------------------------------------------------
// IntentosService
// ---------------------------------------------------------------------------
function servicio(prisma: any) {
  const svc = new IntentosService(prisma, {} as any, {} as any);
  (svc as any).logger = { error: () => undefined, warn: () => undefined, log: () => undefined };
  return svc;
}

test('programarCierre: guarda la hora y qué hacer con los que siguen; rechaza el pasado y un examen ya cerrado', async () => {
  let guardado: any = null;
  let estado = 'publicado';
  const prisma: any = {
    examen: { findUnique: async () => (estado ? { estado } : null), update: async ({ data }: any) => void (guardado = data) },
  };
  const svc = servicio(prisma);
  const futuro = new Date(Date.now() + min(30));
  assert.deepEqual(await svc.programarCierre(EX, futuro, false), { cierreProgramadoEn: futuro, cierreEntregarEnCurso: false });
  assert.deepEqual(guardado, { cierreProgramadoEn: futuro, cierreEntregarEnCurso: false });
  await svc.programarCierre(EX, null, true);
  assert.equal(guardado.cierreProgramadoEn, null, 'null quita el cierre');
  await assert.rejects(() => svc.programarCierre(EX, new Date(Date.now() - 1000), true), BadRequestException);
  estado = 'cerrado';
  await assert.rejects(() => svc.programarCierre(EX, futuro, true), ConflictException);
  estado = '';
  await assert.rejects(() => svc.programarCierre(EX, futuro, true), NotFoundException);
});

test('cerrarProgramados: cierra los que llegaron a su hora y entrega a los que siguen rindiendo solo si estaba elegido', async () => {
  const cerrados: string[] = [];
  const prisma: any = {
    examen: {
      findMany: async ({ where }: any) => {
        assert.deepEqual(where.estado, { not: 'cerrado' });
        assert.ok(where.cierreProgramadoEn.lte instanceof Date);
        return [
          { id: 'e-entrega', cierreEntregarEnCurso: true },
          { id: 'e-deja', cierreEntregarEnCurso: false },
          { id: 'e-ya-cerrado-por-otro', cierreEntregarEnCurso: true },
        ];
      },
      updateMany: async ({ where }: any) => {
        if (where.id === 'e-ya-cerrado-por-otro') return { count: 0 }; // otro proceso ganó el cierre
        cerrados.push(where.id);
        return { count: 1 };
      },
    },
  };
  const svc = servicio(prisma);
  const entregados: string[] = [];
  (svc as any).entregarEnCurso = async (id: string) => void entregados.push(id);
  assert.equal(await svc.cerrarProgramados(), 2);
  assert.deepEqual(cerrados, ['e-entrega', 'e-deja']);
  assert.deepEqual(entregados, ['e-entrega'], 'solo el que eligió entregar; el que perdió la carrera tampoco');
});

function prismaDuracion(modalidad = 'sesion_tiempo') {
  const ahora = Date.now();
  const intentos: any[] = [
    { id: I1, inicioEn: new Date(ahora - min(50)), minutosExtra: 0, expiraEn: new Date(ahora + min(10)), alumno: { nombre: 'Ana', comisionId: 'c1' } },
    { id: I2, inicioEn: new Date(ahora - min(20)), minutosExtra: 15, expiraEn: new Date(ahora + min(55)), alumno: { nombre: 'Beto', comisionId: 'c1' } },
  ];
  const escritos: any[] = [];
  const prisma: any = {
    examen: {
      findUnique: async () => ({ modalidad, comisiones: [{ comisionId: 'c1', fechaFin: null }] }),
      update: async ({ data }: any) => (escritos.push({ examen: data }), {}),
    },
    intentoExamen: {
      findMany: async () => intentos,
      update: async ({ where, data }: any) => (escritos.push({ intento: where.id, ...data }), {}),
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  return { prisma, escritos };
}

test('vistaPreviaDuracion: avisa a quiénes se les cortaría si se baja la duración (cuenta el tiempo extra que ya tenían)', async () => {
  const { prisma } = prismaDuracion();
  const svc = servicio(prisma);
  // Con 40 min: Ana lleva 50 (se corta); Beto lleva 20 y tiene 15 de extra (le quedan 35).
  assert.deepEqual(await svc.vistaPreviaDuracion(EX, 40), { rindiendo: 2, seCortan: [{ intentoId: I1, nombre: 'Ana' }] });
  assert.deepEqual((await svc.vistaPreviaDuracion(EX, 90)).seCortan, [], 'alargar no corta a nadie');
});

test('cambiarDuracion: cambia la duración, recalcula el vencimiento de los que rinden y deja un aviso para todos', async () => {
  const { prisma, escritos } = prismaDuracion();
  const svc = servicio(prisma);
  const r = await svc.cambiarDuracion(EX, 90);
  assert.deepEqual(r, { duracionMinutos: 90, actualizados: 2, seCortan: 0 });
  const examen = escritos.find((e) => e.examen)!.examen;
  assert.equal(examen.duracionMinutos, 90);
  assert.match(examen.avisoTexto, /ahora dura 1 h 30 min/);
  assert.ok(examen.avisoEn instanceof Date);
  const ana = escritos.find((e) => e.intento === I1)!;
  const beto = escritos.find((e) => e.intento === I2)!;
  assert.ok(Math.abs(ana.expiraEn.getTime() - (Date.now() - min(50) + min(90))) < 5_000, 'Ana: inicio + 90');
  assert.ok(Math.abs(beto.expiraEn.getTime() - (Date.now() - min(20) + min(90) + min(15))) < 5_000, 'Beto: inicio + 90 + sus 15 extra');
  assert.equal((await servicio(prismaDuracion().prisma).cambiarDuracion(EX, 40)).seCortan, 1);
});

test('cambiarDuracion: un examen con ventana de fechas (sin duración por sesión) es un 409', async () => {
  await assert.rejects(() => servicio(prismaDuracion('ventana_dias').prisma).cambiarDuracion(EX, 60), ConflictException);
  await assert.rejects(() => servicio(prismaDuracion('ventana_dias').prisma).vistaPreviaDuracion(EX, 60), ConflictException);
});

function prismaIntento(intento: any) {
  const escritos: any[] = [];
  const prisma: any = {
    intentoExamen: {
      findFirst: async ({ where }: any) => (intento && where.id === intento.id && where.examenId === EX ? intento : null),
      update: async ({ data }: any) => (escritos.push(data), {}),
    },
  };
  return { prisma, escritos };
}

test('darTiempoExtra: alarga solo el reloj de ese alumno y lo anota; sin límite, entregado o de otro examen no se puede', async () => {
  const base = new Date('2026-11-03T12:00:00Z');
  const { prisma, escritos } = prismaIntento({ id: I1, examenId: EX, estado: 'en_curso', expiraEn: base, minutosExtra: 5 });
  const r = await servicio(prisma).darTiempoExtra(EX, I1, 10);
  assert.equal(r.expiraEn.toISOString(), '2026-11-03T12:10:00.000Z');
  assert.equal(r.minutosExtra, 15);
  assert.deepEqual(escritos[0].minutosExtra, { increment: 10 });

  await assert.rejects(() => servicio(prismaIntento({ id: I1, examenId: EX, estado: 'en_curso', expiraEn: null, minutosExtra: 0 }).prisma).darTiempoExtra(EX, I1, 10), ConflictException);
  await assert.rejects(() => servicio(prismaIntento({ id: I1, examenId: EX, estado: 'entregado', expiraEn: base, minutosExtra: 0 }).prisma).darTiempoExtra(EX, I1, 10), ConflictException);
  await assert.rejects(() => servicio(prismaIntento(null).prisma).darTiempoExtra(EX, I1, 10), NotFoundException);
  await assert.rejects(() => servicio(prisma).darTiempoExtra(EX, 'no-es-uuid', 10), NotFoundException);
});

test('entregarIntentoPorDocente: entrega lo autoguardado de ese alumno; si ya entregó es un 409', async () => {
  const { prisma } = prismaIntento({ id: I1, examenId: EX, estado: 'en_curso', expiraEn: null, minutosExtra: 0 });
  const svc = servicio(prisma);
  const llamadas: any[] = [];
  (svc as any).finalizar = async (...args: any[]) => (llamadas.push(args), { id: 'r-1' });
  assert.deepEqual(await svc.entregarIntentoPorDocente(EX, I1), { entregado: true });
  assert.deepEqual(llamadas, [[I1, undefined, 'entregado']], 'sin contenido nuevo: vale el último autoguardado');
  await assert.rejects(() => servicio(prismaIntento({ id: I1, examenId: EX, estado: 'entregado' }).prisma).entregarIntentoPorDocente(EX, I1), ConflictException);
});

test('avisar: guarda el texto con su hora; con null lo quita; un examen que no existe es 404', async () => {
  let datos: any = null;
  let cuantos = 1;
  const svc = servicio({ examen: { updateMany: async ({ data }: any) => ((datos = data), { count: cuantos }) } });
  await svc.avisar(EX, 'Hay un error en la pregunta 3');
  assert.equal(datos.avisoTexto, 'Hay un error en la pregunta 3');
  assert.ok(datos.avisoEn instanceof Date);
  await svc.avisar(EX, null);
  assert.deepEqual(datos, { avisoTexto: null, avisoEn: null });
  cuantos = 0;
  await assert.rejects(() => svc.avisar(EX, 'x'), NotFoundException);
});

test('guardarBorrador devuelve el vencimiento y el aviso vigentes: así le llegan al alumno los cambios del docente', async () => {
  const expiraEn = new Date(Date.now() + min(30)); // a futuro: si no, el intento ya estaría vencido
  const prisma: any = {
    intentoExamen: { findUnique: async () => ({ id: I1, examenId: EX, estado: 'en_curso', expiraEn, borrador: {}, borradorActualizadoEn: null, inicioEn: new Date() }), update: async () => ({}) },
    pregunta: { findMany: async () => [{ id: 'p1' }] },
    examen: { findUnique: async () => ({ avisoTexto: 'Cambió el tiempo', avisoEn: new Date('2026-11-03T12:00:00Z') }) },
  };
  const svc = servicio(prisma);
  const r: any = await svc.guardarBorrador(I1, { p1: 'hola', ajena: 'x' });
  assert.equal(r.expiraEn, expiraEn);
  assert.deepEqual(r.aviso, { texto: 'Cambió el tiempo', enviadoEn: '2026-11-03T12:00:00.000Z' });
  assert.ok(r.guardadoEn instanceof Date);
});
