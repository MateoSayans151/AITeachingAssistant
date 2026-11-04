// Control del docente sobre un examen: cerrar y reabrir, panel "En vivo", editar, reabrir una revisión, eliminar cursos y mandar mails a los
// elegidos. Corren sin base de datos ni red (dobles de Prisma y del mail):
//   node --require ts-node/register --test test/control-examen.test.ts
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ExamenesService, MENSAJE_EXAMEN_CON_ALUMNOS } from '../src/examenes/examenes.service';
import { coincideNombre } from '../src/examenes/confirmar-nombre.util';
import { CursosService, MENSAJE_CURSO_CON_OTROS_DOCENTES } from '../src/cursos/cursos.service';
import { IntentosService, MENSAJE_EXAMEN_CERRADO } from '../src/respuestas-examen/intentos.service';
import { RespuestasExamenService } from '../src/respuestas-examen/respuestas-examen.service';
import { NotificacionesService } from '../src/mail/notificaciones.service';
import { InvitacionesService, MENSAJE_SELECCION_AJENA, MENSAJE_SIN_SELECCION } from '../src/mail/invitaciones.service';
import { InvitarAlumnosDto } from '../src/mail/dto/invitar-alumnos.dto';
import { CerrarExamenDto } from '../src/examenes/dto/cerrar-examen.dto';
import { ActualizarPublicacionDto } from '../src/examenes/dto/actualizar-publicacion.dto';
import { contarRespondidas, estadoDeConexion, ordenarEnVivo, SIN_SENAL_MS, tieneContenido, ultimaActividad } from '../src/respuestas-examen/en-vivo.util';

const EX = '11111111-1111-4111-8111-111111111111';
const EC = '33333333-3333-4333-8333-333333333333';
const CURSO = '44444444-4444-4444-8444-444444444444';
const DOC_A = '55555555-5555-4555-8555-555555555555';
const DOC_B = '66666666-6666-4666-8666-666666666666';
const AL1 = 'a1111111-1111-4111-8111-111111111111';
const AL2 = 'a2222222-2222-4222-8222-222222222222';
const AL3 = 'a3333333-3333-4333-8333-333333333333';

// ---------------------------------------------------------------------------
// Confirmar con el nombre
// ---------------------------------------------------------------------------
test('coincideNombre: ignora espacios de más, distingue mayúsculas y nunca acepta un nombre vacío', () => {
  assert.ok(coincideNombre('Parcial 1', 'Parcial 1'));
  assert.ok(coincideNombre('  Parcial   1 ', 'Parcial 1'));
  assert.ok(!coincideNombre('parcial 1', 'Parcial 1'));
  assert.ok(!coincideNombre('', ''), 'un nombre vacío no se confirma con nada');
  assert.ok(!coincideNombre(undefined, 'Parcial 1'));
  assert.ok(coincideNombre('Álgebra'.normalize('NFD'), 'Álgebra'), 'una tilde escrita descompuesta es la misma');
});

// ---------------------------------------------------------------------------
// Cerrar y reabrir
// ---------------------------------------------------------------------------
function prismaExamen(estado: string, comisiones = 1) {
  const examen = { id: EX, estado, _count: { comisiones } };
  const llamadas: string[] = [];
  const prisma: any = {
    examen: {
      updateMany: async ({ where }: any) => {
        llamadas.push('updateMany');
        if (examen.estado === 'cerrado' && where.estado?.not === 'cerrado') return { count: 0 };
        examen.estado = 'cerrado';
        return { count: 1 };
      },
      count: async () => 1,
      findUnique: async () => examen,
      update: async ({ data }: any) => {
        llamadas.push('update');
        examen.estado = data.estado;
        return examen;
      },
    },
  };
  return { svc: new ExamenesService(prisma, {} as any), examen, llamadas };
}

test('cerrar: pasa el examen a cerrado, y cerrar uno ya cerrado es un 409', async () => {
  const { svc, examen } = prismaExamen('publicado');
  assert.deepEqual(await svc.cerrar(EX), { id: EX, estado: 'cerrado' });
  assert.equal(examen.estado, 'cerrado');
  await assert.rejects(() => svc.cerrar(EX), ConflictException);
  await assert.rejects(() => svc.cerrar('no-es-uuid'), NotFoundException);
});

test('reabrir: un cerrado con links vuelve a publicado; sin links, a borrador; uno que no está cerrado es un 409', async () => {
  const conLinks = prismaExamen('cerrado', 2);
  assert.deepEqual(await conLinks.svc.reabrir(EX), { id: EX, estado: 'publicado' });
  const sinLinks = prismaExamen('cerrado', 0);
  assert.deepEqual(await sinLinks.svc.reabrir(EX), { id: EX, estado: 'borrador' });
  await assert.rejects(() => prismaExamen('publicado').svc.reabrir(EX), ConflictException);
});

