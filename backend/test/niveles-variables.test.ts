// Tests de la escala de niveles de desempeño variable: entre 3 y 7 niveles (5 por defecto), en vez de "5 fijos". Cubre:
//   - crear un examen con 3, 5 y 7 niveles, y los rechazos (cantidad, orden, último nivel, porcentajes crecientes);
//   - los criterios de una pregunta: sin niveles detallados o EXACTAMENTE los de la escala de ese examen;
//   - las matrices de rúbrica: sin niveles o entre 3 y 7 (cantidad independiente de cualquier examen);
//   - la corrección con IA con una escala de 3 y de 7 niveles (el nivel que sugiere el modelo se acota a [1, N]);
//   - "Sugerir criterios" con `cantidadNiveles`;
//   - regresión: un examen de 5 niveles se comporta igual que antes.
// Corren sin red, sin base de datos y sin ningún modelo real (el modelo es un mock del SDK), con dobles de Prisma hechos a mano:
//   node --require ts-node/register --test test/niveles-variables.test.ts   (o `npm test`, una vez agregado al script)
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
// El mock de modelo del SDK vive en el subpath `ai/test` (solo en el mapa `exports`, que el `moduleResolution`
// clásico de TS no ve): los tipos se importan por la ruta física y el valor con require, que sí respeta `exports`.
import type { MockLanguageModelV1 as MockLanguageModelV1Tipo } from 'ai/test/dist/index';
import { AiService } from '../src/ai/ai.service';
import { SugerirCriteriosDto } from '../src/ai/dto/sugerir-criterios.dto';
import { armarPromptSugerencia, normalizarSugerencia } from '../src/ai/sugerencia-criterios.util';
import { CreateExamenDto } from '../src/examenes/dto/create-examen.dto';
import { ExamenesService } from '../src/examenes/examenes.service';
import {
  CANT_NIVELES_DEFECTO,
  CANT_NIVELES_MAX,
  CANT_NIVELES_MIN,
  acotarCantidadNiveles,
  esCantidadNivelesValida,
} from '../src/examenes/niveles.util';
import { validarNivelesEscala } from '../src/examenes/puntaje.util';
import { SugerenciasController } from '../src/examenes/sugerencias.controller';
import { CreateMatrizRubricaDto } from '../src/matrices-rubrica/dto/create-matriz-rubrica.dto';
import { MatricesRubricaService } from '../src/matrices-rubrica/matrices-rubrica.service';

const { MockLanguageModelV1 } = require('ai/test') as { MockLanguageModelV1: typeof MockLanguageModelV1Tipo };
type MockLanguageModelV1 = MockLanguageModelV1Tipo;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const CURSO_ID = '11111111-1111-4111-8111-111111111111';
// Mismas opciones que main.ts: lo que llega al servicio pasó por el ValidationPipe real.
const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
const validar = (cuerpo: unknown, metatype: any) => pipe.transform(cuerpo, { type: 'body', metatype });

/** Porcentajes estrictamente crecientes que arrancan en 0 y terminan en 100 (3 -> 0/50/100, 5 -> 0/25/50/75/100, 7 -> 0/17/33/50/67/83/100). */
const porcentajesDe = (n: number) => (n <= 1 ? Array.from({ length: n }, () => 100) : Array.from({ length: n }, (_, i) => Math.round((i * 100) / (n - 1))));
const nivelesCon = (porcentajes: number[]) =>
  porcentajes.map((porcentaje, i) => ({ orden: i + 1, nombre: `N${i + 1}`, colorHex: '#000000', porcentaje }));
const escala = (n: number) => nivelesCon(porcentajesDe(n));

const descripciones = (k: number) =>
  Array.from({ length: k }, (_, i) => ({ orden: i + 1, nombre: `Nivel ${i + 1}`, descripcion: `Qué implica el nivel ${i + 1}` }));

const cerrada = (puntaje = 10): any => ({
  tipo: 'opcion_multiple',
  enunciado: 'Elegí',
  puntajeMaximo: puntaje,
  opciones: [{ id: 'a', texto: 'A', correcta: true }, { id: 'b', texto: 'B', correcta: false }],
});
/** Pregunta abierta de 10 puntos con un único criterio; `nivelesDescripcion` se omite si es undefined. */
const abierta = (nombreCriterio = 'Claridad', nivelesDescripcion?: unknown): any => ({
  tipo: 'desarrollo',
  enunciado: 'Explicá',
  puntajeMaximo: 10,
  criterios: [
    {
      nombre: nombreCriterio,
      descripcion: 'Qué se espera',
      puntajeMaximo: 10,
      ...(nivelesDescripcion === undefined ? {} : { nivelesDescripcion }),
    },
  ],
});
const examenCon = (niveles: unknown, preguntas: any[] = [cerrada(10)], extra: Record<string, unknown> = {}): any => ({
  cursoId: CURSO_ID,
  titulo: 'Parcial',
  consigna: 'Consigna',
  modalidad: 'ventana_dias',
  escalaMin: 0,
  escalaMax: 10,
  niveles,
  feedbackModo: 'manual',
  preguntas,
  ...extra,
});

/** Crea por ExamenesService (con Prisma falso). `conPipe`: antes pasa por el ValidationPipe real, como en la API. */
async function crear(body: any, conPipe = false) {
  const creados: any[] = [];
  const prisma = {
    examen: {
      create: async ({ data }: any) => {
        creados.push(data);
        return { id: 'ex-1', ...data };
      },
    },
  } as any;
  const svc = new ExamenesService(prisma, {} as any);
  try {
    const dto = conPipe ? await validar(body, CreateExamenDto) : body;
    await (async () => svc.create(dto))(); // `create` valida de forma síncrona: se envuelve en async
    return { error: null as any, creados };
  } catch (error) {
    return { error, creados };
  }
}
/** Los mensajes de un 400, sea el de un servicio (un texto) o el del ValidationPipe (una lista). */
const mensajes = (error: any): string[] => {
  const m = error?.getResponse?.()?.message;
  return Array.isArray(m) ? m : [String(m)];
};
const hayMensaje = (error: any, regex: RegExp) => mensajes(error).some((m) => regex.test(m));
const criteriosGuardados = (creados: any[], pregunta = 0) => creados[0].preguntas.create[pregunta].criterios.create;

