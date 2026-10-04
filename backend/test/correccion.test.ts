// Tests de la corrección robusta de exámenes: limitador de concurrencia, consulta RAG acotada, RAG que no tumba
// la corrección, reintento en masa de pendientes y aceptar sin nota. Corren sin base de datos ni IA:
//   node --require ts-node/register --test test/correccion.test.ts   (o `npm test`, una vez agregado al script)
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ConflictException, ForbiddenException, RequestMethod } from '@nestjs/common';
import { LimitadorConcurrencia, IA_MAX_CONCURRENTES_DEFAULT, maxConcurrentesDesdeEnv } from '../src/ai/limitador-concurrencia.util';
import { opcionesResilientes } from '../src/ai/ai.service';
import { MAX_CONSULTA_RAG, RagService, armarConsultaRag } from '../src/rag/rag.service';
import { RespuestasExamenService } from '../src/respuestas-examen/respuestas-examen.service';
import { RespuestasExamenController } from '../src/respuestas-examen/respuestas-examen.controller';

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

// ---------------------------------------------------------------------------
// Limitador de concurrencia
// ---------------------------------------------------------------------------
test('el limitador nunca corre más tareas que su tope y termina todas', async () => {
  const lim = new LimitadorConcurrencia(3);
  let corriendo = 0;
  let maximoVisto = 0;
  const resultados = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      lim.ejecutar(async () => {
        corriendo += 1;
        maximoVisto = Math.max(maximoVisto, corriendo);
        await turno();
        corriendo -= 1;
        return i;
      }),
    ),
  );
  assert.equal(maximoVisto, 3);
  assert.deepEqual(resultados, Array.from({ length: 20 }, (_, i) => i));
  assert.equal(lim.enCurso, 0);
  assert.equal(lim.enEspera, 0);
});

test('el limitador respeta el orden de llegada y cada lugar liberado lo toma el primero de la cola', async () => {
  const lim = new LimitadorConcurrencia(2);
  const inicios: number[] = [];
  const compuertas = Array.from({ length: 6 }, () => compuerta());
  const todas = compuertas.map((c, i) =>
    lim.ejecutar(async () => {
      inicios.push(i);
      await c.abierta;
    }),
  );
  await turno();
  assert.deepEqual(inicios, [0, 1]);
  assert.equal(lim.enEspera, 4);

  compuertas[1].abrir(); // termina la segunda: entra la tercera, no otra
  await turno();
  assert.deepEqual(inicios, [0, 1, 2]);
  compuertas[0].abrir();
  await turno();
  assert.deepEqual(inicios, [0, 1, 2, 3]);

  compuertas.forEach((c) => c.abrir());
  await Promise.all(todas);
  assert.deepEqual(inicios, [0, 1, 2, 3, 4, 5]);
});

test('el limitador libera el lugar cuando una tarea falla (rechazada o tirando) y el error le llega a quien la pidió', async () => {
  const lim = new LimitadorConcurrencia(1);
  const falla = lim.ejecutar(async () => {
    await turno();
    throw new Error('429 Too Many Requests');
  });
  const siguiente = lim.ejecutar(async () => 'ok'); // espera detrás de la que falla
  await assert.rejects(falla, /429/);
  assert.equal(await siguiente, 'ok');

  await assert.rejects(() => lim.ejecutar(() => { throw new Error('tiró de entrada'); }), /tiró de entrada/);
  assert.equal(await lim.ejecutar(async () => 'sigue andando'), 'sigue andando');
  assert.equal(lim.enCurso, 0);
  assert.equal(lim.enEspera, 0);
});

test('el tope tiene que ser un entero >= 1; la env inválida cae al default', () => {
  for (const malo of [0, -1, 2.5, NaN]) assert.throws(() => new LimitadorConcurrencia(malo), RangeError);
  assert.equal(maxConcurrentesDesdeEnv('10'), 10);
  assert.equal(maxConcurrentesDesdeEnv(' 2 '), 2);
  for (const malo of [undefined, '', '   ', '0', '-3', '2.5', 'abc']) {
    assert.equal(maxConcurrentesDesdeEnv(malo), IA_MAX_CONCURRENTES_DEFAULT);
  }
  assert.equal(IA_MAX_CONCURRENTES_DEFAULT, 4);
});

