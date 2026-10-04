// Tests del circuito del resultado del alumno: a quién hay que notificarle, qué contenido sale en su mail, publicar notas (idempotente) y email sin distinguir mayúsculas. Corren sin base de datos:
//   npm test
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { ExamenesService } from '../src/examenes/examenes.service';
import { IntentosService } from '../src/respuestas-examen/intentos.service';
import { IniciarIntentoDto } from '../src/respuestas-examen/dto/intento.dto';
import { armarResultadoParaAlumno, debeNotificarse, normalizarEmail } from '../src/respuestas-examen/resultado.util';

// ---------------------------------------------------------------------------
// 1. Regla: ¿a este alumno hay que notificarle el resultado?
// ---------------------------------------------------------------------------
test('debeNotificarse: necesita respuesta revisada Y notas publicadas (o feedback inmediato)', () => {
  const liberado = new Date('2030-01-01T10:00:00Z');
  const casos: Array<{ revision: string; modo: string; liberadoEn: Date | null; esperado: boolean }> = [
    // Pendiente de revisión: nunca, ni publicado ni inmediato (la nota todavía es solo una sugerencia de la IA).
    { revision: 'pendiente', modo: 'manual', liberadoEn: null, esperado: false },
    { revision: 'pendiente', modo: 'manual', liberadoEn: liberado, esperado: false },
    { revision: 'pendiente', modo: 'inmediato', liberadoEn: null, esperado: false },
    { revision: 'pendiente', modo: 'inmediato', liberadoEn: liberado, esperado: false },
    // Revisada (aceptada o editada): depende de que el docente haya publicado, o del modo.
    { revision: 'aceptada', modo: 'manual', liberadoEn: null, esperado: false },
    { revision: 'editada', modo: 'manual', liberadoEn: null, esperado: false },
    { revision: 'aceptada', modo: 'manual', liberadoEn: liberado, esperado: true },
    { revision: 'editada', modo: 'manual', liberadoEn: liberado, esperado: true },
    { revision: 'aceptada', modo: 'inmediato', liberadoEn: null, esperado: true },
    { revision: 'editada', modo: 'inmediato', liberadoEn: null, esperado: true },
    { revision: 'aceptada', modo: 'inmediato', liberadoEn: liberado, esperado: true },
  ];
  for (const c of casos) {
    const r = debeNotificarse({ estadoRevision: c.revision }, { feedbackModo: c.modo, feedbackLiberadoEn: c.liberadoEn });
    assert.equal(r, c.esperado, `${c.revision} / ${c.modo} / liberado=${!!c.liberadoEn}`);
  }
});

// ---------------------------------------------------------------------------
// 2. Contenido del mail: solo lo del alumno, nunca la clave ni lo interno de la IA
// ---------------------------------------------------------------------------
const examenDb = {
  id: 'ex-1',
  titulo: 'Parcial 1',
  escalaMin: new Prisma.Decimal(0),
  escalaMax: new Prisma.Decimal(10),
  niveles: [{ nombre: 'SECRETO_NIVELES' }],
  distribucionEsperada: { umbralAprobacion: 6, aprobadosEsperadosPct: 70 },
  antiCheat: { pegado: true },
  feedbackModo: 'manual',
  feedbackLiberadoEn: new Date(),
};
const preguntasDb = [
  { id: 'p1', enunciado: '¿Qué es un índice?', puntajeMaximo: new Prisma.Decimal(4), tipo: 'opcion_multiple', opciones: [{ id: 'a', texto: 'A', correcta: true }] },
  { id: 'p2', enunciado: 'Explicá la normalización', puntajeMaximo: new Prisma.Decimal('6'), tipo: 'desarrollo', criterios: [{ nombre: 'CRITERIO_INTERNO' }] },
];
const respuestaDb = {
  id: 'r-1',
  alumnoId: 'al-1',
  modeloIa: 'MODELO_IA',
  respuestasPorPregunta: [
    { preguntaId: 'p1', contenidoRespuesta: 'RESPUESTA_DE_OTRO', notaSugerida: 1, notaFinal: 4, correcta: true },
    {
      preguntaId: 'p2',
      contenidoRespuesta: 'texto',
      notaSugerida: 2.5,
      notaFinal: 3.5,
      notaPorCriterio: [{ criterioId: 'c1', nombre: 'CRITERIO_INTERNO', nivelSugerido: 3, notaSugerida: 2.5, comentario: 'COMENTARIO_IA' }],
    },
  ],
  notaTotalSugerida: new Prisma.Decimal('3.5'),
  notaConVara: new Prisma.Decimal('9.99'),
  ajusteVaraId: 'AJUSTE_VARA',
  feedbackGeneralSugerido: 'SUGERIDO_IA',
  notaTotalFinal: new Prisma.Decimal('7.5'),
  feedbackGeneralFinal: 'Muy buen trabajo.',
  estadoRevision: 'aceptada',
};