// ---------------------------------------------------------------------------
// 1. Constantes y funciones de apoyo
// ---------------------------------------------------------------------------
test('la escala va de 3 a 7 niveles y 5 es el valor por defecto', () => {
  assert.equal(CANT_NIVELES_MIN, 3);
  assert.equal(CANT_NIVELES_MAX, 7);
  assert.equal(CANT_NIVELES_DEFECTO, 5);
  for (const n of [3, 4, 5, 6, 7]) assert.equal(esCantidadNivelesValida(n), true, String(n));
  for (const n of [0, 1, 2, 8, 100, -3, 3.5, NaN, Infinity, '5', null, undefined, [5], {}]) assert.equal(esCantidadNivelesValida(n), false, String(n));
});

test('acotarCantidadNiveles: lo inválido se acota al rango y lo que no es número cae al valor por defecto', () => {
  assert.deepEqual([3, 4, 5, 6, 7].map(acotarCantidadNiveles), [3, 4, 5, 6, 7]);
  assert.deepEqual([0, 1, 2, -9].map(acotarCantidadNiveles), [3, 3, 3, 3]);
  assert.deepEqual([8, 9, 1000].map(acotarCantidadNiveles), [7, 7, 7]);
  assert.equal(acotarCantidadNiveles(4.9), 4);
  for (const raro of [undefined, null, NaN, Infinity, 'x', '3', {}]) assert.equal(acotarCantidadNiveles(raro), 5, String(raro));
});

// ---------------------------------------------------------------------------
// 2. Crear un examen con 3, 5 y 7 niveles
// ---------------------------------------------------------------------------
test('crear un examen con una escala de 3, 5 y 7 niveles funciona (por el servicio y por el ValidationPipe) y guarda la escala tal cual', async () => {
  for (const n of [3, 4, 5, 6, 7]) {
    for (const conPipe of [false, true]) {
      const { error, creados } = await crear(examenCon(escala(n)), conPipe);
      assert.equal(error, null, `${n} niveles (conPipe=${conPipe}): ${mensajes(error)}`);
      assert.equal(creados.length, 1);
      assert.equal(creados[0].niveles.length, n);
      assert.deepEqual(creados[0].niveles.map((x: any) => x.orden), Array.from({ length: n }, (_, i) => i + 1));
      assert.equal(creados[0].niveles[n - 1].porcentaje, 100);
    }
  }
});

test('una escala con una cantidad de niveles fuera de 3..7 se rechaza con 400 y no guarda nada', async () => {
  for (const n of [0, 1, 2, 8, 9, 20]) {
    // Directo al servicio: con el mensaje de la regla.
    const directo = await crear(examenCon(nivelesCon(porcentajesDe(n))));
    assert.ok(directo.error instanceof BadRequestException, `${n} niveles`);
    assert.equal(
      mensajes(directo.error)[0],
      `La escala de niveles tiene que tener entre 3 y 7 niveles (la que mandaste tiene ${n}).`,
    );
    assert.equal(directo.creados.length, 0);

    // Por el pipe (el DTO también lo corta, con su propio mensaje en castellano).
    const conPipe = await crear(examenCon(nivelesCon(porcentajesDe(n))), true);
    assert.ok(conPipe.error instanceof BadRequestException, `${n} niveles (pipe)`);
    assert.ok(hayMensaje(conPipe.error, /entre 3 y 7 niveles/), mensajes(conPipe.error).join(' | '));
    assert.equal(conPipe.creados.length, 0);
  }
});

test('el orden de los niveles tiene que ser 1..N consecutivo y sin repetidos', async () => {
  const malos: Array<[string, number[], number[]]> = [
    ['salteado', [1, 2, 4], [0, 50, 100]],
    ['repetido', [1, 2, 2], [0, 50, 100]],
    ['no empieza en 1', [2, 3, 4], [0, 50, 100]],
    ['empieza en 0', [0, 1, 2], [0, 50, 100]],
    ['salteado en una escala de 7', [1, 2, 3, 4, 5, 6, 8], porcentajesDe(7)],
    ['repetido en una escala de 5', [1, 2, 3, 3, 5], porcentajesDe(5)],
  ];
  for (const [caso, ordenes, porcentajes] of malos) {
    const niveles = nivelesCon(porcentajes).map((n, i) => ({ ...n, orden: ordenes[i] }));
    const { error, creados } = await crear(examenCon(niveles));
    assert.ok(error instanceof BadRequestException, caso);
    assert.equal(mensajes(error)[0], `Los niveles de la escala tienen que estar numerados del 1 al ${ordenes.length}, sin saltos ni repetidos.`, caso);
    assert.equal(creados.length, 0, caso);
  }
});

test('el orden puede llegar desordenado en el arreglo: se evalúa por `orden`, no por la posición', async () => {
  const desordenados = [
    { orden: 3, nombre: 'Alto', colorHex: '#000000', porcentaje: 100 },
    { orden: 1, nombre: 'Bajo', colorHex: '#000000', porcentaje: 0 },
    { orden: 2, nombre: 'Medio', colorHex: '#000000', porcentaje: 50 },
  ];
  assert.equal((await crear(examenCon(desordenados))).error, null);
  assert.equal(validarNivelesEscala(desordenados), null);
});

