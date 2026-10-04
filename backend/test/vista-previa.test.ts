// Tests de la vista previa del alumno del wizard de "Nuevo examen" (frontend/lib/vista-previa.ts): conversión del formulario en lo que
// el servidor le entregaría al alumno (ids, puntos efectivos, opciones saneadas SIN la clave de respuesta), qué se le muestra de la
// pantalla de ingreso (duración y monitoreo) y que los textos repetidos sigan siendo los de la pantalla real. Funciones puras:
// corren sin base de datos ni navegador.
//   node --require ts-node/register --test test/vista-previa.test.ts   (o `npm test`, una vez agregado al script)
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TipoPregunta } from '../../frontend/lib/api';
import { construirOpciones, datosPorDefecto, nivelesPorDefecto, preguntaVacia, puntajeEfectivoDe } from '../../frontend/lib/examen-form';
import type { DatosForm, PreguntaForm } from '../../frontend/lib/examen-form';
import {
  ENUNCIADO_VACIO,
  TEXTOS_INGRESO_ALUMNO,
  antiCheatParaAlumno,
  avisoDuracionTitulo,
  cantidadRespondidas,
  duracionParaAlumno,
  preguntasParaAlumno,
} from '../../frontend/lib/vista-previa';
import { sanitizarOpcionesParaAlumno } from '../src/respuestas-examen/correccion-cerradas.util';

// ---------------------------------------------------------------------------
// Fixtures: una pregunta COMPLETA de cada uno de los 10 tipos, con una clave de respuesta fácil de reconocer en la salida
// ---------------------------------------------------------------------------
const NIVELES = nivelesPorDefecto();
const TIPOS_ABIERTOS: TipoPregunta[] = ['desarrollo', 'resolucion_problema', 'demostracion', 'analisis_caso', 'respuesta_corta'];
const TIPOS_CERRADOS: TipoPregunta[] = ['numerica', 'relacionar_pares', 'opcion_multiple', 'casillas', 'verdadero_falso'];
const TODOS: TipoPregunta[] = [...TIPOS_ABIERTOS, ...TIPOS_CERRADOS];

const CLAVE_NUMERICA = '987654.321';
const CLAVE_TOLERANCIA = '0.123456';

function completa(tipo: TipoPregunta, puntaje = '2'): PreguntaForm {
  const base: PreguntaForm = { ...preguntaVacia(NIVELES), tipo, enunciado: `Enunciado de ${tipo}`, puntajeMaximo: puntaje };
  switch (tipo) {
    case 'opcion_multiple':
      return { ...base, opcionesChoice: [{ id: 'a', texto: 'Madrid', correcta: false }, { id: 'b', texto: 'París', correcta: true }, { id: 'c', texto: 'Roma', correcta: false }] };
    case 'casillas':
      return { ...base, opcionesChoice: [{ id: 'a', texto: 'C', correcta: true }, { id: 'b', texto: 'Python', correcta: false }, { id: 'c', texto: 'Rust', correcta: true }] };
    case 'verdadero_falso':
      return { ...base, vfCorrecta: 'false' };
    case 'numerica':
      return { ...base, numRespuestaCorrecta: CLAVE_NUMERICA, numTolerancia: CLAVE_TOLERANCIA };
    case 'relacionar_pares':
      return { ...base, paresIzquierda: ['Argentina', 'Chile', 'Perú'], paresDerecha: ['Buenos Aires', 'Santiago', 'Lima'] };
    default:
      // Abierta con una rúbrica cargada: nada de eso le llega al alumno.
      return { ...base, criterios: [{ ...base.criterios[0], nombre: 'Criterio secreto', descripcion: 'Descripción de la rúbrica', peso: '3' }] };
  }
}
const todasCompletas = () => TODOS.map((t) => completa(t));

// ---------------------------------------------------------------------------
// 1. Los 10 tipos
// ---------------------------------------------------------------------------
test('preguntasParaAlumno: devuelve una PreguntaRendir por pregunta, con exactamente id, tipo, enunciado, puntajeMaximo y opciones', () => {
  const salida = preguntasParaAlumno(todasCompletas());
  assert.equal(salida.length, 10);
  salida.forEach((p, i) => {
    assert.deepEqual(Object.keys(p).sort(), ['enunciado', 'id', 'opciones', 'puntajeMaximo', 'tipo'], `pregunta ${i + 1}`);
    assert.equal(p.tipo, TODOS[i]);
    assert.equal(p.enunciado, `Enunciado de ${TODOS[i]}`);
    assert.equal(p.puntajeMaximo, '2');
  });
});

