// Tests del puntaje total del examen (tiene que ser igual a la escala máxima) y de borrar un examen (solo si nadie empezó ni
// entregó). Corren sin base de datos, con dobles de Prisma hechos a mano:
//   npm test
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BadRequestException, ConflictException, ExecutionContext, NotFoundException, RequestMethod, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '../src/auth/auth.guard';
import { IS_PUBLIC_KEY } from '../src/auth/public.decorator';
import { VerificadorSesion } from '../src/auth/verificador-sesion';
import { ExamenesController } from '../src/examenes/examenes.controller';
import { ExamenesService, MENSAJE_EXAMEN_CON_ALUMNOS } from '../src/examenes/examenes.service';
import { mismoPuntaje, puntajeDeCriterios, puntajeEfectivo, puntajeTotalExamen, redondearPuntaje, validarPuntajes } from '../src/examenes/puntaje.util';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const cerrada = (puntaje: number): any => ({
  tipo: 'opcion_multiple',
  enunciado: 'Elegí',
  puntajeMaximo: puntaje,
  opciones: [{ id: 'a', texto: 'A', correcta: true }, { id: 'b', texto: 'B', correcta: false }],
});
// `declarado` es el puntaje que escribió el docente en la pregunta; `criterios`, los puntos de cada criterio de la rúbrica.
const abierta = (declarado: number, criterios: number[]): any => ({
  tipo: 'desarrollo',
  enunciado: 'Explicá',
  puntajeMaximo: declarado,
  criterios: criterios.map((puntajeMaximo, i) => ({ nombre: `Criterio ${i + 1}`, descripcion: 'Qué se espera', puntajeMaximo })),
});
const dtoDe = (preguntas: any[], extra: Record<string, unknown> = {}): any => ({
  cursoId: 'curso-1',
  titulo: 'Parcial',
  consigna: 'Consigna',
  modalidad: 'ventana_dias',
  escalaMin: 0,
  escalaMax: 10,
  niveles: [1, 2, 3, 4, 5].map((orden) => ({ orden, nombre: `N${orden}`, colorHex: '#000000', porcentaje: orden * 20 })),
  feedbackModo: 'manual',
  preguntas,
  ...extra,
});

function servicioConPrisma() {
  const creados: any[] = [];
  const prisma = {
    examen: {
      create: async ({ data }: any) => {
        creados.push(data);
        return { id: 'ex-1', ...data };
      },
    },
  } as any;
  return { svc: new ExamenesService(prisma, {} as any), creados };
}

// Crea por el servicio y devuelve la excepción (o null si lo creó). `create` valida de forma síncrona: se envuelve en async.
async function crear(dto: any) {
  const { svc, creados } = servicioConPrisma();
  try {
    await (async () => svc.create(dto))();
    return { error: null as any, creados };
  } catch (error) {
    return { error, creados };
  }
}
const mensajeDe = (error: any) => (error?.getResponse?.() as any)?.message;
const msgTotal = (total: string, escala: string) =>
  `El puntaje total del examen (${total}) tiene que ser igual a la escala máxima (${escala}). Ajustá los puntajes o la escala.`;

// ---------------------------------------------------------------------------
// 1. Funciones puras
// ---------------------------------------------------------------------------
test('puntajeEfectivo: las cerradas valen su puntaje; las abiertas, la suma de sus criterios (no lo que declaran)', () => {
  assert.equal(puntajeEfectivo(cerrada(4)), 4);
  assert.equal(puntajeEfectivo(abierta(10, [3, 4])), 7, 'manda la suma de los criterios');
  assert.equal(puntajeEfectivo({ ...cerrada(5), criterios: [{ puntajeMaximo: 99 }] }), 5, 'una cerrada ignora sus criterios');
  assert.equal(puntajeEfectivo({ tipo: 'desarrollo', puntajeMaximo: 6 }), 0, 'una abierta sin criterios no suma nada');
  for (const tipo of ['numerica', 'relacionar_pares', 'casillas', 'verdadero_falso']) {
    assert.equal(puntajeEfectivo({ tipo, puntajeMaximo: 2.5 }), 2.5, tipo);
  }
  for (const tipo of ['resolucion_problema', 'demostracion', 'analisis_caso', 'respuesta_corta']) {
    assert.equal(puntajeEfectivo({ tipo, puntajeMaximo: 9, criterios: [{ puntajeMaximo: 1 }, { puntajeMaximo: 2 }] }), 3, tipo);
  }
});