test('el último nivel tiene que valer 100 %, en una escala de 3, de 5 y de 7', async () => {
  for (const n of [3, 5, 7]) {
    for (const ultimo of [90, 99.5, 120, 0]) {
      const porcentajes = porcentajesDe(n);
      porcentajes[n - 1] = ultimo;
      // Cuando el último queda por debajo del anterior, el primer error es el del 100 %: se chequea antes que el crecimiento.
      const { error, creados } = await crear(examenCon(nivelesCon(porcentajes)));
      assert.ok(error instanceof BadRequestException, `${n} niveles, último ${ultimo}`);
      assert.match(mensajes(error)[0], new RegExp(`El último nivel de la escala \\(N${n}\\) tiene que valer 100 %`));
      assert.equal(creados.length, 0);
    }
  }
});

test('los porcentajes tienen que crecer estrictamente, en una escala de 3, de 5 y de 7', async () => {
  for (const n of [3, 5, 7]) {
    const base = porcentajesDe(n);
    const desordenado = [...base];
    [desordenado[0], desordenado[1]] = [desordenado[1], desordenado[0]]; // N1 pasa a valer más que N2 (el último sigue en 100)
    const repetido = [...base];
    repetido[1] = repetido[0]; // N2 vale lo mismo que N1
    for (const [caso, porcentajes] of [['decrece', desordenado], ['iguales', repetido]] as Array<[string, number[]]>) {
      const { error, creados } = await crear(examenCon(nivelesCon(porcentajes)));
      assert.ok(error instanceof BadRequestException, `${n} niveles, ${caso}`);
      assert.match(mensajes(error)[0], /Los porcentajes de la escala tienen que ir creciendo de un nivel al siguiente: «N1» vale \d+ % y «N2» vale \d+ %/);
      assert.equal(creados.length, 0);
    }
  }
});

test('el porcentaje de un nivel tiene que estar entre 0 y 100 (el DTO lo corta antes del servicio)', async () => {
  for (const malo of [101, 150, -1]) {
    const porcentajes = porcentajesDe(5);
    porcentajes[2] = malo;
    const { error, creados } = await crear(examenCon(nivelesCon(porcentajes)), true);
    assert.ok(error instanceof BadRequestException, String(malo));
    assert.ok(hayMensaje(error, /porcentaje/), mensajes(error).join(' | '));
    assert.equal(creados.length, 0);
  }
  // 100 exacto en el último es el caso normal.
  assert.equal((await crear(examenCon(escala(5)), true)).error, null);
});

// ---------------------------------------------------------------------------
// 3. Criterios de una pregunta: ninguna descripción o EXACTAMENTE una por nivel de la escala de ese examen
// ---------------------------------------------------------------------------
test('un criterio sin niveles detallados (ausente, null o []) es válido con cualquier escala y guarda []', async () => {
  for (const n of [3, 5, 7]) {
    for (const nivelesDescripcion of [undefined, null, []]) {
      for (const conPipe of [false, true]) {
        const { error, creados } = await crear(examenCon(escala(n), [abierta('Claridad', nivelesDescripcion)]), conPipe);
        assert.equal(error, null, `${n} niveles, ${JSON.stringify(nivelesDescripcion)}: ${mensajes(error)}`);
        assert.deepEqual(criteriosGuardados(creados)[0].nivelesDescripcion, []);
      }
    }
  }
});

test('un criterio con exactamente N descripciones es válido cuando la escala tiene N niveles', async () => {
  for (const n of [3, 4, 5, 6, 7]) {
    for (const conPipe of [false, true]) {
      const { error, creados } = await crear(examenCon(escala(n), [abierta('Claridad', descripciones(n))]), conPipe);
      assert.equal(error, null, `${n} niveles (conPipe=${conPipe}): ${mensajes(error)}`);
      assert.equal(criteriosGuardados(creados)[0].nivelesDescripcion.length, n);
    }
  }
});