test('preguntasParaAlumno: las abiertas, verdadero/falso y numérica no llevan opciones (null)', () => {
  const salida = preguntasParaAlumno(todasCompletas());
  for (const tipo of [...TIPOS_ABIERTOS, 'verdadero_falso', 'numerica'] as TipoPregunta[]) {
    assert.equal(salida.find((p) => p.tipo === tipo)!.opciones, null, tipo);
  }
});

test('preguntasParaAlumno: opción múltiple y casillas -> [{ id, texto }] sin `correcta`', () => {
  const salida = preguntasParaAlumno(todasCompletas());
  assert.deepEqual(salida.find((p) => p.tipo === 'opcion_multiple')!.opciones, [
    { id: 'a', texto: 'Madrid' },
    { id: 'b', texto: 'París' },
    { id: 'c', texto: 'Roma' },
  ]);
  assert.deepEqual(salida.find((p) => p.tipo === 'casillas')!.opciones, [
    { id: 'a', texto: 'C' },
    { id: 'b', texto: 'Python' },
    { id: 'c', texto: 'Rust' },
  ]);
  for (const tipo of ['opcion_multiple', 'casillas']) {
    for (const o of salida.find((p) => p.tipo === tipo)!.opciones as object[]) assert.deepEqual(Object.keys(o), ['id', 'texto']);
  }
});

test('preguntasParaAlumno: relacionar pares -> { izquierda, derecha } sin los pares correctos, y SIN mezclar (el servidor no mezcla)', () => {
  const op = preguntasParaAlumno(todasCompletas()).find((p) => p.tipo === 'relacionar_pares')!.opciones as Record<string, unknown>;
  assert.deepEqual(Object.keys(op).sort(), ['derecha', 'izquierda']);
  assert.deepEqual(op.izquierda, ['Argentina', 'Chile', 'Perú']);
  // Mismo orden que se cargó: es lo que entrega `sanitizarOpcionesParaAlumno` hoy (si el backend empezara a mezclar, este test avisa
  // que la vista previa tiene que mezclar con la misma regla).
  assert.deepEqual(op.derecha, ['Buenos Aires', 'Santiago', 'Lima']);
});

test('preguntasParaAlumno: coincide con sanitizarOpcionesParaAlumno del backend para las preguntas completas de los 10 tipos', () => {
  for (const p of todasCompletas()) {
    const [salida] = preguntasParaAlumno([p]);
    assert.deepEqual(salida.opciones, sanitizarOpcionesParaAlumno(p.tipo, construirOpciones(p)), p.tipo);
  }
});

// ---------------------------------------------------------------------------
// 2. La clave de respuesta NUNCA llega a la vista previa
// ---------------------------------------------------------------------------
test('preguntasParaAlumno: ningún correcta / respuestaCorrecta / tolerancia / paresCorrectos (ni su valor) aparece en la salida serializada', () => {
  const json = JSON.stringify(preguntasParaAlumno(todasCompletas()));
  for (const prohibido of ['correcta', 'Correcta', 'respuestaCorrecta', 'tolerancia', 'paresCorrectos', 'vfCorrecta', 'numRespuestaCorrecta', 'numTolerancia']) {
    assert.ok(!json.includes(prohibido), `la salida no debe contener "${prohibido}"`);
  }
  assert.ok(!json.includes(CLAVE_NUMERICA), 'el valor de la respuesta numérica no debe aparecer');
  assert.ok(!json.includes(CLAVE_TOLERANCIA), 'el valor de la tolerancia no debe aparecer');
  // Ni la rúbrica de las abiertas.
  assert.ok(!json.includes('Criterio secreto') && !json.includes('Descripción de la rúbrica') && !json.includes('criterios'));
});