test('las llamadas al LLM reintentan 4 veces y cada una trae su propio timeout', () => {
  const a = opcionesResilientes();
  const b = opcionesResilientes();
  assert.equal(a.maxRetries, 4);
  assert.ok(a.abortSignal instanceof AbortSignal && !a.abortSignal.aborted);
  assert.notEqual(a.abortSignal, b.abortSignal);
});

// ---------------------------------------------------------------------------
// Consulta RAG acotada
// ---------------------------------------------------------------------------
test('armarConsultaRag: lo que entra en el tope queda tal cual (enunciado y respuesta por pregunta)', () => {
  assert.equal(
    armarConsultaRag([
      { enunciado: 'Explicá TCP', respuesta: 'Es orientado a conexión' },
      { enunciado: 'Definí UDP', respuesta: '   ' },
    ]),
    'Explicá TCP\nEs orientado a conexión\n\nDefiní UDP',
  );
  assert.equal(armarConsultaRag([]), '');
  assert.equal(armarConsultaRag([{ enunciado: ' ', respuesta: '' }]), '');
});

test('armarConsultaRag: con respuestas gigantes se acota, los enunciados van completos y las respuestas se recortan en la misma proporción', () => {
  const e1 = 'Explicá el modelo OSI. '.repeat(10).trim();
  const e2 = 'Comparé TCP y UDP. '.repeat(10).trim();
  const consulta = armarConsultaRag([
    { enunciado: e1, respuesta: '1'.repeat(50_000) },
    { enunciado: e2, respuesta: '2'.repeat(25_000) },
  ]);
  assert.ok(consulta.length <= MAX_CONSULTA_RAG, `largo ${consulta.length}`);
  assert.ok(consulta.length > MAX_CONSULTA_RAG - 10, 'aprovecha el presupuesto');
  assert.ok(consulta.startsWith(e1) && consulta.includes(e2));
  const unos = consulta.split('1').length - 1;
  const doses = consulta.split('2').length - 1;
  assert.ok(Math.abs(unos - 2 * doses) <= 2, `${unos} vs ${doses}: la primera respuesta es el doble de larga y debe conservar el doble`);
});

test('armarConsultaRag: si ni los enunciados entran, también se achican (todos siguen presentes)', () => {
  const consulta = armarConsultaRag([
    { enunciado: 'a'.repeat(5_000), respuesta: 'respuesta que ya no entra' },
    { enunciado: 'b'.repeat(5_000), respuesta: 'otra' },
    { enunciado: 'c'.repeat(5_000), respuesta: '' },
  ]);
  assert.ok(consulta.length <= MAX_CONSULTA_RAG);
  assert.ok(['a', 'b', 'c'].every((letra) => consulta.includes(letra)));
  assert.equal(consulta.includes('respuesta que ya no entra'), false);
});

test('armarConsultaRag: respeta un tope propio y nunca se pasa, pase lo que pase', () => {
  assert.ok(armarConsultaRag([{ enunciado: 'e'.repeat(300), respuesta: 'r'.repeat(300) }], 100).length <= 100);
  let semilla = 12345; // generador determinístico: el test tiene que dar siempre lo mismo
  const azar = (max: number) => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) % max) + 1;
  for (let caso = 0; caso < 300; caso++) {
    const preguntas = Array.from({ length: azar(12) }, () => ({ enunciado: 'e'.repeat(azar(900)), respuesta: 'r'.repeat(azar(20_000) - 1) }));
    const tope = azar(8_000);
    const consulta = armarConsultaRag(preguntas, tope);
    assert.ok(consulta.length <= tope, `caso ${caso}: ${consulta.length} > ${tope}`);
    const entera = preguntas.map((p) => (p.respuesta ? `${p.enunciado}\n${p.respuesta}` : p.enunciado)).join('\n\n');
    if (entera.length <= tope) assert.equal(consulta, entera, `caso ${caso}: lo que entra no se toca`);
  }
});