test('redondeo: la suma de decimales no arrastra ruido de coma flotante (0,1 + 0,2 es 0,3)', () => {
  assert.notEqual(0.1 + 0.2, 0.3, 'precondición: en coma flotante no son iguales');
  assert.equal(redondearPuntaje(0.1 + 0.2), 0.3);
  assert.equal(puntajeDeCriterios({ criterios: [{ puntajeMaximo: 0.1 }, { puntajeMaximo: 0.2 }] }), 0.3);
  assert.equal(puntajeTotalExamen([cerrada(0.1), cerrada(0.2)]), 0.3);
  assert.equal(mismoPuntaje(0.1 + 0.2, 0.3), true);
  assert.equal(puntajeTotalExamen([cerrada(3.33), cerrada(3.33), cerrada(3.34)]), 10);
});

test('mismoPuntaje: perdona hasta 0,01 y no más', () => {
  assert.equal(mismoPuntaje(10, 10), true);
  assert.equal(mismoPuntaje(10.004, 10), true);
  assert.equal(mismoPuntaje(10.01, 10), true, 'justo en el borde de la tolerancia');
  assert.equal(mismoPuntaje(10.02, 10), false);
  assert.equal(mismoPuntaje(9.98, 10), false);
  assert.equal(mismoPuntaje(23, 10), false);
});

test('validarPuntajes: null si todo cierra, y el mensaje del primer problema si no', () => {
  assert.equal(validarPuntajes([cerrada(4), cerrada(6)], 10), null);
  assert.equal(validarPuntajes([cerrada(4), abierta(6, [2, 4])], 10), null);
  assert.equal(validarPuntajes([cerrada(4), cerrada(6.5)], 10), msgTotal('10,5', '10'), 'los decimales van con coma');
  // (a) se reporta antes que (b), aunque el total también esté mal.
  assert.equal(
    validarPuntajes([cerrada(1), abierta(8, [3, 3])], 10),
    'La pregunta 2: el puntaje (8) tiene que ser la suma de los puntajes de sus criterios (6).',
  );
});

// ---------------------------------------------------------------------------
// 2. ExamenesService.create: las reglas de puntaje a través del servicio
// ---------------------------------------------------------------------------
test('create: acepta un examen cuyas preguntas suman justo la escala máxima', async () => {
  const { error, creados } = await crear(dtoDe([cerrada(4), cerrada(6)]));
  assert.equal(error, null);
  assert.equal(creados.length, 1);
  assert.equal(creados[0].escalaMax, 10);
});

test('create: si los puntos sobran (23 con escala 0-10) se rechaza con 400 y no se crea nada', async () => {
  const { error, creados } = await crear(dtoDe([cerrada(10), cerrada(8), cerrada(5)]));
  assert.ok(error instanceof BadRequestException, String(error));
  assert.equal(mensajeDe(error), msgTotal('23', '10'));
  assert.equal(creados.length, 0);
});

test('create: si los puntos faltan también se rechaza, con el total real en el mensaje', async () => {
  const { error, creados } = await crear(dtoDe([cerrada(3), cerrada(4)]));
  assert.ok(error instanceof BadRequestException);
  assert.equal(mensajeDe(error), msgTotal('7', '10'));
  assert.equal(creados.length, 0);
});

test('create: el total se compara contra la escala máxima del examen, no contra 10', async () => {
  assert.equal((await crear(dtoDe([cerrada(50), cerrada(50)], { escalaMax: 100 }))).error, null);
  assert.equal((await crear(dtoDe([cerrada(2.5), cerrada(5)], { escalaMax: 7.5 }))).error, null);
  assert.equal((await crear(dtoDe([cerrada(5), cerrada(5)], { escalaMax: 100 }))).error?.getResponse().message, msgTotal('10', '100'));
  // Con escala que no arranca en 0 el total igual tiene que ser la escala máxima.
  assert.equal((await crear(dtoDe([cerrada(5), cerrada(5)], { escalaMin: 1, escalaMax: 10 }))).error, null);
});