test('CerrarExamenDto: exige elegir qué pasa con los que están rindiendo (true o false), no hay valor por defecto', async () => {
  assert.equal((await validate(plainToInstance(CerrarExamenDto, { entregarEnCurso: true }))).length, 0);
  assert.equal((await validate(plainToInstance(CerrarExamenDto, { entregarEnCurso: false }))).length, 0);
  assert.ok((await validate(plainToInstance(CerrarExamenDto, {}))).length > 0);
  assert.ok((await validate(plainToInstance(CerrarExamenDto, { entregarEnCurso: 'si' }))).length > 0);
});

// IntentosService con un examen cerrado: nadie nuevo empieza; el que ya empezó sigue (si no se lo entregó al cerrar)
function intentosConExamen(estado: string, intentoExistente: unknown = null) {
  const ec: any = {
    id: EC,
    examenId: EX,
    comisionId: 'com-1',
    accesoAbierto: true,
    verificarEmail: false,
    fechaInicio: null,
    fechaFin: null,
    dominioPermitido: null,
    examen: { estado, titulo: 'Parcial', consigna: 'c', modalidad: 'ventana_dias', duracionMinutos: null, antiCheat: null },
    comision: { nombre: 'Comisión A' },
  };
  const alumno = { id: AL1, nombre: 'Ana', email: 'ana@mail.com' };
  const creados: string[] = [];
  const prisma: any = {
    examenComision: { findUnique: async () => ec },
    alumno: { findFirst: async () => (intentoExistente ? alumno : null), count: async () => 0, create: async () => (creados.push('alumno'), alumno) },
    respuestaExamen: { count: async () => 0 },
    intentoExamen: {
      findUnique: async () => intentoExistente,
      create: async () => (creados.push('intento'), { id: 'i-1', estado: 'en_curso', expiraEn: null }),
      update: async () => ({ sesion: 1 }),
    },
    sesionIntento: { create: async () => ({}) },
  };
  const svc = new IntentosService(prisma, { signAsync: async () => 'tok' } as any, {} as any);
  (svc as any).fallosPorIp = { verificar: async () => undefined, fallo: async () => undefined };
  (svc as any).estadoIntento = async () => ({ preguntas: [] });
  (svc as any).firmarToken = async () => 'tok';
  return { svc, creados };
}

test('un examen cerrado: el link informa que la ventana cerró', async () => {
  const { svc } = intentosConExamen('cerrado');
  assert.equal((await svc.info('slug')).ventana.estado, 'cerrada');
  assert.equal((await intentosConExamen('publicado').svc.info('slug')).ventana.estado, 'abierta');
});

test('un examen cerrado: un alumno nuevo no puede empezar (ni se lo da de alta con acceso abierto)', async () => {
  const { svc, creados } = intentosConExamen('cerrado');
  await assert.rejects(
    () => svc.iniciar('slug', { alumnoEmail: 'nuevo@mail.com', alumnoNombre: 'Nuevo' } as any, '1.1.1.1'),
    (e: unknown) => e instanceof BadRequestException && (e.getResponse() as any).message === MENSAJE_EXAMEN_CERRADO,
  );
  assert.deepEqual(creados, [], 'no se creó ni el alumno ni el intento');
});

test('un examen cerrado: un alumno de la lista que nunca empezó tampoco puede; el que ya tenía un intento en curso sigue', async () => {
  const sinIntento = intentosConExamen('cerrado', null);
  (sinIntento.svc as any).resolverAlumno = async () => ({ id: AL1, nombre: 'Ana', email: 'ana@mail.com' });
  await assert.rejects(() => sinIntento.svc.iniciar('slug', { alumnoEmail: 'ana@mail.com' } as any, '1.1.1.1'), BadRequestException);
  assert.deepEqual(sinIntento.creados, []);

  const conIntento = intentosConExamen('cerrado', { id: 'i-1', estado: 'en_curso', expiraEn: null, examenId: EX });
  const r: any = await conIntento.svc.iniciar('slug', { alumnoEmail: 'ana@mail.com' } as any, '1.1.1.1');
  assert.equal(r.token, 'tok', 'retoma su intento');
});

test('entregarEnCurso: entrega el borrador de cada intento en curso y cuenta cuántos; un fallo no frena a los demás', async () => {
  const prisma: any = { intentoExamen: { findMany: async () => [{ id: 'i-1' }, { id: 'i-2' }, { id: 'i-3' }] } };
  const svc = new IntentosService(prisma, {} as any, {} as any);
  const entregados: string[] = [];
  (svc as any).finalizar = async (id: string, contenido: unknown, estado: string) => {
    assert.equal(contenido, undefined, 'vale lo último autoguardado');
    assert.equal(estado, 'entregado');
    if (id === 'i-2') throw new Error('se cayó');
    entregados.push(id);
    return { id };
  };
  assert.equal(await svc.entregarEnCurso(EX), 2);
  assert.deepEqual(entregados, ['i-1', 'i-3']);
});