// ---------------------------------------------------------------------------
// RAG: sin material no se llama a embeddings
// ---------------------------------------------------------------------------
function ragConFalsos(filasIndexadas: Array<{ existe: number }>, resultados: unknown[] = []) {
  const consultas: string[] = [];
  const embebidos: string[] = [];
  const prisma = {
    $queryRaw: async (partes: TemplateStringsArray, ...valores: unknown[]) => {
      const sql = partes.join('?');
      consultas.push(sql);
      return sql.includes('ORDER BY') ? resultados : filasIndexadas;
    },
  };
  const rag = new RagService(prisma as any, { get: (_clave: string, porDefecto?: string) => porDefecto } as any);
  (rag as any).embedding = async (texto: string) => (embebidos.push(texto), [0.1, 0.2]);
  return { rag, consultas, embebidos };
}

test('buscarMaterial: un curso sin fragmentos indexados devuelve [] sin llamar a embeddings', async () => {
  const { rag, consultas, embebidos } = ragConFalsos([]);
  assert.deepEqual(await rag.buscarMaterial('curso-1', 'Explicá TCP'), []);
  assert.equal(embebidos.length, 0);
  assert.equal(consultas.length, 1);
  assert.match(consultas[0], /rag_fragmentos_material/);
  assert.match(consultas[0], /LIMIT 1/);
});

test('buscarMaterial: con material embebe la consulta (acotada) y devuelve los fragmentos', async () => {
  const fragmentos = [{ titulo: 'Redes', unidad: 'U1', contenido: 'TCP es...' }];
  const { rag, consultas, embebidos } = ragConFalsos([{ existe: 1 }], fragmentos);
  assert.deepEqual(await rag.buscarMaterial('curso-1', 'q'.repeat(50_000)), fragmentos);
  assert.equal(consultas.length, 2);
  assert.equal(embebidos.length, 1);
  assert.equal(embebidos[0].length, MAX_CONSULTA_RAG);
});

test('buscarMaterial: una consulta vacía no toca ni la base ni embeddings', async () => {
  const { rag, consultas, embebidos } = ragConFalsos([{ existe: 1 }]);
  assert.deepEqual(await rag.buscarMaterial('curso-1', '  \n '), []);
  assert.equal(consultas.length + embebidos.length, 0);
});

// ---------------------------------------------------------------------------
// Servicio: corregir
// ---------------------------------------------------------------------------
const NIVELES = [1, 2, 3, 4, 5].map((orden) => ({ orden, nombre: `N${orden}`, porcentaje: orden * 20 }));

/** Una respuesta con una pregunta abierta y una de verdadero/falso (cerrada). */
function respuestaFalsa(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    examenId: 'ex-1',
    alumnoId: `alumno-${id}`,
    estado: 'pendiente_correccion',
    respuestasPorPregunta: [
      { preguntaId: 'p-abierta', contenidoRespuesta: `texto de ${id}`, notaSugerida: 0, notaFinal: null },
      { preguntaId: 'p-vf', contenidoRespuesta: true, notaSugerida: 0, notaFinal: null },
    ],
    examen: {
      cursoId: 'curso-1',
      niveles: NIVELES,
      preguntas: [
        {
          id: 'p-abierta', tipo: 'desarrollo', enunciado: 'Explicá TCP', puntajeMaximo: 10, opciones: null,
          criterios: [{ id: 'cr-1', nombre: 'Claridad', descripcion: 'd', puntajeMaximo: 10, nivelesDescripcion: [] }],
        },
        { id: 'p-vf', tipo: 'verdadero_falso', enunciado: 'TCP es orientado a conexión', puntajeMaximo: 2, opciones: { correcta: true }, criterios: [] },
      ],
    },
    ...extra,
  };
}