test('create: redondeo — 0,1 + 0,2 es 0,3 y los terceros no generan falsos rechazos', async () => {
  assert.equal((await crear(dtoDe([cerrada(0.1), cerrada(0.2)], { escalaMax: 0.3 }))).error, null);
  assert.equal((await crear(dtoDe([cerrada(0.1), cerrada(0.2), cerrada(9.7)]))).error, null);
  assert.equal((await crear(dtoDe([cerrada(3.3333), cerrada(3.3333), cerrada(3.3334)]))).error, null);
  assert.equal((await crear(dtoDe([abierta(0.3, [0.1, 0.2]), cerrada(9.7)]))).error, null, 'y en los criterios de una abierta');
  // Más de un centésimo de diferencia ya no se perdona.
  assert.ok((await crear(dtoDe([cerrada(4), cerrada(6.05)]))).error instanceof BadRequestException);
  assert.equal(mensajeDe((await crear(dtoDe([cerrada(4), cerrada(6.05)]))).error), msgTotal('10,05', '10'));
});

test('create: mezcla de cerradas y abiertas — las abiertas valen la suma de sus criterios', async () => {
  const bien = await crear(dtoDe([cerrada(2), abierta(5, [2, 3]), cerrada(1), abierta(2, [1, 0.5, 0.5])]));
  assert.equal(bien.error, null);
  assert.equal(bien.creados.length, 1);
  assert.equal(bien.creados[0].preguntas.create.length, 4);

  const falta = await crear(dtoDe([cerrada(2), abierta(5, [2, 3]), cerrada(1), abierta(1, [0.5, 0.5])]));
  assert.equal(mensajeDe(falta.error), msgTotal('9', '10'));

  const sobra = await crear(dtoDe([cerrada(2), abierta(5, [2, 3]), cerrada(1), abierta(3, [1, 1, 1])]));
  assert.equal(mensajeDe(sobra.error), msgTotal('11', '10'));
});

test('create: una abierta con puntaje declarado distinto de la suma de sus criterios se rechaza (diga la pregunta que es)', async () => {
  // Declara 8 pero sus criterios suman 6 (aunque el declarado, 4 + 8, "cierre" con la escala: manda la suma de criterios).
  const r = await crear(dtoDe([cerrada(2), abierta(8, [3, 3])]));
  assert.ok(r.error instanceof BadRequestException);
  assert.equal(mensajeDe(r.error), 'La pregunta 2: el puntaje (8) tiene que ser la suma de los puntajes de sus criterios (6).');
  assert.equal(r.creados.length, 0);

  // Declarado menor que la suma, en la primera pregunta, con decimales.
  const r2 = await crear(dtoDe([abierta(4, [2.5, 2]), cerrada(5.5)]));
  assert.equal(mensajeDe(r2.error), 'La pregunta 1: el puntaje (4) tiene que ser la suma de los puntajes de sus criterios (4,5).');

  // Declarado y criterios coinciden: pasa.
  assert.equal((await crear(dtoDe([abierta(8, [3, 5]), cerrada(2)]))).error, null);
});

test('create: las reglas que ya existían siguen primero (criterios obligatorios, escala mínima < máxima)', async () => {
  const sinCriterios = await crear(dtoDe([cerrada(4), { tipo: 'desarrollo', enunciado: 'x', puntajeMaximo: 6, criterios: [] }]));
  assert.equal(mensajeDe(sinCriterios.error), 'La pregunta 2 (desarrollo) necesita al menos un criterio de rúbrica');
  const sinOpciones = await crear(dtoDe([{ tipo: 'opcion_multiple', enunciado: 'x', puntajeMaximo: 10 }]));
  assert.equal(mensajeDe(sinOpciones.error), 'La pregunta 1 (opcion_multiple) necesita "opciones" con la clave correcta');
  const escalaMal = await crear(dtoDe([cerrada(10)], { escalaMin: 10, escalaMax: 0 }));
  assert.equal(mensajeDe(escalaMal.error), 'La escala mínima tiene que ser menor que la máxima');
  const aprobacion = await crear(dtoDe([cerrada(10)], { distribucionEsperada: { umbralAprobacion: 11, aprobadosEsperadosPct: 60 } }));
  assert.equal(mensajeDe(aprobacion.error), 'La nota de aprobación tiene que estar dentro de la escala');
});