test('un criterio con N-1 o N+1 descripciones (o cualquier otra cantidad) se rechaza con 400 y un mensaje claro', async () => {
  for (const n of [3, 5, 7]) {
    for (const k of [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((k) => k !== n)) {
      for (const conPipe of [false, true]) {
        const { error, creados } = await crear(examenCon(escala(n), [abierta('Claridad', descripciones(k))]), conPipe);
        assert.ok(error instanceof BadRequestException, `escala de ${n}, criterio con ${k} (conPipe=${conPipe})`);
        assert.equal(
          mensajes(error)[0],
          `El criterio «Claridad» describe ${k === 1 ? '1 nivel' : `${k} niveles`} pero la escala del examen tiene ${n}: describí todos o ninguno.`,
        );
        assert.equal(creados.length, 0);
      }
    }
  }
  // El ejemplo del contrato.
  const { error } = await crear(examenCon(escala(5), [abierta('Claridad', descripciones(4))]));
  assert.equal(mensajes(error)[0], 'El criterio «Claridad» describe 4 niveles pero la escala del examen tiene 5: describí todos o ninguno.');
});

test('el mismo criterio de 5 descripciones vale en un examen de 5 niveles y se rechaza en uno de 3 o de 7', async () => {
  assert.equal((await crear(examenCon(escala(5), [abierta('Claridad', descripciones(5))]))).error, null);
  for (const n of [3, 7]) {
    const { error } = await crear(examenCon(escala(n), [abierta('Claridad', descripciones(5))]));
    assert.ok(error instanceof BadRequestException, `escala de ${n}`);
    assert.match(mensajes(error)[0], new RegExp(`describe 5 niveles pero la escala del examen tiene ${n}`));
  }
});

test('las N descripciones tienen que estar numeradas 1..N sin saltos ni repetidos, y con nombre y descripción llenos', async () => {
  for (const n of [3, 5, 7]) {
    const conOrden = (ordenes: number[]) => descripciones(n).map((d, i) => ({ ...d, orden: ordenes[i] }));
    const secuencia = Array.from({ length: n }, (_, i) => i + 1);
    const salteado = [...secuencia.slice(0, -1), n + 1];
    const repetido = [...secuencia.slice(0, -1), n - 1];
    for (const [caso, ordenes] of [['salteado', salteado], ['repetido', repetido]] as Array<[string, number[]]>) {
      const { error, creados } = await crear(examenCon(escala(n), [abierta('Claridad', conOrden(ordenes))]));
      assert.ok(error instanceof BadRequestException, `${n} niveles, orden ${caso}`);
      assert.equal(mensajes(error)[0], `Los niveles del criterio «Claridad» tienen que estar numerados del 1 al ${n}, sin saltos ni repetidos.`);
      assert.equal(creados.length, 0);
    }
    // Desordenadas en el arreglo pero 1..N: vale (la IA y la pantalla las ordenan por `orden`).
    assert.equal((await crear(examenCon(escala(n), [abierta('Claridad', conOrden(secuencia).reverse())]))).error, null, `${n} niveles desordenados`);

    // Texto en blanco: el DTO solo corta el vacío exacto; el de puros espacios lo corta el servicio.
    const enBlanco = descripciones(n).map((d, i) => (i === 1 ? { ...d, descripcion: '   ' } : d));
    const { error, creados } = await crear(examenCon(escala(n), [abierta('Claridad', enBlanco)]), true);
    assert.ok(error instanceof BadRequestException, `${n} niveles, descripción en blanco`);
    assert.equal(mensajes(error)[0], 'Todos los niveles del criterio «Claridad» necesitan nombre y descripción: el nivel 2 está incompleto.');
    assert.equal(creados.length, 0);
    const sinNombre = descripciones(n).map((d, i) => (i === 0 ? { ...d, nombre: '' } : d));
    assert.ok((await crear(examenCon(escala(n), [abierta('Claridad', sinNombre)]), true)).error instanceof BadRequestException);
  }
});

test('se validan los criterios de todas las preguntas: alcanza con que uno falle para rechazar el examen', async () => {
  const preguntas = [abierta('Bueno', descripciones(5)), cerrada(0.5), abierta('Malo', descripciones(4))];
  const { error, creados } = await crear(examenCon(escala(5), preguntas, { escalaMax: 20.5 }));
  assert.ok(error instanceof BadRequestException);
  assert.equal(mensajes(error)[0], 'El criterio «Malo» describe 4 niveles pero la escala del examen tiene 5: describí todos o ninguno.');
  assert.equal(creados.length, 0);
});

test('nivelesDescripcion tiene que ser una lista: un objeto suelto, un texto o un número se rechazan', async () => {
  for (const raro of [{ orden: 1, nombre: 'a', descripcion: 'b' }, 'cinco niveles', 5]) {
    const { error, creados } = await crear(examenCon(escala(5), [abierta('Claridad', raro)]), true);
    assert.ok(error instanceof BadRequestException, JSON.stringify(raro));
    assert.equal(creados.length, 0);
  }
});

// ---------------------------------------------------------------------------
// 4. Matrices de rúbrica: ninguna descripción o entre 3 y 7 (cantidad independiente de cualquier examen)
// ---------------------------------------------------------------------------
const matrizCon = (nivelesDescripcion?: unknown) => ({
  nombre: 'Mi matriz',
  criterios: [
    {
      nombre: 'Claridad',
      descripcion: 'Qué tan clara es',
      puntajeMaximo: 10,
      ...(nivelesDescripcion === undefined ? {} : { nivelesDescripcion }),
    },
  ],
});

/** Crea una matriz por MatricesRubricaService (Prisma falso). Con `conPipe`, antes pasa por el ValidationPipe real. */
async function crearMatriz(body: unknown, conPipe = true) {
  const creaciones: any[] = [];
  const prisma = {
    matrizRubrica: {
      create: async (args: any) => {
        creaciones.push(args);
        return { id: 'm1', ...args.data, criterios: args.data.criterios.create };
      },
    },
  } as any;
  const service = new MatricesRubricaService(prisma);
  try {
    const dto = conPipe ? ((await validar(body, CreateMatrizRubricaDto)) as CreateMatrizRubricaDto) : (body as CreateMatrizRubricaDto);
    await service.create('doc-1', dto);
    return { error: null as any, creaciones };
  } catch (error) {
    return { error, creaciones };
  }
}

test('matriz: sin niveles detallados (ausente, null o []) es válida y guarda []', async () => {
  for (const nivelesDescripcion of [undefined, null, []]) {
    for (const conPipe of [false, true]) {
      const { error, creaciones } = await crearMatriz(matrizCon(nivelesDescripcion), conPipe);
      assert.equal(error, null, `${JSON.stringify(nivelesDescripcion)} (conPipe=${conPipe}): ${mensajes(error)}`);
      assert.deepEqual(creaciones[0].data.criterios.create[0].nivelesDescripcion, []);
    }
  }
});

test('matriz: con 3, 4, 5, 6 o 7 descripciones válidas se guarda tal cual (ya no es "exactamente 5")', async () => {
  for (const k of [3, 4, 5, 6, 7]) {
    for (const conPipe of [false, true]) {
      const { error, creaciones } = await crearMatriz(matrizCon(descripciones(k)), conPipe);
      assert.equal(error, null, `${k} niveles (conPipe=${conPipe}): ${mensajes(error)}`);
      assert.equal(creaciones[0].data.criterios.create[0].nivelesDescripcion.length, k);
    }
  }
});

test('matriz: con 1, 2, 8 o 9 descripciones se rechaza con 400 y un mensaje claro (por el pipe y también directo al servicio)', async () => {
  for (const k of [1, 2, 8, 9]) {
    const conPipe = await crearMatriz(matrizCon(descripciones(k)), true);
    assert.ok(conPipe.error instanceof BadRequestException, `${k} niveles (pipe)`);
    assert.ok(hayMensaje(conPipe.error, /entre 3 y 7 niveles de desempeño \(o ninguno\)/), mensajes(conPipe.error).join(' | '));
    assert.equal(conPipe.creaciones.length, 0);

    const directo = await crearMatriz(matrizCon(descripciones(k)), false);
    assert.ok(directo.error instanceof BadRequestException, `${k} niveles (directo)`);
    assert.equal(mensajes(directo.error)[0], `El criterio «Claridad» describe ${k === 1 ? '1 nivel' : `${k} niveles`}: tienen que ser entre 3 y 7 niveles (o ninguno).`);
    assert.equal(directo.creaciones.length, 0);
  }
});

test('matriz: 4 descripciones con una vacía se rechazan (la vacía exacta por el DTO, la de puros espacios por el servicio)', async () => {
  const vacia = descripciones(4).map((d, i) => (i === 2 ? { ...d, descripcion: '' } : d));
  const porPipe = await crearMatriz(matrizCon(vacia), true);
  assert.ok(porPipe.error instanceof BadRequestException);
  assert.equal(porPipe.creaciones.length, 0);

  const enBlanco = descripciones(4).map((d, i) => (i === 2 ? { ...d, descripcion: '   ' } : d));
  const porServicio = await crearMatriz(matrizCon(enBlanco), true);
  assert.ok(porServicio.error instanceof BadRequestException);
  assert.equal(mensajes(porServicio.error)[0], 'Todos los niveles del criterio «Claridad» necesitan nombre y descripción: el nivel 3 está incompleto.');
  assert.equal(porServicio.creaciones.length, 0);
});

test('matriz: las descripciones tienen que estar numeradas 1..K sin saltos ni repetidos (desordenadas valen)', async () => {
  const salteado = descripciones(4).map((d, i) => (i === 3 ? { ...d, orden: 5 } : d));
  const repetido = descripciones(4).map((d, i) => (i === 3 ? { ...d, orden: 3 } : d));
  for (const [caso, niveles] of [['salteado', salteado], ['repetido', repetido]] as Array<[string, unknown]>) {
    const { error, creaciones } = await crearMatriz(matrizCon(niveles), true);
    assert.ok(error instanceof BadRequestException, caso);
    assert.equal(mensajes(error)[0], 'Los niveles del criterio «Claridad» tienen que estar numerados del 1 al 4, sin saltos ni repetidos.', caso);
    assert.equal(creaciones.length, 0);
  }
  assert.equal((await crearMatriz(matrizCon(descripciones(3).reverse()), true)).error, null);
});

test('matriz: una cantidad por criterio, independiente de otros criterios de la misma matriz', async () => {
  const body = {
    nombre: 'Mixta',
    criterios: [
      { nombre: 'A', descripcion: 'd', puntajeMaximo: 5, nivelesDescripcion: descripciones(3) },
      { nombre: 'B', descripcion: 'd', puntajeMaximo: 5, nivelesDescripcion: descripciones(7) },
      { nombre: 'C', descripcion: 'd', puntajeMaximo: 5 },
    ],
  };
  const { error, creaciones } = await crearMatriz(body, true);
  assert.equal(error, null, String(mensajes(error)));
  assert.deepEqual(creaciones[0].data.criterios.create.map((c: any) => c.nivelesDescripcion.length), [3, 7, 0]);
});

// ---------------------------------------------------------------------------
// 5. Corrección con IA con una escala de 3 y de 7 niveles (modelo de mentira, sin red)
// ---------------------------------------------------------------------------
function aiServiceConModelo(objeto: unknown) {
  const llamadas: any[] = [];
  const modelo = new MockLanguageModelV1({
    defaultObjectGenerationMode: 'json',
    doGenerate: async (opciones: any) => {
      llamadas.push(opciones);
      return {
        rawCall: { rawPrompt: null, rawSettings: {} },
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 20 },
        text: JSON.stringify(objeto),
      };
    },
  });
  const service = new AiService({ get: (_k: string, def?: string) => def } as any);
  (service as any).getModel = () => modelo;
  (service as any).logger = { error: () => {}, warn: () => {}, debug: () => {}, log: () => {} };
  return { service, llamadas };
}
const systemDe = (llamada: any): string => llamada.prompt.find((m: any) => m.role === 'system').content;
const usuarioDe = (llamada: any): string =>
  llamada.prompt.find((m: any) => m.role === 'user').content.map((p: any) => p.text).join('');