function prismaCorregir(ids: string[], variantes: Record<string, any> = {}) {
  const updates: Array<{ id: string; data: any }> = [];
  const filas = new Map(ids.map((id) => [id, variantes[id] ?? respuestaFalsa(id)]));
  const consultas: any[] = [];
  const prisma = {
    respuestaExamen: {
      findUnique: async ({ where }: any) => filas.get(where.id) ?? null,
      findMany: async (args: any) => (consultas.push(args), ids.map((id) => ({ id }))),
      update: async ({ where, data }: any) => (updates.push({ id: where.id, data }), { id: where.id, ...data }),
    },
  };
  return { prisma, updates, consultas };
}

/** IA falsa: registra las llamadas y cuántas corrieron a la vez; `falla` decide por respuesta (por el texto del alumno). */
function iaFalsa(opciones: { espera?: () => Promise<void>; falla?: (texto: string) => boolean } = {}) {
  const llamadas: any[] = [];
  let simultaneas = 0;
  let maximo = 0;
  return {
    modeloActivo: 'google:falso',
    llamadas,
    get maximoSimultaneo() {
      return maximo;
    },
    corregirRespuestaExamen: async (params: any) => {
      llamadas.push(params);
      simultaneas += 1;
      maximo = Math.max(maximo, simultaneas);
      try {
        await (opciones.espera ?? turno)();
        if (opciones.falla?.(params.respuestasAlumno[0].texto)) throw new Error('429 Too Many Requests');
        return {
          porPregunta: [{ preguntaId: 'p-abierta', notaSugerida: 8, notaPorCriterio: [{ criterioId: 'cr-1', nombre: 'Claridad', nivelSugerido: 4, notaSugerida: 8, comentario: 'bien' }] }],
          notaTotalSugerida: 8,
          feedbackGeneralSugerido: 'Buen trabajo',
        };
      } finally {
        simultaneas -= 1;
      }
    },
  };
}

function servicio(prisma: any, ai: any, rag: any = { buscarMaterial: async () => [] }, env?: string) {
  const previo = process.env.IA_MAX_CONCURRENTES;
  if (env === undefined) delete process.env.IA_MAX_CONCURRENTES;
  else process.env.IA_MAX_CONCURRENTES = env;
  try {
    const svc = new RespuestasExamenService(prisma, ai, rag);
    const logs = { warn: [] as string[], error: [] as string[] };
    (svc as any).logger = {
      warn: (m: unknown) => logs.warn.push(String(m)),
      error: (m: unknown) => logs.error.push(String(m)),
      log: () => undefined,
      debug: () => undefined,
    };
    return { svc, logs };
  } finally {
    if (previo === undefined) delete process.env.IA_MAX_CONCURRENTES;
    else process.env.IA_MAX_CONCURRENTES = previo;
  }
}

test('corregir: corrige cerradas en código y abiertas con IA, y deja la respuesta corregida', async () => {
  const { prisma, updates } = prismaCorregir(['r-1']);
  const ia = iaFalsa();
  const { svc } = servicio(prisma, ia);
  await svc.corregir('r-1');
  assert.equal(ia.llamadas.length, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].data.estado, 'corregido');
  assert.equal(updates[0].data.estadoRevision, 'pendiente');
  assert.equal(Number(updates[0].data.notaTotalSugerida), 10); // 8 de la IA + 2 de la cerrada
});

test('corregir: la consulta que va al RAG sale acotada aunque la respuesta sea enorme', async () => {
  const enorme = respuestaFalsa('r-1');
  enorme.respuestasPorPregunta[0].contenidoRespuesta = 'z'.repeat(50_000);
  const { prisma } = prismaCorregir(['r-1'], { 'r-1': enorme });
  const consultas: string[] = [];
  const rag = { buscarMaterial: async (_curso: string, consulta: string) => (consultas.push(consulta), []) };
  await servicio(prisma, iaFalsa(), rag).svc.corregir('r-1');
  assert.equal(consultas.length, 1);
  assert.ok(consultas[0].length <= MAX_CONSULTA_RAG);
  assert.ok(consultas[0].startsWith('Explicá TCP'));
});