// ---------------------------------------------------------------------------
// 3. ExamenesService.findOne: trae cuántos alumnos empezaron o entregaron
// ---------------------------------------------------------------------------
test('findOne: incluye _count de respuestas e intentos sin sacar lo que ya devolvía', async () => {
  let consulta: any;
  const examen = { id: 'ex-1', preguntas: [], comisiones: [], _count: { respuestas: 2, intentos: 3 } };
  const prisma = { examen: { findUnique: async (args: any) => ((consulta = args), examen) } } as any;
  const r = await new ExamenesService(prisma, {} as any).findOne('ex-1');
  assert.deepEqual(r._count, { respuestas: 2, intentos: 3 });
  assert.deepEqual(consulta.include._count, { select: { respuestas: true, intentos: true } });
  assert.ok(consulta.include.preguntas && consulta.include.comisiones, 'sigue trayendo preguntas y comisiones');
  await assert.rejects(() => new ExamenesService({ examen: { findUnique: async () => null } } as any, {} as any).findOne('x'), NotFoundException);
});

// ---------------------------------------------------------------------------
// 4. ExamenesService.remove: solo si nadie empezó ni entregó, todo dentro de una transacción con la fila bloqueada
// ---------------------------------------------------------------------------
const EX_LIMPIO = '11111111-1111-4111-8111-111111111111';
const EX_CON_RESPUESTAS = '22222222-2222-4222-8222-222222222222';
const EX_CON_INTENTOS = '33333333-3333-4333-8333-333333333333';
const EX_CON_AMBOS = '44444444-4444-4444-8444-444444444444';

function prismaBorrado() {
  const estado = {
    examenes: [EX_LIMPIO, EX_CON_RESPUESTAS, EX_CON_INTENTOS, EX_CON_AMBOS].map((id) => ({ id })),
    respuestas: [{ examenId: EX_CON_RESPUESTAS }, { examenId: EX_CON_RESPUESTAS }, { examenId: EX_CON_AMBOS }],
    intentos: [{ examenId: EX_CON_INTENTOS }, { examenId: EX_CON_AMBOS }],
  };
  const llamadas: string[] = [];
  // Solo la transacción tiene tablas: si el servicio consultara fuera de ella, el doble explota (no hay bloqueo ni atomicidad).
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...valores: unknown[]) => {
      assert.match(strings.join('?'), /FROM examenes WHERE id = \?::uuid FOR UPDATE/, 'bloquea la fila del examen');
      llamadas.push('lock');
      return estado.examenes.filter((e) => e.id === valores[0]).map((e) => ({ id: e.id }));
    },
    respuestaExamen: {
      count: async ({ where }: any) => (llamadas.push('count:respuestas'), estado.respuestas.filter((r) => r.examenId === where.examenId).length),
    },
    intentoExamen: {
      count: async ({ where }: any) => (llamadas.push('count:intentos'), estado.intentos.filter((i) => i.examenId === where.examenId).length),
    },
    examen: {
      delete: async ({ where }: any) => {
        llamadas.push('delete');
        estado.examenes = estado.examenes.filter((e) => e.id !== where.id);
      },
    },
  };
  const prisma = { $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(tx) } as any;
  return { svc: new ExamenesService(prisma, {} as any), estado, llamadas };
}

test('remove: borra un examen limpio (bloquea la fila, cuenta respuestas e intentos y recién ahí borra, en ese orden)', async () => {
  const { svc, estado, llamadas } = prismaBorrado();
  assert.equal(await svc.remove(EX_LIMPIO), undefined);
  assert.deepEqual(llamadas, ['lock', 'count:respuestas', 'count:intentos', 'delete']);
  assert.deepEqual(estado.examenes.map((e) => e.id).sort(), [EX_CON_RESPUESTAS, EX_CON_INTENTOS, EX_CON_AMBOS].sort(), 'solo se fue ese');
});

test('remove: con respuestas responde 409 con el motivo y no borra nada', async () => {
  const { svc, estado, llamadas } = prismaBorrado();
  await assert.rejects(
    () => svc.remove(EX_CON_RESPUESTAS),
    (err: unknown) =>
      err instanceof ConflictException &&
      (err.getResponse() as any).message === 'Este examen ya tiene alumnos que empezaron o entregaron: no se puede borrar para no perder sus respuestas.',
  );
  assert.equal(MENSAJE_EXAMEN_CON_ALUMNOS, 'Este examen ya tiene alumnos que empezaron o entregaron: no se puede borrar para no perder sus respuestas.');
  assert.ok(!llamadas.includes('delete'));
  assert.equal(estado.examenes.length, 4);
});

