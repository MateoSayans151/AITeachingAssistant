// Acceso abierto: un alumno puede entrar al link de un examen sin que el docente haya cargado su mail antes. Se agrega solo a la
// comisión (con el nombre que escribe), salvo que el link sea "solo lista", la ventana esté cerrada o la comisión llegue al tope.
// Corre sin base de datos ni red: el prisma es un falso en memoria.
//   node --require ts-node/register --test test/acceso-abierto.test.ts   (o `npm test`)
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IntentosService, MAX_ALUMNOS_ACCESO_ABIERTO, nombreDesdeEmail } from '../src/respuestas-examen/intentos.service';
import { IniciarIntentoDto } from '../src/respuestas-examen/dto/intento.dto';
import { PublicarComisionDto } from '../src/examenes/dto/publicar-comision.dto';
import { ExamenesService } from '../src/examenes/examenes.service';

const COMISION = 'com-1';
const dto = (alumnoEmail: string, alumnoNombre?: string) => ({ alumnoEmail, alumnoNombre }) as IniciarIntentoDto;
const ABIERTO = { comisionId: COMISION, accesoAbierto: true, fechaInicio: null, fechaFin: null };
const CERRADO = { ...ABIERTO, accesoAbierto: false };

/** Alumnos en memoria con el mismo comportamiento que importa: búsqueda sin distinguir mayúsculas, único por (comisión, email). */
function servicioConAlumnos(inicial: { id: string; email: string; nombre: string }[] = [], opciones: { carrera?: boolean } = {}) {
  const alumnos = inicial.map((a) => ({ ...a, comisionId: COMISION }));
  const creados: any[] = [];
  let fallos = 0;
  const prisma: any = {
    alumno: {
      findFirst: async ({ where }: any) => alumnos.find((a) => a.comisionId === where.comisionId && a.email.toLowerCase() === where.email.equals.toLowerCase()) ?? null,
      count: async () => alumnos.length,
      create: async ({ data }: any) => {
        if (opciones.carrera) {
          // Otra pestaña ganó la carrera: ya existe cuando este pedido intenta crear.
          alumnos.push({ id: 'ganador', ...data });
          const e: any = new Error('Unique constraint');
          e.code = 'P2002';
          throw e;
        }
        const nuevo = { id: `nuevo-${creados.length}`, ...data };
        alumnos.push(nuevo);
        creados.push(nuevo);
        return nuevo;
      },
    },
  };
  const svc = new IntentosService(prisma, {} as any, {} as any);
  (svc as any).fallosPorIp = { fallo: async () => void fallos++, verificar: async () => {} };
  return { svc, alumnos, creados, fallos: () => fallos };
}

test('nombreDesdeEmail: arma un nombre legible con la parte local del email', () => {
  assert.equal(nombreDesdeEmail('ana.perez@mail.com'), 'Ana Perez');
  assert.equal(nombreDesdeEmail('juan_carlos-gomez@mail.com'), 'Juan Carlos Gomez');
  assert.equal(nombreDesdeEmail('maria@mail.com'), 'Maria');
});

test('acceso abierto: un email que no está en la lista se agrega solo, con el nombre que escribió el alumno', async () => {
  const { svc, creados, fallos } = servicioConAlumnos();
  const alumno = await svc.resolverAlumno(ABIERTO, dto('nuevo@mail.com', 'Ana Pérez'), 'ip|1');
  assert.equal(alumno.email, 'nuevo@mail.com');
  assert.equal(alumno.nombre, 'Ana Pérez');
  assert.equal(creados.length, 1);
  assert.equal(creados[0].comisionId, COMISION);
  assert.ok(creados[0].codigoAcceso, 'la columna codigo_acceso es NOT NULL: se sigue generando');
  assert.equal(fallos(), 0, 'entrar por primera vez no cuenta como un intento fallido');
});

test('acceso abierto: sin nombre se arma uno con el email', async () => {
  const { svc } = servicioConAlumnos();
  assert.equal((await svc.resolverAlumno(ABIERTO, dto('luis.gomez@mail.com'), 'ip|1')).nombre, 'Luis Gomez');
  assert.equal((await svc.resolverAlumno(ABIERTO, dto('otro@mail.com', '   '), 'ip|1')).nombre, 'Otro');
});

test('acceso abierto: quien ya figura en la lista entra con su nombre cargado, aunque escriba otro, y no se duplica', async () => {
  const { svc, creados } = servicioConAlumnos([{ id: 'a1', email: 'Ana@Mail.com', nombre: 'Ana Pérez' }]);
  const alumno = await svc.resolverAlumno(ABIERTO, dto('ana@mail.com', 'Anita'), 'ip|1');
  assert.equal(alumno.id, 'a1');
  assert.equal(alumno.nombre, 'Ana Pérez');
  assert.equal(creados.length, 0);
});