// ---------------------------------------------------------------------------
// Panel "En vivo"
// ---------------------------------------------------------------------------
test('tieneContenido / contarRespondidas: cuenta lo escrito o elegido, y no lo vacío ni las claves ajenas al examen', () => {
  assert.ok(tieneContenido('hola'));
  assert.ok(!tieneContenido('   '));
  assert.ok(!tieneContenido(''));
  assert.ok(!tieneContenido(null));
  assert.ok(tieneContenido(['a']));
  assert.ok(!tieneContenido([]));
  assert.ok(!tieneContenido(['', ' ']));
  assert.ok(tieneContenido(false), 'falso en un verdadero/falso es una respuesta');
  assert.ok(tieneContenido({ a: 'x' }));
  assert.ok(!tieneContenido({ a: '' }));
  assert.equal(contarRespondidas({ p1: 'texto', p2: '', p3: ['a'], ajena: 'zzz' }, ['p1', 'p2', 'p3', 'p4']), 2);
  assert.equal(contarRespondidas(null, ['p1']), 0);
  assert.equal(contarRespondidas('roto', ['p1']), 0);
});

test('ultimaActividad y estadoDeConexion: lo más reciente entre inicio, latido y autoguardado; sin señal pasados 2 minutos', () => {
  const inicio = new Date('2026-11-03T10:00:00Z');
  const latido = new Date('2026-11-03T10:05:00Z');
  const guardado = new Date('2026-11-03T10:04:00Z');
  assert.equal(ultimaActividad({ inicioEn: inicio, ultimoLatidoEn: latido, borradorActualizadoEn: guardado }).getTime(), latido.getTime());
  assert.equal(ultimaActividad({ inicioEn: inicio, ultimoLatidoEn: null, borradorActualizadoEn: null }).getTime(), inicio.getTime());
  assert.equal(estadoDeConexion(latido, new Date(latido.getTime() + SIN_SENAL_MS)), 'activo');
  assert.equal(estadoDeConexion(latido, new Date(latido.getTime() + SIN_SENAL_MS + 1)), 'sin_senal');
});

test('ordenarEnVivo: primero los sin señal, después los de más señales de integridad, después los que empezaron antes', () => {
  const f = (id: string, conexion: 'activo' | 'sin_senal', totalSenales: number, min: number) => ({ id, conexion, totalSenales, inicioEn: new Date(2026, 10, 3, 10, min) });
  const orden = ordenarEnVivo([f('a', 'activo', 0, 5), f('b', 'activo', 3, 9), f('c', 'sin_senal', 0, 20), f('d', 'activo', 0, 1)]).map((x) => x.id);
  assert.deepEqual(orden, ['c', 'b', 'd', 'a']);
});

test('enVivo: lista solo a los que están rindiendo, con avance y señales, y cuenta los que entregaron y los que no empezaron', async () => {
  const ahora = Date.now();
  const hace = (ms: number) => new Date(ahora - ms);
  const intentos = [
    { id: 'i-1', estado: 'en_curso', inicioEn: hace(600_000), expiraEn: null, entregadoEn: null, borrador: { p1: 'algo', p2: '' }, borradorActualizadoEn: hace(5_000), ultimoLatidoEn: null, alumno: { id: AL1, nombre: 'Ana', email: 'ana@mail.com', comision: { nombre: 'A' } }, _count: { capturas: 2 } },
    { id: 'i-2', estado: 'en_curso', inicioEn: hace(900_000), expiraEn: null, entregadoEn: null, borrador: {}, borradorActualizadoEn: null, ultimoLatidoEn: hace(300_000), alumno: { id: AL2, nombre: 'Beto', email: 'beto@mail.com', comision: { nombre: 'A' } }, _count: { capturas: 0 } },
    { id: 'i-3', estado: 'entregado', inicioEn: hace(1_000_000), expiraEn: null, entregadoEn: hace(100_000), borrador: {}, borradorActualizadoEn: null, ultimoLatidoEn: null, alumno: { id: AL3, nombre: 'Cami', email: 'cami@mail.com', comision: { nombre: 'A' } }, _count: { capturas: 0 } },
  ];
  const prisma: any = {
    intentoExamen: { findMany: async (args: any) => (args.where.estado ? [] : intentos) },
    examen: {
      findUniqueOrThrow: async () => ({
        estado: 'publicado',
        titulo: 'Parcial',
        antiCheat: { pantallaCompleta: true },
        modalidad: 'ventana_dias',
        duracionMinutos: null,
        preguntas: [{ id: 'p1' }, { id: 'p2' }],
        comisiones: [{ id: EC, comision: { nombre: 'A', _count: { alumnos: 5 } } }],
      }),
    },
    eventoIntegridad: { groupBy: async () => [{ intentoId: 'i-1', tipo: 'cambio_pestana', _count: { _all: 3 } }] },
  };
  const svc = new IntentosService(prisma, {} as any, {} as any);
  (svc as any).cerrarVencidos = async () => 0;
  const r = await svc.enVivo(EX);
  assert.deepEqual(r.resumen, { rindiendo: 2, entregaron: 1, sinEmpezar: 2, sinSenal: 1 });
  assert.deepEqual(r.alumnos.map((a) => a.nombre), ['Beto', 'Ana'], 'el que no da señales va primero');
  const ana = r.alumnos.find((a) => a.nombre === 'Ana')!;
  assert.equal(ana.respondidas, 1);
  assert.equal(ana.totalPreguntas, 2);
  assert.deepEqual(ana.senales, { cambio_pestana: 3 });
  assert.equal(ana.totalSenales, 3);
  assert.equal(ana.capturas, 2);
  assert.equal(r.examen.monitoreado, true);
});