test('corregir: si el RAG falla se corrige igual, sin material, y se avisa con un warn', async () => {
  const { prisma, updates } = prismaCorregir(['r-1']);
  const ia = iaFalsa();
  const rag = { buscarMaterial: async () => { throw new Error('relation "rag_fragmentos_material" does not exist'); } };
  const { svc, logs } = servicio(prisma, ia, rag);
  await svc.corregir('r-1');
  assert.deepEqual(ia.llamadas[0].materialCurso, []);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].data.estado, 'corregido');
  assert.equal(logs.warn.length, 1);
  assert.match(logs.warn[0], /r-1/);
  assert.match(logs.warn[0], /sin material/);
  assert.equal(logs.error.length, 0);
});

test('corregir: el material que trae el RAG llega a la IA', async () => {
  const { prisma } = prismaCorregir(['r-1']);
  const ia = iaFalsa();
  const material = [{ titulo: 'Redes', unidad: 'U1', contenido: 'TCP es...' }];
  await servicio(prisma, ia, { buscarMaterial: async () => material }).svc.corregir('r-1');
  assert.deepEqual(ia.llamadas[0].materialCurso, material);
});

test('corregir: si falla la IA el error se propaga, la respuesta no se toca (sigue pendiente_correccion) y se puede reintentar', async () => {
  const { prisma, updates } = prismaCorregir(['r-1']);
  let fallar = true;
  const ia = iaFalsa({ falla: () => fallar });
  const { svc } = servicio(prisma, ia);
  await assert.rejects(() => svc.corregir('r-1'), /429/);
  assert.equal(updates.length, 0);
  assert.equal(svc.limitador.enCurso, 0); // el lugar de la IA se liberó

  fallar = false;
  await svc.corregir('r-1'); // ni el id en curso ni el limitador quedaron colgados
  assert.equal(updates.length, 1);
  assert.equal(updates[0].data.estado, 'corregido');
});

test('corregir: un examen solo con cerradas no pasa por la IA, el RAG ni el limitador', async () => {
  const soloCerradas = respuestaFalsa('r-1');
  soloCerradas.examen.preguntas = soloCerradas.examen.preguntas.filter((p) => p.tipo === 'verdadero_falso');
  const { prisma, updates } = prismaCorregir(['r-1'], { 'r-1': soloCerradas });
  const ia = iaFalsa();
  let busquedas = 0;
  const { svc } = servicio(prisma, ia, { buscarMaterial: async () => (busquedas++, []) });
  await svc.corregir('r-1');
  assert.equal(ia.llamadas.length + busquedas, 0);
  assert.equal(updates[0].data.modeloIa, null);
  assert.equal(Number(updates[0].data.notaTotalSugerida), 2);
});

test('corregir: el tope IA_MAX_CONCURRENTES se respeta aunque lleguen todas juntas', async () => {
  const ids = Array.from({ length: 10 }, (_, i) => `r-${i}`);
  const { prisma, updates } = prismaCorregir(ids);
  const ia = iaFalsa({ espera: async () => { await turno(); await turno(); } });
  const { svc } = servicio(prisma, ia, undefined, '2');
  assert.equal(svc.limitador.maximo, 2);
  await Promise.all(ids.map((id) => svc.corregir(id)));
  assert.equal(ia.maximoSimultaneo, 2);
  assert.equal(ia.llamadas.length, 10);
  assert.equal(updates.length, 10);

  assert.equal(servicio(prisma, ia).svc.limitador.maximo, 4); // sin env: default
});