test('preguntasParaAlumno: aunque la opción traiga campos de más (la clave incluida), solo salen id y texto', () => {
  const p = completa('opcion_multiple');
  const conExtras = { ...p, opcionesChoice: p.opcionesChoice.map((o) => ({ ...o, pista: 'secreta', esLaBuena: o.correcta })) } as PreguntaForm;
  const json = JSON.stringify(preguntasParaAlumno([conExtras]));
  assert.ok(!json.includes('pista') && !json.includes('esLaBuena') && !json.includes('secreta'));
});

test('preguntasParaAlumno: verdadero/falso y numérica no dejan rastro de la respuesta, sea cual sea', () => {
  for (const vf of ['true', 'false'] as const) {
    const [s] = preguntasParaAlumno([{ ...completa('verdadero_falso'), vfCorrecta: vf }]);
    assert.deepEqual(s, { id: 'p1', tipo: 'verdadero_falso', enunciado: 'Enunciado de verdadero_falso', puntajeMaximo: '2', opciones: null });
  }
  const [n] = preguntasParaAlumno([completa('numerica')]);
  assert.deepEqual(n, { id: 'p1', tipo: 'numerica', enunciado: 'Enunciado de numerica', puntajeMaximo: '2', opciones: null });
});

test('preguntasParaAlumno: no modifica el formulario ni comparte arreglos con él', () => {
  const preguntas = todasCompletas();
  const antes = JSON.stringify(preguntas);
  const salida = preguntasParaAlumno(preguntas);
  assert.equal(JSON.stringify(preguntas), antes, 'el formulario queda intacto');
  const pares = salida.find((p) => p.tipo === 'relacionar_pares')!.opciones as { izquierda: string[]; derecha: string[] };
  pares.izquierda.push('X');
  pares.derecha.length = 0;
  assert.equal(JSON.stringify(preguntas), antes, 'tocar la salida no toca el formulario');
});

// ---------------------------------------------------------------------------
// 3. Puntos, ids y orden
// ---------------------------------------------------------------------------
test('preguntasParaAlumno: puntajeMaximo es el efectivo (puntajeEfectivoDe) como texto: inválido o <= 0 -> "0"', () => {
  const casos: Array<[string, string]> = [
    ['2', '2'],
    ['1.5', '1.5'],
    ['7.50', '7.5'],
    ['0.1', '0.1'],
    ['10.005', '10.01'],
    ['', '0'],
    ['  ', '0'],
    ['abc', '0'],
    ['0', '0'],
    ['-3', '0'],
  ];
  for (const [entrada, esperado] of casos) {
    const [s] = preguntasParaAlumno([completa('desarrollo', entrada)]);
    assert.equal(s.puntajeMaximo, esperado, `puntaje "${entrada}"`);
    if (Number(esperado) > 0 && entrada !== '10.005') assert.equal(Number(s.puntajeMaximo), puntajeEfectivoDe(completa('desarrollo', entrada)));
  }
  // Para todos los tipos, no solo para las abiertas.
  for (const tipo of TODOS) assert.equal(preguntasParaAlumno([completa(tipo, '3')])[0].puntajeMaximo, '3', tipo);
});

test('preguntasParaAlumno: ids estables "p1", "p2"… por posición, únicos y repetibles; respeta el orden del formulario', () => {
  const preguntas = [completa('casillas'), completa('desarrollo'), completa('numerica'), completa('opcion_multiple')];
  const salida = preguntasParaAlumno(preguntas);
  assert.deepEqual(salida.map((p) => p.id), ['p1', 'p2', 'p3', 'p4']);
  assert.deepEqual(salida.map((p) => p.tipo), ['casillas', 'desarrollo', 'numerica', 'opcion_multiple']);
  assert.deepEqual(preguntasParaAlumno(preguntas).map((p) => p.id), salida.map((p) => p.id), 'misma entrada, mismos ids');
  // Invertir el formulario invierte la salida (el orden es el de la lista, no el tipo).
  assert.deepEqual(preguntasParaAlumno([...preguntas].reverse()).map((p) => p.tipo), ['opcion_multiple', 'numerica', 'desarrollo', 'casillas']);
  assert.deepEqual(preguntasParaAlumno([]), []);
});

test('preguntasParaAlumno: el enunciado va sin espacios de los costados, como lo guarda el servidor', () => {
  const [s] = preguntasParaAlumno([{ ...completa('desarrollo'), enunciado: '   ¿Qué es un TAD?  \n' }]);
  assert.equal(s.enunciado, '¿Qué es un TAD?');
});