// ---------------------------------------------------------------------------
// Editar un examen
// ---------------------------------------------------------------------------
test('reemplazarContenido: con alumnos que ya empezaron o entregaron es un 409 y no se borra ninguna pregunta', async () => {
  for (const [intentos, respuestas] of [[1, 0], [0, 1], [3, 2]]) {
    const llamadas: string[] = [];
    const tx: any = {
      $queryRaw: async () => [{ id: EX, curso_id: CURSO }],
      intentoExamen: { count: async () => intentos },
      respuestaExamen: { count: async () => respuestas },
      pregunta: { deleteMany: async () => llamadas.push('deleteMany') },
      examen: { update: async () => llamadas.push('update') },
    };
    const svc = new ExamenesService({ $transaction: async (fn: any) => fn(tx) } as any, {} as any);
    const dto: any = dtoValido();
    await assert.rejects(
      () => svc.reemplazarContenido(EX, dto),
      (e: unknown) => e instanceof ConflictException && (e.getResponse() as any).message === MENSAJE_EXAMEN_CON_ALUMNOS,
    );
    assert.deepEqual(llamadas, []);
  }
});

test('reemplazarContenido: sin alumnos reemplaza las preguntas; no deja pasar el examen a otro curso', async () => {
  const llamadas: string[] = [];
  const tx: any = {
    $queryRaw: async () => [{ id: EX, curso_id: CURSO }],
    intentoExamen: { count: async () => 0 },
    respuestaExamen: { count: async () => 0 },
    pregunta: { deleteMany: async () => llamadas.push('deleteMany') },
    examen: { update: async ({ data }: any) => (llamadas.push('update'), { id: EX, titulo: data.titulo }) },
  };
  const svc = new ExamenesService({ $transaction: async (fn: any) => fn(tx) } as any, {} as any);
  const r: any = await svc.reemplazarContenido(EX, dtoValido());
  assert.deepEqual(llamadas, ['deleteMany', 'update']);
  assert.equal(r.titulo, 'Parcial editado');
  await assert.rejects(() => svc.reemplazarContenido(EX, { ...dtoValido(), cursoId: 'otro-curso' }), BadRequestException);
});

function dtoValido(): any {
  return {
    cursoId: CURSO,
    titulo: 'Parcial editado',
    consigna: 'Consigna',
    modalidad: 'ventana_dias',
    escalaMin: 0,
    escalaMax: 10,
    niveles: [1, 2, 3, 4, 5].map((orden) => ({ orden, nombre: `N${orden}`, colorHex: '#000000', porcentaje: orden * 20 })),
    feedbackModo: 'manual',
    preguntas: [
      { tipo: 'opcion_multiple', enunciado: 'Elegí', puntajeMaximo: 10, opciones: [{ id: 'a', texto: 'A', correcta: true }, { id: 'b', texto: 'B', correcta: false }] },
    ],
  };
}

