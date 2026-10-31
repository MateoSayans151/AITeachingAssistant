// Tests de cursos con varios docentes: el acceso se decide por pertenencia al equipo (no por quién creó el curso), todos los miembros
// tienen los mismos permisos, el alta por email (cuenta existente o invitación), sacar a alguien sin dejar el curso vacío y
// la aceptación de invitaciones al registrarse. Corren sin red ni base de datos (Prisma simulado):
//   node --require ts-node/register --test test/cursos-equipo.test.ts
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AccesoService } from '../src/acceso/acceso.service';
import { SesionDocenteService } from '../src/auth/sesion-docente.service';
import { AgregarDocenteDto } from '../src/cursos/dto/agregar-docente.dto';
import { CursosService, MENSAJE_ULTIMO_DOCENTE } from '../src/cursos/cursos.service';

const CURSO = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const ANA = '11111111-1111-4111-8111-111111111111';
const BETO = '22222222-2222-4222-8222-222222222222';
const CARO = '33333333-3333-4333-8333-333333333333';

/** Prisma de mentira, en memoria, con lo justo que usan AccesoService, CursosService y SesionDocenteService. */
function prismaFalso(inicial: { miembros?: Array<{ cursoId: string; docenteId: string; createdAt?: Date }>; docentes?: Array<{ id: string; nombre: string; email: string }>; invitaciones?: Array<{ id: string; cursoId: string; email: string; invitadoPor?: string | null }>; docenteDelCurso?: string } = {}) {
  const miembros = [...(inicial.miembros ?? [])].map((m, i) => ({ createdAt: new Date(2026, 0, 1 + i), ...m }));
  const docentes = [...(inicial.docentes ?? [])];
  const invitaciones = [...(inicial.invitaciones ?? [])];
  const curso = { id: CURSO, docenteId: inicial.docenteDelCurso ?? ANA };
  const consultas: any[] = [];
  const api: any = {
    consultas,
    miembros,
    invitaciones,
    datosCurso: curso,
    curso_: {
      count: async (args: any) => {
        consultas.push(args);
        const pide = args.where?.equipo?.some?.docenteId;
        return miembros.some((m) => m.cursoId === args.where.id && m.docenteId === pide) ? 1 : 0;
      },
      findUniqueOrThrow: async () => curso,
      update: async ({ data }: any) => Object.assign(curso, data),
    },
    cursoDocente: {
      findMany: async ({ where }: any) => miembros.filter((m) => m.cursoId === where.cursoId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      upsert: async ({ where, create }: any) => {
        const k = where.cursoId_docenteId;
        if (!miembros.some((m) => m.cursoId === k.cursoId && m.docenteId === k.docenteId)) miembros.push({ ...create, createdAt: new Date() });
        return create;
      },
      delete: async ({ where }: any) => {
        const k = where.cursoId_docenteId;
        const i = miembros.findIndex((m) => m.cursoId === k.cursoId && m.docenteId === k.docenteId);
        if (i >= 0) miembros.splice(i, 1);
      },
      createMany: async ({ data }: any) => {
        for (const d of data) if (!miembros.some((m) => m.cursoId === d.cursoId && m.docenteId === d.docenteId)) miembros.push({ ...d, createdAt: new Date() });
      },
    },
    cursoInvitacion: {
      findMany: async ({ where }: any) => invitaciones.filter((i) => (where.email ? i.email === where.email : true)),
      upsert: async ({ where, create }: any) => {
        const k = where.cursoId_email;
        if (!invitaciones.some((i) => i.cursoId === k.cursoId && i.email === k.email)) invitaciones.push({ id: `inv-${invitaciones.length + 1}`, ...create });
      },
      deleteMany: async ({ where }: any) => {
        const antes = invitaciones.length;
        for (let i = invitaciones.length - 1; i >= 0; i--) {
          const inv = invitaciones[i];
          const coincide =
            (!where.id || (where.id.in ? where.id.in.includes(inv.id) : where.id === inv.id)) && (!where.cursoId || where.cursoId === inv.cursoId) && (!where.email || where.email === inv.email);
          if (coincide) invitaciones.splice(i, 1);
        }
        return { count: antes - invitaciones.length };
      },
    },
    docente: {
      findFirst: async ({ where }: any) => docentes.find((d) => d.email.toLowerCase() === where.email.equals.toLowerCase()) ?? null,
    },
    $transaction: async (arg: any) => (typeof arg === 'function' ? arg({ ...api, curso: api.curso_ }) : Promise.all(arg)),
  };
  // AccesoService usa prisma.curso.count; CursosService usa prisma.curso.update / findUniqueOrThrow dentro de la transacción.
  api.curso = api.curso_;
  return api;
}

// ---------------------------------------------------------------- acceso por equipo

test('el acceso al curso lo da pertenecer al equipo, no haberlo creado', async () => {
  const prisma = prismaFalso({ miembros: [{ cursoId: CURSO, docenteId: ANA }, { cursoId: CURSO, docenteId: BETO }] });
  const acceso = new AccesoService(prisma);
  await acceso.curso(ANA, CURSO);
  await acceso.curso(BETO, CURSO); // Beto no lo creó, pero está en el equipo: mismo acceso
  await assert.rejects(() => acceso.curso(CARO, CURSO), NotFoundException); // Caro no
  assert.deepEqual(prisma.consultas[0].where, { id: CURSO, equipo: { some: { docenteId: ANA } } });
});

test('el filtro de los listados usa la misma pertenencia al equipo', () => {
  assert.deepEqual(AccesoService.delEquipo(ANA), { equipo: { some: { docenteId: ANA } } });
});

// ---------------------------------------------------------------- alta por email

test('agregar a un docente que ya tiene cuenta lo suma al equipo en el acto y limpia su invitación', async () => {
  const prisma = prismaFalso({
    miembros: [{ cursoId: CURSO, docenteId: ANA }],
    docentes: [{ id: BETO, nombre: 'Beto', email: 'Beto@uade.edu.ar' }],
    invitaciones: [{ id: 'inv-0', cursoId: CURSO, email: 'beto@uade.edu.ar' }],
  });
  const r = await new CursosService(prisma).agregarDocente(CURSO, ANA, 'beto@uade.edu.ar');
  assert.equal(r.estado, 'agregado');
  assert.deepEqual(prisma.miembros.map((m: any) => m.docenteId), [ANA, BETO]);
  assert.equal(prisma.invitaciones.length, 0);
});

test('agregar a alguien sin cuenta deja una invitación; repetirlo no duplica ni falla', async () => {
  const prisma = prismaFalso({ miembros: [{ cursoId: CURSO, docenteId: ANA }] });
  const svc = new CursosService(prisma);
  assert.deepEqual(await svc.agregarDocente(CURSO, ANA, 'nueva@uade.edu.ar'), { estado: 'invitado', email: 'nueva@uade.edu.ar' });
  await svc.agregarDocente(CURSO, ANA, 'nueva@uade.edu.ar');
  assert.equal(prisma.invitaciones.length, 1);
  assert.equal(prisma.miembros.length, 1);
});

test('agregar dos veces al mismo docente no lo duplica', async () => {
  const prisma = prismaFalso({ miembros: [{ cursoId: CURSO, docenteId: ANA }], docentes: [{ id: BETO, nombre: 'Beto', email: 'beto@uade.edu.ar' }] });
  const svc = new CursosService(prisma);
  await svc.agregarDocente(CURSO, ANA, 'beto@uade.edu.ar');
  await svc.agregarDocente(CURSO, ANA, 'beto@uade.edu.ar');
  assert.equal(prisma.miembros.filter((m: any) => m.docenteId === BETO).length, 1);
});

test('el email se recorta y se pasa a minúsculas; uno inválido se rechaza', async () => {
  const ok = plainToInstance(AgregarDocenteDto, { email: '  Ana@UADE.edu.ar ' });
  assert.equal(ok.email, 'ana@uade.edu.ar');
  assert.equal((await validate(ok)).length, 0);
  for (const malo of ['no-es-email', '', 'a@', 5]) assert.ok((await validate(plainToInstance(AgregarDocenteDto, { email: malo }))).length > 0, String(malo));
});

// ---------------------------------------------------------------- sacar a alguien

test('se puede sacar a un docente mientras quede otro; el último no se puede sacar', async () => {
  const prisma = prismaFalso({ miembros: [{ cursoId: CURSO, docenteId: ANA }, { cursoId: CURSO, docenteId: BETO }] });
  const svc = new CursosService(prisma);
  await svc.quitarDocente(CURSO, BETO);
  assert.deepEqual(prisma.miembros.map((m: any) => m.docenteId), [ANA]);
  await assert.rejects(() => svc.quitarDocente(CURSO, ANA), (e: unknown) => e instanceof ConflictException && e.message === MENSAJE_ULTIMO_DOCENTE);
  assert.equal(prisma.miembros.length, 1);
});

test('sacar a alguien que no está en el equipo (o un id inválido) es 404', async () => {
  const svc = new CursosService(prismaFalso({ miembros: [{ cursoId: CURSO, docenteId: ANA }, { cursoId: CURSO, docenteId: BETO }] }));
  await assert.rejects(() => svc.quitarDocente(CURSO, CARO), NotFoundException);
  await assert.rejects(() => svc.quitarDocente(CURSO, 'basura'), NotFoundException);
});

test('si se va quien creó el curso, el docente de referencia pasa al miembro más antiguo que queda', async () => {
  const prisma = prismaFalso({
    docenteDelCurso: ANA,
    miembros: [{ cursoId: CURSO, docenteId: ANA }, { cursoId: CURSO, docenteId: BETO }, { cursoId: CURSO, docenteId: CARO }],
  });
  await new CursosService(prisma).quitarDocente(CURSO, ANA);
  assert.equal(prisma.datosCurso.docenteId, BETO);
});

test('sacar una invitación que no existe es 404 y no toca las de otro curso', async () => {
  const prisma = prismaFalso({ invitaciones: [{ id: '44444444-4444-4444-8444-444444444444', cursoId: 'otro-curso', email: 'x@x.com' }] });
  await assert.rejects(() => new CursosService(prisma).quitarInvitacion(CURSO, '44444444-4444-4444-8444-444444444444'), NotFoundException);
  assert.equal(prisma.invitaciones.length, 1);
});

// ---------------------------------------------------------------- invitaciones al registrarse

test('al registrarse por primera vez con un email invitado, el docente entra a esos cursos', async () => {
  const prisma: any = prismaFalso({
    invitaciones: [
      { id: 'i1', cursoId: CURSO, email: 'nueva@uade.edu.ar', invitadoPor: ANA },
      { id: 'i2', cursoId: 'otro', email: 'otra@uade.edu.ar', invitadoPor: ANA },
    ],
  });
  prisma.docente = {
    findUnique: async () => null,
    findFirst: async () => null,
    create: async ({ data }: any) => ({ id: CARO, ...data }),
  };
  const id = await new SesionDocenteService(prisma).resolver({ sub: 'auth-1', email: 'Nueva@UADE.edu.ar', user_metadata: { email_verified: true } });
  assert.equal(id, CARO);
  assert.deepEqual(prisma.miembros.map((m: any) => [m.cursoId, m.docenteId, m.agregadoPor]), [[CURSO, CARO, ANA]]);
  assert.deepEqual(prisma.invitaciones.map((i: any) => i.id), ['i2']); // la de otro email sigue pendiente
});

test('si falla aceptar las invitaciones, el docente entra igual', async () => {
  const prisma: any = prismaFalso();
  prisma.cursoInvitacion.findMany = async () => {
    throw new Error('base caída');
  };
  prisma.docente = { findUnique: async () => null, findFirst: async () => null, create: async ({ data }: any) => ({ id: CARO, ...data }) };
  assert.equal(await new SesionDocenteService(prisma).resolver({ sub: 'auth-2', email: 'a@b.com', user_metadata: { email_verified: true } }), CARO);
});