// ---------------------------------------------------------------------------
// 4. Preguntas incompletas (el docente todavía está cargando)
// ---------------------------------------------------------------------------
test('preguntasParaAlumno: pregunta recién agregada (vacía): no revienta y muestra un enunciado de reemplazo', () => {
  const [s] = preguntasParaAlumno([preguntaVacia(NIVELES)]);
  assert.deepEqual(s, { id: 'p1', tipo: 'desarrollo', enunciado: ENUNCIADO_VACIO, puntajeMaximo: '0', opciones: null });
  assert.equal(preguntasParaAlumno([{ ...preguntaVacia(NIVELES), enunciado: '   ' }])[0].enunciado, ENUNCIADO_VACIO);
});

test('preguntasParaAlumno: opción múltiple / casillas con opciones vacías -> solo las que tienen texto (o [])', () => {
  for (const tipo of ['opcion_multiple', 'casillas'] as const) {
    const vacia = { ...preguntaVacia(NIVELES), tipo, enunciado: 'Elegí' }; // trae 2 opciones sin texto
    assert.deepEqual(preguntasParaAlumno([vacia])[0].opciones, [], tipo);

    const una = { ...vacia, opcionesChoice: [{ id: 'a', texto: '', correcta: true }, { id: 'b', texto: 'Solo esta', correcta: false }, { id: 'c', texto: '   ', correcta: false }] };
    assert.deepEqual(preguntasParaAlumno([una])[0].opciones, [{ id: 'b', texto: 'Solo esta' }], tipo);

    const sinNinguna = { ...vacia, opcionesChoice: [] };
    assert.deepEqual(preguntasParaAlumno([sinNinguna])[0].opciones, [], tipo);
  }
});

test('preguntasParaAlumno: relacionar pares a medio cargar -> sin renglones en blanco (y nunca una clave)', () => {
  const vacia = { ...preguntaVacia(NIVELES), tipo: 'relacionar_pares' as const, enunciado: 'Relacioná' }; // ['', ''] / ['', '']
  assert.deepEqual(preguntasParaAlumno([vacia])[0].opciones, { izquierda: [], derecha: [] });

  const parcial = { ...vacia, paresIzquierda: ['Argentina', '', 'Chile'], paresDerecha: ['Buenos Aires', 'Lima', ''] };
  const op = preguntasParaAlumno([parcial])[0].opciones as { izquierda: string[]; derecha: string[] };
  assert.deepEqual(op, { izquierda: ['Argentina', 'Chile'], derecha: ['Buenos Aires', 'Lima'] });
  assert.ok(!JSON.stringify(op).includes('paresCorrectos'));
});

test('preguntasParaAlumno: numérica sin respuesta cargada no produce NaN ni rastro de la clave', () => {
  const [s] = preguntasParaAlumno([{ ...preguntaVacia(NIVELES), tipo: 'numerica', enunciado: 'Cuánto', puntajeMaximo: '1' }]);
  assert.equal(s.opciones, null);
  assert.ok(!JSON.stringify(s).includes('NaN'));
});

// ---------------------------------------------------------------------------
// 5. Pantalla de ingreso: duración y monitoreo
// ---------------------------------------------------------------------------
const datos = (cambios: Partial<DatosForm> = {}): DatosForm => ({ ...datosPorDefecto(), ...cambios });

test('duracionParaAlumno: solo en sesión con tiempo y con una duración válida (>= 1)', () => {
  assert.equal(duracionParaAlumno(datos({ modalidad: 'sesion_tiempo', duracionMinutos: '90' })), 90);
  assert.equal(duracionParaAlumno(datos({ modalidad: 'sesion_tiempo', duracionMinutos: '1' })), 1);
  assert.equal(duracionParaAlumno(datos({ modalidad: 'ventana_dias', duracionMinutos: '90' })), null, 'ventana de días: no hay aviso aunque quede un valor cargado');
  for (const mala of ['', '  ', 'abc', '0', '-5', '0.5']) {
    assert.equal(duracionParaAlumno(datos({ modalidad: 'sesion_tiempo', duracionMinutos: mala })), null, `"${mala}"`);
  }
});