test('actualizarPublicacion: cambia las fechas, las puede quitar con null, y rechaza un cierre anterior a la apertura', async () => {
  const guardado: any = { fechaInicio: new Date('2026-11-01T10:00:00Z'), fechaFin: new Date('2026-11-05T10:00:00Z') };
  const prisma: any = {
    examenComision: {
      findFirst: async ({ where }: any) => (where.id === EC && where.examenId === EX ? { ...guardado } : null),
      update: async ({ data }: any) => Object.assign(guardado, data),
    },
  };
  const svc = new ExamenesService(prisma, {} as any);
  const r = await svc.actualizarPublicacion(EX, EC, { fechaFin: '2026-11-20T10:00:00Z' });
  assert.equal(r.fechaFin?.toISOString(), '2026-11-20T10:00:00.000Z');
  assert.equal(r.fechaInicio?.toISOString(), '2026-11-01T10:00:00.000Z', 'lo que no vino no se toca');
  assert.equal((await svc.actualizarPublicacion(EX, EC, { fechaFin: null })).fechaFin, null);
  await assert.rejects(() => svc.actualizarPublicacion(EX, EC, { fechaFin: '2026-10-01T10:00:00Z' }), BadRequestException);
  await assert.rejects(() => svc.actualizarPublicacion(EX, '77777777-7777-4777-8777-777777777777', {}), NotFoundException);
  await assert.rejects(() => svc.actualizarPublicacion(EX, 'no-es-uuid', {}), NotFoundException);
});

test('ActualizarPublicacionDto: fechas ISO o null; una fecha mal escrita se rechaza', async () => {
  const ok = async (b: unknown) => (await validate(plainToInstance(ActualizarPublicacionDto, b))).length === 0;
  assert.ok(await ok({ fechaFin: '2026-11-20T10:00:00Z' }));
  assert.ok(await ok({ fechaFin: null, fechaInicio: null }));
  assert.ok(await ok({}));
  assert.ok(!(await ok({ fechaFin: 'mañana' })));
});

// ---------------------------------------------------------------------------
// Reabrir una revisión
// ---------------------------------------------------------------------------
function respuestasConEstado(estadoRevision: string, notaSugerida: number | null) {
  const fila: any = { id: 'r-1', examenId: EX, estadoRevision, estado: 'revisado', notaTotalSugerida: notaSugerida, notaTotalFinal: 8, revisadoEn: new Date(), notificadoEn: new Date() };
  const prisma: any = {
    respuestaExamen: {
      findUnique: async () => fila,
      update: async ({ data }: any) => Object.assign(fila, data),
    },
  };
  return { svc: new RespuestasExamenService(prisma, {} as any, {} as any, {} as any), fila };
}

test('reabrirRevision: vuelve a pendiente sin nota final ni fecha de revisión, y no toca si ya le llegó el mail', async () => {
  const { svc, fila } = respuestasConEstado('aceptada', 8);
  const r: any = await svc.reabrirRevision(EX, 'r-1');
  assert.equal(r.estadoRevision, 'pendiente');
  assert.equal(r.estado, 'corregido');
  assert.equal(r.notaTotalFinal, null);
  assert.equal(r.revisadoEn, null);
  assert.ok(fila.notificadoEn, 'el envío anterior queda registrado');
});

test('reabrirRevision: una respuesta que la IA nunca corrigió vuelve a pendiente_correccion; una ya pendiente es un 409', async () => {
  const { svc } = respuestasConEstado('editada', null);
  assert.equal(((await svc.reabrirRevision(EX, 'r-1')) as any).estado, 'pendiente_correccion');
  await assert.rejects(() => respuestasConEstado('pendiente', 5).svc.reabrirRevision(EX, 'r-1'), ConflictException);
  await assert.rejects(() => respuestasConEstado('aceptada', 5).svc.reabrirRevision('otro-examen', 'r-1'), NotFoundException);
});

// ---------------------------------------------------------------------------
// Cursos: eliminar solo siendo el último docente, y escribiendo el nombre
// ---------------------------------------------------------------------------
function cursosConEquipo(equipo: string[]) {
  const estado = { curso: { id: CURSO, nombre: 'Álgebra I', equipo: equipo.map((docenteId) => ({ docenteId })) } as any, borrado: false };
  const tx: any = {
    $queryRaw: async () => [{ id: CURSO }],
    curso: { findUnique: async () => (estado.borrado ? null : estado.curso), delete: async () => void (estado.borrado = true) },
  };
  const prisma: any = { $transaction: async (fn: any) => fn(tx), curso: { findUnique: async () => estado.curso } };
  return { svc: new CursosService(prisma), estado };
}

test('eliminar curso: el último docente, con el nombre bien escrito, lo borra', async () => {
  const { svc, estado } = cursosConEquipo([DOC_A]);
  await svc.validarEliminacion(CURSO, DOC_A, 'Álgebra I');
  await svc.eliminar(CURSO, DOC_A, 'Álgebra I');
  assert.ok(estado.borrado);
});