test('corregir: dos pedidos a la vez por la misma respuesta comparten una sola corrección', async () => {
  const { prisma, updates } = prismaCorregir(['r-1']);
  const ia = iaFalsa();
  const { svc } = servicio(prisma, ia);
  const [a, b] = await Promise.all([svc.corregir('r-1'), svc.corregir('r-1')]);
  assert.equal(ia.llamadas.length, 1);
  assert.equal(updates.length, 1);
  assert.equal((a as any).id, 'r-1');
  assert.equal((b as any).id, 'r-1');

  await svc.corregir('r-1'); // una vez terminada, volver a corregir es una re-corrección legítima
  assert.equal(ia.llamadas.length, 2);
});

// ---------------------------------------------------------------------------
// Servicio: reintentar pendientes en masa
// ---------------------------------------------------------------------------
test('corregirPendientes: responde enseguida con la cantidad y corrige en segundo plano sin cortarse por un error', async () => {
  const ids = ['r-1', 'r-2', 'r-3', 'r-4'];
  const { prisma, updates, consultas } = prismaCorregir(ids);
  const puerta = compuerta();
  const ia = iaFalsa({ espera: () => puerta.abierta, falla: (texto) => texto.endsWith('r-2') });
  const { svc, logs } = servicio(prisma, ia);

  const respuesta = await svc.corregirPendientes('ex-1');
  assert.deepEqual(respuesta, { pendientes: 4 });
  assert.deepEqual(consultas[0].where, { examenId: 'ex-1', estado: 'pendiente_correccion' });
  assert.equal(updates.length, 0); // todavía no terminó nada: el pedido no esperó a la IA

  puerta.abrir();
  await esperarHasta(() => updates.length === 3 && logs.error.length === 1);
  assert.deepEqual(updates.map((u) => u.id).sort(), ['r-1', 'r-3', 'r-4']);
  assert.match(logs.error[0], /r-2/);
});

test('corregirPendientes: un segundo pedido no vuelve a lanzar las que ya están en marcha ni las que esperan turno', async () => {
  const ids = ['r-1', 'r-2', 'r-3', 'r-4', 'r-5'];
  const { prisma, updates } = prismaCorregir(ids);
  const puerta = compuerta();
  const ia = iaFalsa({ espera: () => puerta.abierta });
  const { svc } = servicio(prisma, ia, undefined, '2'); // 2 corriendo, 3 esperando su turno

  assert.deepEqual(await svc.corregirPendientes('ex-1'), { pendientes: 5 });
  await turno();
  assert.deepEqual(await svc.corregirPendientes('ex-1'), { pendientes: 5 }); // las cuenta, pero no las duplica

  puerta.abrir();
  await esperarHasta(() => updates.length === 5);
  await turno();
  assert.equal(ia.llamadas.length, 5);
  assert.equal(ia.maximoSimultaneo, 2);
});

test('corregirPendientes: no relanza una respuesta que ya está corrigiéndose por su propia entrega', async () => {
  const { prisma, updates } = prismaCorregir(['r-1', 'r-2']);
  const puerta = compuerta();
  const ia = iaFalsa({ espera: () => puerta.abierta });
  const { svc } = servicio(prisma, ia);

  const primera = svc.corregir('r-1'); // la corrección automática de la entrega, todavía en curso
  await turno();
  assert.deepEqual(await svc.corregirPendientes('ex-1'), { pendientes: 2 });
  puerta.abrir();
  await primera;
  await esperarHasta(() => updates.length === 2);
  assert.equal(ia.llamadas.length, 2);
});

test('corregirPendientes: sin pendientes responde 0 y no corre nada', async () => {
  const { prisma } = prismaCorregir([]);
  const ia = iaFalsa();
  assert.deepEqual(await servicio(prisma, ia).svc.corregirPendientes('ex-1'), { pendientes: 0 });
  assert.equal(ia.llamadas.length, 0);
});