test('armarResultadoParaAlumno: solo título, nota final, escala, feedback y detalle por pregunta', () => {
  const r = armarResultadoParaAlumno(examenDb, preguntasDb, respuestaDb);
  assert.deepEqual(r, {
    titulo: 'Parcial 1',
    notaFinal: 7.5,
    escala: { min: 0, max: 10 },
    feedback: 'Muy buen trabajo.',
    porPregunta: [
      { enunciado: '¿Qué es un índice?', notaFinal: 4, puntajeMaximo: 4 },
      { enunciado: 'Explicá la normalización', notaFinal: 3.5, puntajeMaximo: 6 },
    ],
  });
});

test('armarResultadoParaAlumno: no filtra clave, nota sugerida/con vara ni criterios de la IA', () => {
  const json = JSON.stringify(armarResultadoParaAlumno(examenDb, preguntasDb, respuestaDb));
  const prohibidos = [
    'correcta', 'opciones', 'SECRETO_NIVELES', 'niveles', 'distribucionEsperada', 'antiCheat', 'RESPUESTA_DE_OTRO', 'contenidoRespuesta',
    'notaSugerida', 'notaTotalSugerida', 'SUGERIDO_IA', 'notaConVara', '9.99', 'AJUSTE_VARA', 'MODELO_IA',
    'CRITERIO_INTERNO', 'COMENTARIO_IA', 'notaPorCriterio', 'criterios', 'alumnoId', 'al-1',
  ];
  for (const p of prohibidos) assert.ok(!json.includes(p), `el contenido del mail filtra "${p}": ${json}`);
});

test('armarResultadoParaAlumno: la nota es la del docente, no la sugerida; sin feedback sale null y lo no corregido cuenta 0', () => {
  const r = armarResultadoParaAlumno(
    { titulo: 'T', escalaMin: 1, escalaMax: '10' },
    preguntasDb,
    { notaTotalFinal: 8, feedbackGeneralFinal: null, respuestasPorPregunta: [{ preguntaId: 'p1', notaFinal: 4, notaSugerida: 0 }] },
  );
  assert.equal(r.notaFinal, 8);
  assert.equal(r.feedback, null);
  assert.deepEqual(r.escala, { min: 1, max: 10 });
  assert.deepEqual(r.porPregunta.map((p) => p.notaFinal), [4, 0]);
  // Lo que viene de la base como Decimal/float binario no se muestra con ruido (4.3999999...).
  assert.equal(armarResultadoParaAlumno({ titulo: 'T', escalaMin: 0, escalaMax: 10 }, [], { notaTotalFinal: 4.3999999999, feedbackGeneralFinal: null, respuestasPorPregunta: [] }).notaFinal, 4.4);
});

// ---------------------------------------------------------------------------
// 3. Publicar las notas: idempotente, conserva la fecha original y avisa cuántas faltan revisar
// ---------------------------------------------------------------------------
function prismaExamenes(examenes: any[], respuestas: any[] = []) {
  return {
    examen: {
      // Igual que la base: solo actualiza las filas que cumplen el filtro (feedbackLiberadoEn: null).
      updateMany: async ({ where, data }: any) => {
        const filas = examenes.filter((e) => e.id === where.id && (!('feedbackLiberadoEn' in where) || e.feedbackLiberadoEn === where.feedbackLiberadoEn));
        for (const f of filas) Object.assign(f, data);
        return { count: filas.length };
      },
      findUnique: async ({ where }: any) => examenes.find((e) => e.id === where.id) ?? null,
    },
    respuestaExamen: {
      count: async ({ where }: any) => respuestas.filter((r) => r.examenId === where.examenId && r.estadoRevision === where.estadoRevision).length,
    },
  } as any;
}

test('liberarFeedback: setea la fecha y devuelve cuántas respuestas siguen sin revisar', async () => {
  const examenes = [{ id: 'ex-1', titulo: 'P1', feedbackLiberadoEn: null }];
  const respuestas = [
    { examenId: 'ex-1', estadoRevision: 'pendiente' },
    { examenId: 'ex-1', estadoRevision: 'pendiente' },
    { examenId: 'ex-1', estadoRevision: 'aceptada' },
    { examenId: 'ex-2', estadoRevision: 'pendiente' }, // de otro examen: no cuenta
  ];
  const r = await new ExamenesService(prismaExamenes(examenes, respuestas)).liberarFeedback('ex-1');
  assert.ok(r.feedbackLiberadoEn instanceof Date);
  assert.equal(r.pendientesDeRevision, 2);
  assert.equal(r.titulo, 'P1');
});