test('eliminar curso: con otros docentes es un 409 (lo que corresponde es salir) y no se borra', async () => {
  const { svc, estado } = cursosConEquipo([DOC_A, DOC_B]);
  await assert.rejects(
    () => svc.validarEliminacion(CURSO, DOC_A, 'Álgebra I'),
    (e: unknown) => e instanceof ConflictException && (e.getResponse() as any).message === MENSAJE_CURSO_CON_OTROS_DOCENTES,
  );
  await assert.rejects(() => svc.eliminar(CURSO, DOC_A, 'Álgebra I'), ConflictException);
  assert.ok(!estado.borrado);
});

test('eliminar curso: con el nombre mal escrito es un 400 y no se borra; quien no es del equipo tampoco puede', async () => {
  const { svc, estado } = cursosConEquipo([DOC_A]);
  await assert.rejects(() => svc.eliminar(CURSO, DOC_A, 'algebra'), BadRequestException);
  await assert.rejects(() => svc.eliminar(CURSO, DOC_B, 'Álgebra I'), ConflictException);
  assert.ok(!estado.borrado);
  await assert.rejects(() => svc.eliminar('no-es-uuid', DOC_A, 'x'), NotFoundException);
});

// ---------------------------------------------------------------------------
// Mails a los elegidos
// ---------------------------------------------------------------------------
test('InvitarAlumnosDto: acepta una lista de alumnos; ids que no son UUID o demasiados se rechazan', async () => {
  const ok = async (b: unknown) => (await validate(plainToInstance(InvitarAlumnosDto, b))).length === 0;
  assert.ok(await ok({ alumnoIds: [AL1, AL2] }));
  assert.ok(await ok({}));
  assert.ok(!(await ok({ alumnoIds: ['uno'] })));
  assert.ok(!(await ok({ alumnoIds: 'todos' })));
});

function invitacionesConAlumnos(previas: Array<{ alumnoId: string; veces: number }> = []) {
  const enviados: Array<{ to: string; key: string }> = [];
  const registrados: string[] = [];
  const prisma: any = {
    examen: {
      findUnique: async () => ({
        titulo: 'Parcial',
        duracionMinutos: null,
        antiCheat: null,
        curso: { nombre: 'Álgebra', docente: { nombre: 'Prof', email: 'prof@mail.com' } },
        comisiones: [
          {
            id: EC,
            slugAcceso: 'slug',
            fechaInicio: null,
            fechaFin: null,
            createdAt: new Date(),
            comision: {
              nombre: 'A',
              alumnos: [
                { id: AL1, nombre: 'Ana', email: 'ana@mail.com' },
                { id: AL2, nombre: 'Beto', email: 'beto@mail.com' },
                { id: AL3, nombre: 'Cami', email: 'cami@mail.com' },
              ],
            },
          },
        ],
      }),
    },
    invitacionEnviada: {
      findMany: async () => previas.map((p) => ({ ...p, enviadoEn: new Date('2026-11-01T10:00:00Z') })),
      upsert: async ({ where }: any) => void registrados.push(where.examenId_alumnoId.alumnoId),
    },
  };
  const mail: any = {
    configurado: true,
    modoPrueba: null,
    enviar: async (m: any) => (enviados.push({ to: m.to, key: m.idempotencyKey }), { ok: true }),
  };
  const svc = new InvitacionesService(prisma, mail, { get: () => 'https://app.test' } as any);
  svc.pausaEntreEnviosMs = 0;
  return { svc, enviados, registrados };
}

async function esperarFin(svc: InvitacionesService) {
  for (let i = 0; i < 500 && svc.estado(EX).enCurso; i++) await new Promise<void>((r) => setImmediate(r));
}

test('invitar a los elegidos: solo les sale a esos, y queda anotado a quién se le mandó', async () => {
  const { svc, enviados, registrados } = invitacionesConAlumnos();
  assert.deepEqual(await svc.invitar(EX, undefined, [AL1, AL3]), { aEnviar: 2 });
  await esperarFin(svc);
  assert.deepEqual(enviados.map((e) => e.to).sort(), ['ana@mail.com', 'cami@mail.com']);
  assert.deepEqual(registrados.sort(), [AL1, AL3].sort());
});

test('invitar de nuevo a quien ya la recibió: se le vuelve a mandar, con otra clave de idempotencia para que Resend no la descarte', async () => {
  const { svc, enviados } = invitacionesConAlumnos([{ alumnoId: AL1, veces: 1 }]);
  await svc.invitar(EX, undefined, [AL1, AL2]);
  await esperarFin(svc);
  assert.equal(enviados.length, 2);
  const clave = (to: string) => enviados.find((e) => e.to === to)!.key;
  assert.match(clave('ana@mail.com'), new RegExp(`-${AL1}-1-`), 'lleva cuántas veces se le mandó antes');
  assert.match(clave('beto@mail.com'), new RegExp(`-${AL2}-0-`));
  assert.notEqual(clave('ana@mail.com').replace(AL1, 'X'), clave('beto@mail.com').replace(AL2, 'X'));
});