const CRITERIOS_IA = ['c-alto', 'c-bajo', 'c-negativo', 'c-medio', 'c-decimal'];
const preguntasIA = [
  {
    id: 'p1',
    enunciado: 'Explicá TCP',
    criterios: CRITERIOS_IA.map((id) => ({ id, nombre: id, descripcion: 'd', puntajeMaximo: 10, nivelesDescripcion: [] })),
  },
];
/** Lo que "devuelve el modelo": un nivel por criterio (a propósito, varios fuera de rango). */
const salidaIA = (nivelPorCriterio: Record<string, number>) => ({
  porPregunta: [
    {
      preguntaId: 'p1',
      notaPorCriterio: CRITERIOS_IA.map((id) => ({ criterioId: id, nombre: id, nivelSugerido: nivelPorCriterio[id], comentario: `comentario de ${id}` })),
    },
  ],
  feedbackGeneralSugerido: 'Buen trabajo',
});
const nivelesIA = (porcentajes: number[]) => porcentajes.map((porcentaje, i) => ({ orden: i + 1, nombre: `Nivel ${i + 1}`, porcentaje }));

async function corregir(porcentajes: number[], nivelPorCriterio: Record<string, number>) {
  const { service, llamadas } = aiServiceConModelo(salidaIA(nivelPorCriterio));
  const resultado = await service.corregirRespuestaExamen({
    preguntas: preguntasIA,
    respuestasAlumno: [{ preguntaId: 'p1', texto: 'TCP es un protocolo orientado a conexión' }],
    niveles: nivelesIA(porcentajes),
  });
  const por = (id: string) => resultado.porPregunta[0].notaPorCriterio.find((c) => c.criterioId === id)!;
  return { resultado, llamadas, por };
}