test('liberarFeedback: es idempotente, la segunda vez conserva la fecha original', async () => {
  const original = new Date('2030-01-01T10:00:00Z');
  const examenes = [{ id: 'ex-1', feedbackLiberadoEn: original }];
  const respuestas = [{ examenId: 'ex-1', estadoRevision: 'pendiente' }, { examenId: 'ex-1', estadoRevision: 'aceptada' }];
  const svc = new ExamenesService(prismaExamenes(examenes, respuestas));
  const r = await svc.liberarFeedback('ex-1');
  assert.equal(r.feedbackLiberadoEn?.getTime(), original.getTime());
  assert.equal(r.pendientesDeRevision, 1);

  // Dos veces seguidas desde cero: la fecha de la primera es la que queda.
  const nuevo = [{ id: 'ex-2', feedbackLiberadoEn: null }];
  const svc2 = new ExamenesService(prismaExamenes(nuevo));
  const primera = await svc2.liberarFeedback('ex-2');
  await new Promise((ok) => setTimeout(ok, 5));
  const segunda = await svc2.liberarFeedback('ex-2');
  assert.equal(segunda.feedbackLiberadoEn?.getTime(), primera.feedbackLiberadoEn?.getTime());
});

test('liberarFeedback: un examen que no existe responde 404', async () => {
  await assert.rejects(() => new ExamenesService(prismaExamenes([])).liberarFeedback('no-existe'), NotFoundException);
});

// ---------------------------------------------------------------------------
// 4. Email del alumno: se normaliza y se busca sin distinguir mayúsculas
// ---------------------------------------------------------------------------
test('normalizarEmail: sin espacios y en minúscula', () => {
  assert.equal(normalizarEmail('  Ana.Perez@Mail.COM \n'), 'ana.perez@mail.com');
});

test('IniciarIntentoDto: el email se normaliza antes de validar (como lo hace el ValidationPipe real)', async () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const dto = (await pipe.transform({ alumnoEmail: '  Ana@Mail.COM ' }, { type: 'body', metatype: IniciarIntentoDto })) as IniciarIntentoDto;
  assert.equal(dto.alumnoEmail, 'ana@mail.com');
  await assert.rejects(() => pipe.transform({ alumnoEmail: '  no-es-un-email ' }, { type: 'body', metatype: IniciarIntentoDto }), BadRequestException);
  await assert.rejects(() => pipe.transform({ alumnoEmail: 123 }, { type: 'body', metatype: IniciarIntentoDto }), BadRequestException);
});

const jwt = new JwtService({ secret: 'x'.repeat(40) });
const ec = { examenId: 'ex-1', comisionId: 'c-1', fechaInicio: null, fechaFin: null, examen: { duracionMinutos: null, antiCheat: null }, comision: { nombre: 'C1' } };

// Prisma de mentira que busca el email como la base: `equals` + `mode: 'insensitive'`.
function prismaIniciar(alumnos: Array<{ id: string; comisionId: string; email: string }>, yaEntregaron: string[] = []) {
  const consultas: any[] = [];
  const fallos: any[] = [];
  const prisma = {
    examenComision: { findUnique: async () => ec },
    alumno: {
      findFirst: async ({ where }: any) => {
        consultas.push(where);
        const { equals, mode } = where.email;
        const igual = (a: string) => (mode === 'insensitive' ? a.toLowerCase() === equals.toLowerCase() : a === equals);
        return alumnos.find((a) => a.comisionId === where.comisionId && igual(a.email)) ?? null;
      },
    },
    respuestaExamen: { count: async ({ where }: any) => (yaEntregaron.includes(where.alumnoId) ? 1 : 0) },
    falloAcceso: { count: async () => fallos.length, create: async ({ data }: any) => fallos.push(data) },
  } as any;
  return { prisma, consultas, fallos, svc: new IntentosService(prisma, jwt, {} as any) };
}
const dtoIniciar = (alumnoEmail: string) => Object.assign(new IniciarIntentoDto(), { alumnoEmail });

test('iniciar: encuentra al alumno aunque su fila esté guardada con mayúsculas (búsqueda case-insensitive)', async () => {
  const { svc, consultas, fallos } = prismaIniciar([{ id: 'al-1', comisionId: 'c-1', email: 'Ana.Perez@Mail.com' }], ['al-1']);
  // Llega normalizado ("ana.perez@mail.com"); como ya entregó, el flujo corta recién DESPUÉS de identificarlo.
  await assert.rejects(() => svc.iniciar('slug', dtoIniciar('ana.perez@mail.com'), '1.1.1.1'), /Ya enviaste una respuesta/);
  assert.deepEqual(consultas[0], { comisionId: 'c-1', email: { equals: 'ana.perez@mail.com', mode: 'insensitive' } });
  assert.equal(fallos.length, 0, 'encontrarlo no cuenta como fallo de acceso');
});

test('iniciar: un email que no está en la comisión se rechaza con un mensaje claro y suma un fallo por IP', async () => {
  const { svc, fallos } = prismaIniciar([{ id: 'al-1', comisionId: 'c-1', email: 'ana@mail.com' }, { id: 'al-9', comisionId: 'otra', email: 'otra@mail.com' }]);
  await assert.rejects(() => svc.iniciar('slug', dtoIniciar('otra@mail.com'), '1.1.1.1'), /Ese email no está en el listado de esta comisión/);
  assert.equal(fallos.length, 1);
  assert.equal(fallos[0].clave, 'ip|1.1.1.1');
});