test('solo lista: un email que no figura se rechaza y cuenta como intento fallido (como siempre)', async () => {
  const { svc, creados, fallos } = servicioConAlumnos();
  await assert.rejects(() => svc.resolverAlumno(CERRADO, dto('intruso@mail.com', 'Intruso'), 'ip|1'), UnauthorizedException);
  assert.equal(creados.length, 0);
  assert.equal(fallos(), 1);
});

test('solo lista: quien figura entra normalmente', async () => {
  const { svc } = servicioConAlumnos([{ id: 'a1', email: 'ana@mail.com', nombre: 'Ana' }]);
  assert.equal((await svc.resolverAlumno(CERRADO, dto('ANA@mail.com'), 'ip|1')).id, 'a1');
});

test('acceso abierto: con la ventana cerrada o sin abrir no se suman alumnos nuevos', async () => {
  const { svc, creados } = servicioConAlumnos();
  const cerrada = { ...ABIERTO, fechaFin: new Date(Date.now() - 60_000) };
  const sinAbrir = { ...ABIERTO, fechaInicio: new Date(Date.now() + 3_600_000) };
  await assert.rejects(() => svc.resolverAlumno(cerrada, dto('a@mail.com'), 'ip|1'), BadRequestException);
  await assert.rejects(() => svc.resolverAlumno(sinAbrir, dto('b@mail.com'), 'ip|1'), BadRequestException);
  assert.equal(creados.length, 0);
});

test('acceso abierto: al llegar al tope de alumnos de la comisión no se agregan más', async () => {
  const llenos = Array.from({ length: MAX_ALUMNOS_ACCESO_ABIERTO }, (_, i) => ({ id: `a${i}`, email: `a${i}@mail.com`, nombre: `A${i}` }));
  const { svc, creados } = servicioConAlumnos(llenos);
  await assert.rejects(() => svc.resolverAlumno(ABIERTO, dto('uno.mas@mail.com'), 'ip|1'), ConflictException);
  assert.equal(creados.length, 0);
  // Los que ya estaban siguen entrando aunque la comisión esté llena.
  assert.equal((await svc.resolverAlumno(ABIERTO, dto('a5@mail.com'), 'ip|1')).id, 'a5');
});

test('acceso abierto: dos pestañas entrando a la vez con el mismo email terminan en el mismo alumno', async () => {
  const { svc } = servicioConAlumnos([], { carrera: true });
  const alumno = await svc.resolverAlumno(ABIERTO, dto('carrera@mail.com', 'Carrera'), 'ip|1');
  assert.equal(alumno.id, 'ganador');
});

test('IniciarIntentoDto: el nombre es opcional, se limpia y tiene tope; el email se normaliza', async () => {
  const ok = plainToInstance(IniciarIntentoDto, { alumnoEmail: '  ANA@Mail.com ', alumnoNombre: '  Ana   Pérez  ' });
  assert.deepEqual(await validate(ok), []);
  assert.equal(ok.alumnoEmail, 'ana@mail.com');
  assert.equal(ok.alumnoNombre, 'Ana Pérez');
  assert.deepEqual(await validate(plainToInstance(IniciarIntentoDto, { alumnoEmail: 'ana@mail.com' })), [], 'sin nombre también vale');
  const largo = plainToInstance(IniciarIntentoDto, { alumnoEmail: 'ana@mail.com', alumnoNombre: 'x'.repeat(121) });
  assert.ok((await validate(largo)).length > 0, 'un nombre de más de 120 caracteres se rechaza');
});

test('publicar: por defecto el link queda con acceso abierto; el docente puede pedir solo lista', async () => {
  const guardados: any[] = [];
  const prisma: any = {
    examen: { findUnique: async () => ({ id: 'e1' }), update: async () => ({}) },
    comision: { findUnique: async () => ({ id: COMISION }) },
    examenComision: { create: async ({ data }: any) => (guardados.push(data), { ...data, id: 'ec1' }) },
    $transaction: async (ops: Promise<any>[]) => Promise.all(ops),
  };
  const svc = new ExamenesService(prisma, {} as any);
  await svc.publicarAComision('e1', { comisionId: COMISION } as PublicarComisionDto);
  await svc.publicarAComision('e1', { comisionId: COMISION, accesoAbierto: false } as PublicarComisionDto);
  assert.equal(guardados[0].accesoAbierto, true);
  assert.equal(guardados[1].accesoAbierto, false);
  const mal = await validate(plainToInstance(PublicarComisionDto, { comisionId: '3b241101-e2bb-4255-8caf-4136c566a962', accesoAbierto: 'si' }));
  assert.ok(mal.some((e) => e.property === 'accesoAbierto'), 'accesoAbierto tiene que ser booleano');
});