// ---------------------------------------------------------------------------
// Controller: acceso y ruta
// ---------------------------------------------------------------------------
test('POST /examenes/:examenId/respuestas/corregir-pendientes: chequea el acceso al examen y devuelve { pendientes }', async () => {
  const llamadas: string[] = [];
  const acceso = { examen: async (docenteId: string, examenId: string) => llamadas.push(`acceso:${docenteId}:${examenId}`) };
  const service = { corregirPendientes: async (examenId: string) => (llamadas.push(`service:${examenId}`), { pendientes: 7 }) };
  const controller = new RespuestasExamenController(service as any, {} as any, acceso as any, {} as any);

  assert.deepEqual(await controller.corregirPendientes('doc-1', 'ex-1'), { pendientes: 7 });
  assert.deepEqual(llamadas, ['acceso:doc-1:ex-1', 'service:ex-1']);

  // Un docente ajeno no dispara nada.
  llamadas.length = 0;
  acceso.examen = async () => { throw new ForbiddenException(); };
  await assert.rejects(() => controller.corregirPendientes('doc-2', 'ex-1'), ForbiddenException);
  assert.deepEqual(llamadas, []);

  const handler = RespuestasExamenController.prototype.corregirPendientes;
  assert.equal(Reflect.getMetadata('path', handler), 'corregir-pendientes');
  assert.equal(Reflect.getMetadata('method', handler), RequestMethod.POST);
});

// ---------------------------------------------------------------------------
// Aceptar sin nota ya no corrompe datos
// ---------------------------------------------------------------------------
function filaBulk(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    examenId: 'ex-1',
    alumnoId: `alumno-${id}`,
    estado: 'corregido',
    estadoRevision: 'pendiente',
    notaTotalSugerida: 7,
    notaConVara: null,
    notaTotalFinal: null,
    feedbackGeneralSugerido: 'fb',
    feedbackGeneralFinal: null,
    revisadoEn: null,
    respuestasPorPregunta: [{ preguntaId: 'p', contenidoRespuesta: 'x', notaSugerida: 7, notaFinal: null }],
    ...extra,
  };
}

/** Prisma falso con un findMany que entiende los filtros simples (igualdad y `{ not: null }`) que usa el servicio. */
function prismaBulk(filas: Array<Record<string, any>>) {
  const consultas: any[] = [];
  const coincide = (fila: Record<string, any>, where: Record<string, any>) =>
    Object.entries(where).every(([k, v]) => (v && typeof v === 'object' && 'not' in v ? fila[k] !== v.not : fila[k] === v));
  let transacciones = 0;
  const prisma = {
    respuestaExamen: {
      findMany: async (args: any) => (consultas.push(args), filas.filter((f) => coincide(f, args.where)).map((f) => ({ ...f }))),
      update: async ({ where, data }: any) => Object.assign(filas.find((f) => f.id === where.id)!, data),
      findUnique: async ({ where }: any) => filas.find((f) => f.id === where.id) ?? null,
    },
    intentoExamen: { findMany: async () => [] },
    $transaction: async (operaciones: Array<Promise<unknown>>) => (transacciones++, Promise.all(operaciones)),
  };
  return { prisma, filas, consultas, transacciones: () => transacciones };
}