test('corrección con IA, escala de 3 niveles: el prompt habla de 3 niveles y el nivel se acota a [1, 3]', async () => {
  // El primer nivel vale 10 % (no 0) para distinguir "acotado a 1" de "nivel inexistente => 0 %".
  const { resultado, llamadas, por } = await corregir([10, 50, 100], { 'c-alto': 99, 'c-bajo': 0, 'c-negativo': -4, 'c-medio': 2, 'c-decimal': 2.6 });

  assert.equal(llamadas.length, 1);
  const system = systemDe(llamadas[0]);
  assert.match(system, /en 3 niveles de desempeño/);
  assert.match(system, /qué nivel \(1 a 3\) alcanzó el alumno/);
  assert.match(system, /nivelSugerido siempre es un entero entre 1 y 3\./);
  assert.ok(!/1 a 5\)|entre 1 y 5\b|en 5 niveles/.test(system), 'no queda ningún 5 fijo en el prompt');
  assert.equal(system.split('\n').filter((l) => /^Nivel \d+ \(Nivel \d+\): equivale al \d+% del puntaje del criterio$/.test(l)).length, 3);

  assert.equal(por('c-alto').nivelSugerido, 3, 'un 99 se acota al último nivel');
  assert.equal(por('c-alto').notaSugerida, 10, 'y vale el 100 % del puntaje');
  assert.equal(por('c-bajo').nivelSugerido, 1, 'un 0 sube al primer nivel');
  assert.equal(por('c-bajo').notaSugerida, 1, 'y vale el 10 % (no 0)');
  assert.equal(por('c-negativo').nivelSugerido, 1);
  assert.equal(por('c-negativo').notaSugerida, 1);
  assert.equal(por('c-medio').nivelSugerido, 2);
  assert.equal(por('c-medio').notaSugerida, 5);
  assert.equal(por('c-decimal').nivelSugerido, 3, '2,6 se redondea a 3');
  assert.equal(por('c-decimal').notaSugerida, 10);
  assert.equal(resultado.porPregunta[0].notaSugerida, 27);
  assert.equal(resultado.notaTotalSugerida, 27);
  assert.equal(resultado.feedbackGeneralSugerido, 'Buen trabajo');
});

test('corrección con IA, escala de 7 niveles: el prompt habla de 7 niveles y el nivel se acota a [1, 7]', async () => {
  const { resultado, llamadas, por } = await corregir([5, 20, 35, 50, 65, 80, 100], {
    'c-alto': 99,
    'c-bajo': 0,
    'c-negativo': -4,
    'c-medio': 4,
    'c-decimal': 6.4,
  });

  const system = systemDe(llamadas[0]);
  assert.match(system, /en 7 niveles de desempeño/);
  assert.match(system, /qué nivel \(1 a 7\) alcanzó el alumno/);
  assert.match(system, /nivelSugerido siempre es un entero entre 1 y 7\./);
  assert.ok(!/1 a 5\)|entre 1 y 5\b|en 5 niveles/.test(system), 'no queda ningún 5 fijo en el prompt');
  assert.equal(system.split('\n').filter((l) => /^Nivel \d+ \(Nivel \d+\): equivale al \d+% del puntaje del criterio$/.test(l)).length, 7);

  assert.equal(por('c-alto').nivelSugerido, 7, 'un 99 se acota a 7, no a 5');
  assert.equal(por('c-alto').notaSugerida, 10, 'el nivel 7 vale el 100 %');
  assert.equal(por('c-bajo').nivelSugerido, 1);
  assert.equal(por('c-bajo').notaSugerida, 0.5);
  assert.equal(por('c-negativo').nivelSugerido, 1);
  assert.equal(por('c-medio').nivelSugerido, 4);
  assert.equal(por('c-medio').notaSugerida, 5, 'el nivel 4 vale el 50 %');
  assert.equal(por('c-decimal').nivelSugerido, 6, '6,4 se redondea a 6');
  assert.equal(por('c-decimal').notaSugerida, 8, 'el nivel 6 vale el 80 %');
  assert.equal(resultado.porPregunta[0].notaSugerida, 24);
  assert.equal(resultado.notaTotalSugerida, 24);
});

test('corrección con IA: un 6 y un 7 son niveles válidos en una escala de 7 (con la cuenta de 5 fijos se perdían)', async () => {
  const { por } = await corregir([0, 10, 20, 40, 60, 80, 100], { 'c-alto': 7, 'c-bajo': 6, 'c-negativo': 5, 'c-medio': 3, 'c-decimal': 1 });
  assert.deepEqual(
    ['c-alto', 'c-bajo', 'c-negativo', 'c-medio', 'c-decimal'].map((id) => [por(id).nivelSugerido, por(id).notaSugerida]),
    [[7, 10], [6, 8], [5, 6], [3, 2], [1, 0]],
  );
});

test('el schema que se le pide al modelo ya no dice "entre 1 y 5" (el rango real lo impone el código)', async () => {
  const { llamadas } = await corregir([0, 50, 100], { 'c-alto': 3, 'c-bajo': 1, 'c-negativo': 1, 'c-medio': 2, 'c-decimal': 2 });
  assert.ok(!/entre 1 y 5/.test(JSON.stringify(llamadas[0].mode)), 'la descripción del campo no fija un 5');
});

// ---------------------------------------------------------------------------
// 6. Sugerir criterios con `cantidadNiveles`
// ---------------------------------------------------------------------------
const critN = (nombre: string, peso: number, k: number) => ({
  nombre,
  descripcion: `Qué evalúa ${nombre}`,
  peso,
  niveles: Array.from({ length: k }, (_, i) => `Nivel ${i + 1} concreto`),
});