test('invitar con una selección vacía es un 409 (no es «todos»), con alguien ajeno a la comisión es un 404, y sin selección va a todos', async () => {
  const a = invitacionesConAlumnos();
  await assert.rejects(
    () => a.svc.invitar(EX, undefined, []),
    (e: unknown) => e instanceof ConflictException && (e.getResponse() as any).message === MENSAJE_SIN_SELECCION,
  );
  const b = invitacionesConAlumnos();
  await assert.rejects(
    () => b.svc.invitar(EX, undefined, [AL1, 'f9999999-9999-4999-8999-999999999999']),
    (e: unknown) => e instanceof NotFoundException && (e.getResponse() as any).message === MENSAJE_SELECCION_AJENA,
  );
  assert.equal(b.enviados.length, 0, 'ni siquiera se le manda a la parte válida');
  const c = invitacionesConAlumnos();
  assert.deepEqual(await c.svc.invitar(EX), { aEnviar: 3 });
  await esperarFin(c.svc);
});

test('destinatarios de la invitación: todos los alumnos, con quién ya la recibió y cuántas veces', async () => {
  const { svc } = invitacionesConAlumnos([{ alumnoId: AL2, veces: 2 }]);
  const lista = await svc.destinatarios(EX);
  assert.equal(lista.length, 3);
  const beto = lista.find((d) => d.alumnoId === AL2)!;
  assert.equal(beto.veces, 2);
  assert.ok(beto.invitadoEn);
  assert.equal(lista.find((d) => d.alumnoId === AL1)!.invitadoEn, null);
});

// Notas por mail a los elegidos
function notificacionesConRespuestas(filas: Array<{ id: string; estadoRevision: string; notificadoEn?: Date | null }>, liberado = true) {
  const lotes: Array<{ ids: string[]; forzar: boolean }> = [];
  const prisma: any = {
    examen: { findUnique: async () => ({ feedbackModo: 'manual', feedbackLiberadoEn: liberado ? new Date() : null }) },
    respuestaExamen: {
      findMany: async ({ where }: any) =>
        filas.filter((f) => (!where.id?.in || where.id.in.includes(f.id)) && (where.notificadoEn !== null || !f.notificadoEn)),
    },
  };
  const svc = new NotificacionesService(prisma, { configurado: true } as any);
  (svc as any).lanzarLote = (_examen: string, ids: string[], forzar = false) => void lotes.push({ ids, forzar });
  return { svc, lotes };
}

const R1 = 'b1111111-1111-4111-8111-111111111111';
const R2 = 'b2222222-2222-4222-8222-222222222222';
const R3 = 'b3333333-3333-4333-8333-333333333333';

test('notificarSeleccion: manda solo a los elegidos y fuerza el reenvío (a quien ya lo recibió también)', async () => {
  const { svc, lotes } = notificacionesConRespuestas([
    { id: R1, estadoRevision: 'aceptada', notificadoEn: new Date() },
    { id: R2, estadoRevision: 'aceptada' },
    { id: R3, estadoRevision: 'aceptada' },
  ]);
  assert.deepEqual(await svc.notificarSeleccion(EX, [R1, R2]), { aEnviar: 2 });
  assert.deepEqual(lotes, [{ ids: [R1, R2], forzar: true }]);
});

test('notificarSeleccion: sin elegidos es un 409; ids de otro examen, un 404; los pendientes de revisión no se mandan', async () => {
  const { svc, lotes } = notificacionesConRespuestas([{ id: R1, estadoRevision: 'aceptada' }, { id: R2, estadoRevision: 'pendiente' }]);
  await assert.rejects(() => svc.notificarSeleccion(EX, []), ConflictException);
  await assert.rejects(() => svc.notificarSeleccion(EX, [R3]), NotFoundException);
  await assert.rejects(() => svc.notificarSeleccion(EX, ['no-es-uuid']), NotFoundException);
  await assert.rejects(() => svc.notificarSeleccion(EX, [R2]), ConflictException);
  assert.deepEqual(await svc.notificarSeleccion(EX, [R1, R2]), { aEnviar: 1 });
  assert.deepEqual(lotes, [{ ids: [R1], forzar: true }]);
});

test('notificarSeleccionAlPublicar: manda a los elegidos que no lo recibieron todavía; lista vacía no manda ninguno', async () => {
  const { svc, lotes } = notificacionesConRespuestas([
    { id: R1, estadoRevision: 'aceptada', notificadoEn: new Date() },
    { id: R2, estadoRevision: 'aceptada' },
  ]);
  assert.deepEqual(await svc.notificarSeleccionAlPublicar(EX, [R1, R2]), { aEnviar: 1 });
  assert.deepEqual(lotes, [{ ids: [R2], forzar: false }]);
  assert.deepEqual(await svc.notificarSeleccionAlPublicar(EX, []), { aEnviar: 0 });
  assert.equal(lotes.length, 1);
});