test('remove: con intentos (alumnos que empezaron y todavía no entregaron) responde 409 y no borra nada', async () => {
  const { svc, estado, llamadas } = prismaBorrado();
  await assert.rejects(() => svc.remove(EX_CON_INTENTOS), ConflictException);
  await assert.rejects(() => svc.remove(EX_CON_AMBOS), ConflictException);
  assert.ok(!llamadas.includes('delete'));
  assert.equal(estado.examenes.length, 4);
});

test('remove: un examen que no existe (o un id que no es UUID) responde 404 sin intentar borrar', async () => {
  const { svc, llamadas } = prismaBorrado();
  await assert.rejects(() => svc.remove('99999999-9999-4999-8999-999999999999'), NotFoundException);
  assert.deepEqual(llamadas, ['lock']);
  llamadas.length = 0;
  await assert.rejects(() => svc.remove('no-es-uuid'), NotFoundException);
  assert.deepEqual(llamadas, [], 'ni siquiera abre la transacción');
});

// ---------------------------------------------------------------------------
// 5. ExamenesController.remove: DELETE /examenes/:id → 204, con el chequeo de acceso antes de borrar
// ---------------------------------------------------------------------------
function controladorConDobles() {
  const llamadas: string[] = [];
  const acceso = { examen: async (docenteId: string, examenId: string) => void llamadas.push(`acceso:${docenteId}:${examenId}`) };
  const service = { remove: async (id: string) => void llamadas.push(`remove:${id}`) };
  return { controller: new ExamenesController(service as any, {} as any, acceso as any, {} as any), acceso, service, llamadas };
}

test('DELETE /examenes/:id: es DELETE, responde 204 y no es público', () => {
  const remove = ExamenesController.prototype.remove;
  assert.equal(Reflect.getMetadata('method', remove), RequestMethod.DELETE);
  assert.equal(Reflect.getMetadata('path', remove), ':id');
  assert.equal(Reflect.getMetadata('__httpCode__', remove), 204);
  assert.ok(!Reflect.getMetadata(IS_PUBLIC_KEY, remove) && !Reflect.getMetadata(IS_PUBLIC_KEY, ExamenesController), 'exige sesión de docente');
});

test('DELETE /examenes/:id: sin token responde 401 (la ruta pasa por el AuthGuard de siempre)', async () => {
  const guard = new AuthGuard(
    new VerificadorSesion({ get: (k: string) => ({ SUPABASE_URL: 'https://proyecto-test.supabase.co', SUPABASE_JWT_SECRET: 's'.repeat(40) })[k] } as any),
    { resolver: async () => 'doc-1' } as any,
    new Reflector(),
  );
  const req: any = { headers: {} };
  const ctx = {
    getHandler: () => ExamenesController.prototype.remove,
    getClass: () => ExamenesController,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  await assert.rejects(() => guard.canActivate(ctx), UnauthorizedException);
});

test('DELETE /examenes/:id: exige el acceso al examen ANTES de borrar y no devuelve cuerpo', async () => {
  const { controller, llamadas } = controladorConDobles();
  assert.equal(await controller.remove('doc-1', 'ex-1'), undefined);
  assert.deepEqual(llamadas, ['acceso:doc-1:ex-1', 'remove:ex-1']);
});

test('DELETE /examenes/:id: un examen ajeno o inexistente responde 404 y no se borra nada', async () => {
  const { controller, acceso, llamadas } = controladorConDobles();
  acceso.examen = async (docenteId: string, examenId: string) => {
    llamadas.push(`acceso:${docenteId}:${examenId}`);
    throw new NotFoundException('Examen no encontrado');
  };
  await assert.rejects(() => controller.remove('doc-2', 'ex-1'), NotFoundException);
  assert.deepEqual(llamadas, ['acceso:doc-2:ex-1'], 'el servicio ni se entera');
});

test('DELETE /examenes/:id: el 409 del servicio le llega tal cual al docente', async () => {
  const { controller, service } = controladorConDobles();
  service.remove = async () => {
    throw new ConflictException(MENSAJE_EXAMEN_CON_ALUMNOS);
  };
  await assert.rejects(
    () => controller.remove('doc-1', 'ex-1'),
    (err: unknown) => err instanceof ConflictException && (err.getResponse() as any).message === MENSAJE_EXAMEN_CON_ALUMNOS,
  );
});