test('DTO de sugerir criterios: cantidadNiveles opcional, entero de 3 a 7', async () => {
  const base = { enunciado: 'Explicá X', tipo: 'desarrollo' };
  const sin = (await validar(base, SugerirCriteriosDto)) as SugerirCriteriosDto;
  assert.equal(sin.cantidadNiveles, undefined);
  assert.equal(((await validar({ ...base, cantidadNiveles: null }, SugerirCriteriosDto)) as SugerirCriteriosDto).cantidadNiveles, null);
  for (const cantidadNiveles of [3, 4, 5, 6, 7]) {
    const dto = (await validar({ ...base, cantidadNiveles }, SugerirCriteriosDto)) as SugerirCriteriosDto;
    assert.equal(dto.cantidadNiveles, cantidadNiveles);
  }
  for (const malo of [2, 8, 'x', 0, 1, 9, -5, 2.5, 5.0000001, '5', '3', NaN, Infinity, [5], true, {}]) {
    await assert.rejects(() => validar({ ...base, cantidadNiveles: malo }, SugerirCriteriosDto), BadRequestException, `cantidadNiveles ${String(malo)}`);
  }
});

test('controller de sugerir criterios: le pasa a la IA la cantidad de niveles pedida (5 si no vino)', async () => {
  const llamadas: any[] = [];
  const ai = { sugerirCriterios: async (p: any) => (llamadas.push(p), { criterios: [] }) } as unknown as AiService;
  const controller = new SugerenciasController(ai);
  for (const cantidadNiveles of [3, 5, 7, undefined]) {
    const dto = (await validar({ enunciado: 'x', tipo: 'desarrollo', cantidadNiveles }, SugerirCriteriosDto)) as SugerirCriteriosDto;
    await controller.sugerirCriterios(dto);
  }
  assert.deepEqual(llamadas.map((l) => l.cantidadNiveles), [3, 5, 7, 5]);
  assert.ok(llamadas.every((l) => l.cantidad === 3), 'la cantidad de criterios sigue en 3 por defecto');
});

test('el prompt de sugerir criterios pide EXACTAMENTE esa cantidad de niveles (5 si no se indica)', () => {
  for (const n of [3, 4, 5, 6, 7]) {
    const { system, prompt } = armarPromptSugerencia({ enunciado: 'Explicá X', tipo: 'desarrollo', cantidad: 3, cantidadNiveles: n });
    assert.match(system, new RegExp(`EXACTAMENTE ${n} niveles de desempeño, del nivel 1 \\(el más bajo\\) al nivel ${n} \\(el mejor\\)`));
    assert.match(prompt, new RegExp(`CANTIDAD DE NIVELES POR CRITERIO: ${n}\\n`));
    if (n !== 5) assert.ok(!/EXACTAMENTE 5|al nivel 5/.test(system), `${n} niveles: no queda un 5 fijo`);
  }
  const porDefecto = armarPromptSugerencia({ enunciado: 'x', tipo: 'desarrollo', cantidad: 3 });
  assert.match(porDefecto.system, /EXACTAMENTE 5 niveles de desempeño, del nivel 1 \(el más bajo\) al nivel 5 \(el mejor\)/);
  assert.match(porDefecto.prompt, /CANTIDAD DE NIVELES POR CRITERIO: 5\n/);
  // Un valor fuera de rango (no debería llegar: el DTO lo corta) se acota.
  assert.match(armarPromptSugerencia({ enunciado: 'x', tipo: 'desarrollo', cantidad: 3, cantidadNiveles: 12 }).system, /EXACTAMENTE 7 niveles/);
  assert.match(armarPromptSugerencia({ enunciado: 'x', tipo: 'desarrollo', cantidad: 3, cantidadNiveles: 1 }).system, /EXACTAMENTE 3 niveles/);
});

test('normalizarSugerencia exige la cantidad de niveles pedida y descarta los criterios que no la cumplen', () => {
  for (const n of [3, 5, 7]) {
    const salida = {
      criterios: [
        critN('Justo', 25, n),
        critN('Uno menos', 25, n - 1),
        critN('Uno más', 25, n + 1),
        critN('Cinco fijos', 25, n === 5 ? 4 : 5),
        critN('También justo', 25, n),
      ],
    };
    const r = normalizarSugerencia(salida, 5, n);
    assert.deepEqual(r.map((c) => c.nombre), ['Justo', 'También justo'], `${n} niveles`);
    assert.ok(r.every((c) => c.niveles.length === n));
    assert.deepEqual(r.map((c) => c.peso), [50, 50]);
  }
  // Sin el tercer parámetro rige el valor por defecto (5), como antes.
  const porDefecto = normalizarSugerencia({ criterios: [critN('A', 1, 4), critN('B', 1, 5), critN('C', 1, 6)] }, 3);
  assert.deepEqual(porDefecto.map((c) => c.nombre), ['B']);
  // Un nivel vacío sigue descartando el criterio con cualquier cantidad.
  const conVacio = critN('Vacío', 1, 7);
  conVacio.niveles[3] = '   ';
  assert.throws(() => normalizarSugerencia({ criterios: [conVacio] }, 3, 7), /no devolvió criterios utilizables/);
});

test('AiService.sugerirCriterios con cantidadNiveles 3, 5 y 7: el modelo recibe el pedido y se filtran los que traen otra cantidad', async () => {
  for (const n of [3, 5, 7]) {
    const salida = {
      criterios: [critN('Justo', 1, n), critN('Corto', 1, n - 1), critN('Largo', 1, n + 1), critN('Otro justo', 1, n)],
    };
    const { service, llamadas } = aiServiceConModelo(salida);
    const r = await service.sugerirCriterios({ enunciado: 'Explicá X', tipo: 'desarrollo', cantidad: 3, cantidadNiveles: n });
    assert.deepEqual(r.criterios.map((c) => c.nombre), ['Justo', 'Otro justo'], `${n} niveles`);
    assert.ok(r.criterios.every((c) => c.niveles.length === n));
    assert.match(systemDe(llamadas[0]), new RegExp(`EXACTAMENTE ${n} niveles de desempeño`));
    assert.match(usuarioDe(llamadas[0]), new RegExp(`CANTIDAD DE NIVELES POR CRITERIO: ${n}`));
  }
});