// ---------------------------------------------------------------------------
// Eliminar una comisión: con el nombre escrito, y sin tocar las imágenes si el pedido se rechaza
// ---------------------------------------------------------------------------
import { ComisionesService } from '../src/comisiones/comisiones.service';
import { ControlComisionController } from '../src/respuestas-examen/control-comision.controller';

const COM = 'c1111111-1111-4111-8111-111111111111';

function comisionesConNombre(nombre: string | null) {
  const estado = { borrada: false };
  const tx: any = {
    $queryRaw: async () => [{ id: COM }],
    comision: { findUnique: async () => (nombre === null || estado.borrada ? null : { nombre }), delete: async () => void (estado.borrada = true) },
  };
  const prisma: any = {
    $transaction: async (fn: any) => fn(tx),
    comision: { findUnique: async () => (nombre === null ? null : { nombre }) },
    alumno: { count: async () => 12 },
    examenComision: { count: async () => 2 },
    respuestaExamen: { count: async () => 9 },
    intentoExamen: { count: async () => 3 },
  };
  return { svc: new ComisionesService(prisma), estado };
}

test('eliminar comisión: con el nombre bien escrito la borra (con sus alumnos y respuestas, por cascada)', async () => {
  const { svc, estado } = comisionesConNombre('Comisión A');
  await svc.validarEliminacion(COM, ' Comisión   A ');
  await svc.eliminar(COM, 'Comisión A');
  assert.ok(estado.borrada);
});

test('eliminar comisión: con el nombre mal escrito es un 400 y no se borra; si no existe o no es UUID, 404', async () => {
  const { svc, estado } = comisionesConNombre('Comisión A');
  await assert.rejects(() => svc.validarEliminacion(COM, 'comision a'), BadRequestException);
  await assert.rejects(() => svc.eliminar(COM, ''), BadRequestException);
  assert.ok(!estado.borrada);
  await assert.rejects(() => comisionesConNombre(null).svc.eliminar(COM, 'x'), NotFoundException);
  await assert.rejects(() => comisionesConNombre(null).svc.validarEliminacion(COM, 'x'), NotFoundException);
  await assert.rejects(() => svc.eliminar('no-es-uuid', 'x'), NotFoundException);
  await assert.rejects(() => svc.queSePierde('no-es-uuid'), NotFoundException);
});

test('queSePierde de una comisión: alumnos, links publicados, respuestas y quiénes están rindiendo ahora', async () => {
  assert.deepEqual(await comisionesConNombre('A').svc.queSePierde(COM), { alumnos: 12, publicaciones: 2, respuestas: 9, rindiendo: 3 });
});

test('DELETE /comisiones/:comisionId: accede, valida el nombre, borra las imágenes y recién ahí la comisión; con el nombre mal escrito las imágenes no se tocan', async () => {
  const llamadas: string[] = [];
  const acceso: any = { comision: async (d: string, c: string) => void llamadas.push(`acceso:${d}:${c}`) };
  const comisiones: any = {
    validarEliminacion: async (c: string, n: string) => void llamadas.push(`validar:${c}:${n}`),
    eliminar: async (c: string, n: string) => void llamadas.push(`eliminar:${c}:${n}`),
  };
  const integridad: any = { borrarImagenesDeComision: async (c: string) => void llamadas.push(`imagenes:${c}`) };
  const controller = new ControlComisionController(comisiones, integridad, acceso);
  await controller.eliminar('doc-1', COM, { confirmacion: 'Comisión A' });
  assert.deepEqual(llamadas, [`acceso:doc-1:${COM}`, `validar:${COM}:Comisión A`, `imagenes:${COM}`, `eliminar:${COM}:Comisión A`]);

  llamadas.length = 0;
  comisiones.validarEliminacion = async () => {
    throw new BadRequestException('mal');
  };
  await assert.rejects(() => controller.eliminar('doc-1', COM, { confirmacion: 'x' }), BadRequestException);
  assert.deepEqual(llamadas, [`acceso:doc-1:${COM}`]);

  llamadas.length = 0;
  acceso.comision = async () => {
    throw new NotFoundException('Comisión no encontrada');
  };
  await assert.rejects(() => controller.eliminar('doc-2', COM, { confirmacion: 'x' }), NotFoundException);
  assert.deepEqual(llamadas, [], 'un docente que no es del curso no llega ni a validar');
});