test('bulkAceptar: solo acepta las corregidas con nota sugerida; las que la IA no corrigió quedan pendientes y sin nota', async () => {
  const { prisma, filas, consultas } = prismaBulk([
    filaBulk('ok'),
    filaBulk('con-vara', { notaConVara: 8.5 }),
    filaBulk('sin-corregir', { estado: 'pendiente_correccion', notaTotalSugerida: null }),
    filaBulk('corregida-sin-nota', { notaTotalSugerida: null }),
    filaBulk('ya-revisada', { estado: 'revisado', estadoRevision: 'aceptada', notaTotalFinal: 5 }),
    filaBulk('otro-examen', { examenId: 'ex-2' }),
  ]);
  const { svc } = servicio(prisma, {});
  const devueltas: any[] = await svc.bulkAceptar('ex-1');

  assert.deepEqual(consultas[0].where, { examenId: 'ex-1', estado: 'corregido', estadoRevision: 'pendiente', notaTotalSugerida: { not: null } });
  const por = (id: string) => filas.find((f) => f.id === id)!;

  assert.equal(por('ok').estadoRevision, 'aceptada');
  assert.equal(por('ok').estado, 'revisado');
  assert.equal(por('ok').notaTotalFinal, 7);
  assert.ok(por('ok').revisadoEn instanceof Date);
  assert.equal(por('ok').respuestasPorPregunta[0].notaFinal, 7);
  assert.equal(por('con-vara').notaTotalFinal, 8.5); // la nota con la vara vigente

  for (const id of ['sin-corregir', 'corregida-sin-nota']) {
    assert.equal(por(id).estadoRevision, 'pendiente', id);
    assert.equal(por(id).notaTotalFinal, null, id);
    assert.equal(por(id).revisadoEn, null, id);
  }
  assert.equal(por('sin-corregir').estado, 'pendiente_correccion');
  assert.equal(por('ya-revisada').notaTotalFinal, 5);
  assert.equal(por('otro-examen').estadoRevision, 'pendiente');

  // Sigue devolviendo la lista del examen (lo mismo que antes).
  assert.deepEqual(devueltas.map((r) => r.id).sort(), ['con-vara', 'corregida-sin-nota', 'ok', 'sin-corregir', 'ya-revisada']);
});

test('bulkAceptar: si no hay nada aceptable devuelve [] y no abre ninguna transacción', async () => {
  const { prisma, transacciones } = prismaBulk([filaBulk('sin-corregir', { estado: 'pendiente_correccion', notaTotalSugerida: null })]);
  assert.deepEqual(await servicio(prisma, {}).svc.bulkAceptar('ex-1'), []);
  assert.equal(transacciones(), 0);
});

test('revisar: aceptar una respuesta que la IA nunca corrigió se rechaza y no escribe nada', async () => {
  const { prisma, filas } = prismaBulk([filaBulk('r-1', { estado: 'pendiente_correccion', notaTotalSugerida: null })]);
  const { svc } = servicio(prisma, {});
  await assert.rejects(
    () => svc.revisar('ex-1', 'r-1', { estadoRevision: 'aceptada' }),
    (err: unknown) => err instanceof ConflictException && /todavía no fue corregida por la IA/.test((err as Error).message),
  );
  assert.equal(filas[0].estadoRevision, 'pendiente');
  assert.equal(filas[0].notaTotalFinal, null);
  assert.equal(filas[0].estado, 'pendiente_correccion');
});

test('revisar: editar sí se permite aunque la IA no haya corregido (el docente califica a mano)', async () => {
  const { prisma, filas } = prismaBulk([filaBulk('r-1', { estado: 'pendiente_correccion', notaTotalSugerida: null })]);
  const { svc } = servicio(prisma, {});
  await svc.revisar('ex-1', 'r-1', { estadoRevision: 'editada', notaTotalFinal: 5.5, feedbackGeneralFinal: 'Corregido a mano' });
  assert.equal(filas[0].estadoRevision, 'editada');
  assert.equal(filas[0].estado, 'revisado');
  assert.equal(filas[0].notaTotalFinal, 5.5);
  assert.equal(filas[0].feedbackGeneralFinal, 'Corregido a mano');
});

test('revisar: aceptar una respuesta corregida sigue confirmando la nota sugerida (o la de la vara)', async () => {
  const { prisma, filas } = prismaBulk([filaBulk('r-1'), filaBulk('r-2', { notaConVara: 9 })]);
  const { svc } = servicio(prisma, {});
  await svc.revisar('ex-1', 'r-1', { estadoRevision: 'aceptada' });
  await svc.revisar('ex-1', 'r-2', { estadoRevision: 'aceptada' });
  assert.deepEqual(filas.map((f) => [f.estadoRevision, f.estado, f.notaTotalFinal]), [['aceptada', 'revisado', 7], ['aceptada', 'revisado', 9]]);
});