test('antiCheatParaAlumno: null si está apagado o si no quedó ningún control (igual que antiCheatActivo del servidor)', () => {
  assert.equal(antiCheatParaAlumno(datos({ antiCheatOn: false })), null);
  assert.equal(antiCheatParaAlumno(datos({ antiCheatOn: false, acPantalla: true, acPestana: true, acPegado: true })), null);
  assert.equal(antiCheatParaAlumno(datos({ antiCheatOn: true, acPantalla: false, acPestana: false, acPegado: false })), null);
  assert.deepEqual(antiCheatParaAlumno(datos({ antiCheatOn: true })), { pantallaCompleta: true, cambioPestana: true, pegado: true });
  assert.deepEqual(antiCheatParaAlumno(datos({ antiCheatOn: true, acPantalla: false, acPestana: false })), { pantallaCompleta: false, cambioPestana: false, pegado: true });
});

test('cantidadRespondidas: misma regla que el examen en curso (vacío, null y [] no cuentan; false y 0 sí)', () => {
  const ps = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }, { id: 'p5' }, { id: 'p6' }, { id: 'p7' }];
  assert.equal(cantidadRespondidas(ps, {}), 0);
  assert.equal(cantidadRespondidas(ps, { p1: '', p2: null, p3: undefined, p4: [] }), 0);
  assert.equal(cantidadRespondidas(ps, { p1: 'texto', p2: 0, p3: false, p4: ['a'], p5: [['Chile', 'Santiago']], p6: 'b' }), 6);
  assert.equal(cantidadRespondidas(ps, { fantasma: 'x' }), 0, 'solo cuentan las preguntas del examen');
});

// ---------------------------------------------------------------------------
// 6. Los textos repetidos siguen siendo los de la pantalla real del alumno, y el componente es el mismo
// ---------------------------------------------------------------------------
const FRONT = join(__dirname, '..', '..', 'frontend', 'app');
const leer = (...partes: string[]) => readFileSync(join(FRONT, ...partes), 'utf8');
const sinEspaciosRaros = (s: string) => s.replace(/\s+/g, ' ');

test('textos: TEXTOS_INGRESO_ALUMNO es copia de lo que dice app/rendir/[slug]/page.tsx', () => {
  const fuente = sinEspaciosRaros(leer('rendir', '[slug]', 'page.tsx'));
  for (const [clave, texto] of Object.entries(TEXTOS_INGRESO_ALUMNO)) {
    assert.ok(fuente.includes(sinEspaciosRaros(texto)), `"${clave}" ya no coincide con la pantalla real: ${texto}`);
  }
  assert.ok(fuente.includes(avisoDuracionTitulo(0).replace('0', '{examen.duracionMinutos}')), 'el título del aviso de duración ya no coincide con la pantalla real');
  assert.equal(avisoDuracionTitulo(90), 'Tenés 90 minutos.');
});

test('componente: el examen en curso y la vista previa usan el MISMO TarjetaPreguntaAlumno, y ExamenEnCurso ya no tiene su propio renderizado', () => {
  const enCurso = leer('rendir', '[slug]', 'ExamenEnCurso.tsx');
  const vistaPrevia = leer('examenes', 'nuevo', 'VistaPreviaAlumno.tsx');
  const importa = /import \{[^}]*\bTarjetaPreguntaAlumno\b[^}]*\} from '@\/app\/components\/PreguntaAlumno'/;
  assert.match(enCurso, importa);
  assert.match(vistaPrevia, importa);
  assert.ok(!enCurso.includes('CampoRespuesta') && !enCurso.includes('<textarea') && !enCurso.includes('type="radio"'), 'ExamenEnCurso no debe duplicar el renderizado de las preguntas');
  assert.ok(!vistaPrevia.includes('<textarea') && !vistaPrevia.includes('type="radio"'), 'la vista previa no debe duplicar el renderizado de las preguntas');
});

test('cantidadRespondidas: sigue la misma regla que tieneRespuesta de ExamenEnCurso', () => {
  const fuente = sinEspaciosRaros(leer('rendir', '[slug]', 'ExamenEnCurso.tsx'));
  assert.ok(fuente.includes("if (v === null || v === undefined || v === '') return false; if (Array.isArray(v)) return v.length > 0; return true;"));
});