test('AiService.sugerirCriterios sin cantidadNiveles pide 5; con un valor inválido (2, 8, "x") lo acota en vez de pedir algo absurdo', async () => {
  const { service, llamadas } = aiServiceConModelo({ criterios: [critN('A', 1, 5)] });
  const r = await service.sugerirCriterios({ enunciado: 'x', tipo: 'desarrollo', cantidad: 3 });
  assert.equal(r.criterios[0].niveles.length, 5);
  assert.match(systemDe(llamadas[0]), /EXACTAMENTE 5 niveles/);

  for (const [pedido, efectivo] of [[2, 3], [8, 7], ['x', 5]] as Array<[any, number]>) {
    const { service: s, llamadas: l } = aiServiceConModelo({ criterios: [critN('A', 1, efectivo)] });
    const resultado = await s.sugerirCriterios({ enunciado: 'x', tipo: 'desarrollo', cantidad: 3, cantidadNiveles: pedido });
    assert.match(systemDe(l[0]), new RegExp(`EXACTAMENTE ${efectivo} niveles`), `pedido ${String(pedido)}`);
    assert.equal(resultado.criterios[0].niveles.length, efectivo);
  }
});

// ---------------------------------------------------------------------------
// 7. Regresión: un examen de 5 niveles se comporta igual que antes
// ---------------------------------------------------------------------------
test('regresión: la escala de 5 niveles de siempre (wizard y fixtures) sigue siendo válida', async () => {
  for (const p of [[0, 25, 50, 75, 100], [0, 10, 30, 60, 100], [0, 35, 60, 85, 100], [20, 40, 60, 80, 100]]) {
    assert.equal(validarNivelesEscala(nivelesCon(p)), null, p.join('/'));
    assert.equal((await crear(examenCon(nivelesCon(p)), true)).error, null, p.join('/'));
  }
  assert.match(validarNivelesEscala(nivelesCon([0, 25, 50, 75, 90])) as string, /último nivel de la escala \(N5\) tiene que valer 100 %/);
  assert.match(validarNivelesEscala(nivelesCon([0, 90, 50, 75, 100])) as string, /«N2» vale 90 % y «N3» vale 50 %/);
});

test('regresión: en un examen de 5 niveles los criterios siguen siendo "los 5 o ninguno"', async () => {
  const n5 = nivelesCon([20, 40, 60, 80, 100]);
  assert.equal((await crear(examenCon(n5, [abierta('Claridad')]), true)).error, null);
  assert.equal((await crear(examenCon(n5, [abierta('Claridad', [])]), true)).error, null);
  assert.equal((await crear(examenCon(n5, [abierta('Claridad', descripciones(5))]), true)).error, null);
  for (const k of [1, 3, 4, 6]) {
    const { error, creados } = await crear(examenCon(n5, [abierta('Claridad', descripciones(k))]), true);
    assert.ok(error instanceof BadRequestException, `${k} descripciones`);
    assert.equal(creados.length, 0);
  }
});

test('regresión: la corrección con IA de un examen de 5 niveles dice lo mismo que antes y acota a [1, 5]', async () => {
  const { resultado, llamadas, por } = await corregir([20, 40, 60, 80, 100], { 'c-alto': 99, 'c-bajo': 0, 'c-negativo': -4, 'c-medio': 4, 'c-decimal': 2.6 });
  const system = systemDe(llamadas[0]);
  assert.match(system, /Cada criterio se evalúa\nen 5 niveles de desempeño, cada uno con su equivalencia en % del puntaje del criterio\./);
  assert.match(system, /qué nivel \(1 a 5\) alcanzó el alumno/);
  assert.match(system, /- nivelSugerido siempre es un entero entre 1 y 5\./);

  assert.deepEqual(
    ['c-alto', 'c-bajo', 'c-negativo', 'c-medio', 'c-decimal'].map((id) => [por(id).nivelSugerido, por(id).notaSugerida]),
    [[5, 10], [1, 2], [1, 2], [4, 8], [3, 6]],
  );
  assert.equal(resultado.notaTotalSugerida, 28);
});

test('regresión: sugerir criterios sin cantidadNiveles sigue pidiendo y exigiendo 5 niveles', async () => {
  const dto = (await validar({ enunciado: 'x', tipo: 'desarrollo' }, SugerirCriteriosDto)) as SugerirCriteriosDto;
  assert.equal(dto.cantidadNiveles, undefined);
  const { system } = armarPromptSugerencia({ enunciado: 'x', tipo: 'desarrollo', cantidad: 3 });
  assert.match(system, /EXACTAMENTE 5 niveles/);
  const r = normalizarSugerencia({ criterios: [critN('Cuatro', 1, 4), critN('Cinco', 1, 5), critN('Seis', 1, 6)] });
  assert.deepEqual(r.map((c) => c.nombre), ['Cinco']);
});

test('regresión: las matrices de 5 niveles (y las sin niveles) se guardan igual que antes', async () => {
  const cinco = await crearMatriz(matrizCon(descripciones(5)));
  assert.equal(cinco.error, null);
  assert.deepEqual(cinco.creaciones[0].data.criterios.create[0].nivelesDescripcion.map((n: any) => n.orden), [1, 2, 3, 4, 5]);
  const sin = await crearMatriz(matrizCon());
  assert.deepEqual(sin.creaciones[0].data.criterios.create[0].nivelesDescripcion, []);
});
