// "Relacionar pares": la columna derecha que recibe el alumno NO puede salir en el orden de las parejas (derecha[i] es la pareja
// correcta de izquierda[i]: entregarla así regalaba la respuesta por posición). Tests sin base de datos:
//   npm test
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { corregirPreguntaCerrada, mezclarDeterministico, sanitizarOpcionesParaAlumno } from '../src/respuestas-examen/correccion-cerradas.util';
import { mezclarDeterministico as mezclarEnElFront } from '../../frontend/lib/vista-previa';

const izquierda = ['Argentina', 'Chile', 'Perú', 'Uruguay', 'Bolivia'];
const derecha = ['Buenos Aires', 'Santiago', 'Lima', 'Montevideo', 'Sucre'];
const opciones = { izquierda, derecha, paresCorrectos: izquierda.map((x, i) => [x, derecha[i]]) };
const salidaDe = (op: unknown, semilla?: string) => sanitizarOpcionesParaAlumno('relacionar_pares', op, semilla) as { izquierda: string[]; derecha: string[] };

test('la derecha es una permutación de lo cargado: no se pierde ni se agrega nada, y la izquierda no cambia', () => {
  const s = salidaDe(opciones, 'pregunta-1');
  assert.deepEqual([...s.derecha].sort(), [...derecha].sort());
  assert.deepEqual(s.izquierda, izquierda);
  assert.deepEqual(Object.keys(s).sort(), ['derecha', 'izquierda'], 'sin paresCorrectos');
  assert.doesNotMatch(JSON.stringify(s), /paresCorrectos/);
});

test('es estable: la misma pregunta devuelve siempre el mismo orden (recargar la página o retomar el intento no lo cambia)', () => {
  const a = salidaDe(opciones, 'pregunta-1').derecha;
  for (let i = 0; i < 20; i += 1) assert.deepEqual(salidaDe(opciones, 'pregunta-1').derecha, a);
  assert.deepEqual(salidaDe(opciones).derecha, salidaDe(opciones).derecha, 'también sin semilla (depende del contenido)');
});

test('la semilla importa: distintas preguntas con el mismo contenido no comparten orden', () => {
  const ordenes = new Set(Array.from({ length: 40 }, (_, i) => salidaDe(opciones, `pregunta-${i}`).derecha.join('|')));
  assert.ok(ordenes.size > 15, `solo ${ordenes.size} órdenes distintos en 40 preguntas`);
});

test('LA PROPIEDAD DE SEGURIDAD: el orden entregado casi nunca coincide con el de las parejas (con 5 pares, ~1 de cada 120)', () => {
  let alineadas = 0;
  const TOTAL = 600;
  for (let i = 0; i < TOTAL; i += 1) if (salidaDe(opciones, `q-${i}`).derecha.every((d, k) => d === derecha[k])) alineadas += 1;
  assert.ok(alineadas / TOTAL < 0.03, `${alineadas}/${TOTAL} salieron alineadas con las parejas`);
  // Y ninguna posición queda "fija": cada elemento aparece en todas las posiciones con frecuencia parecida (uniforme, ~20 %).
  const cuenta = derecha.map(() => derecha.map(() => 0));
  for (let i = 0; i < TOTAL; i += 1) salidaDe(opciones, `q-${i}`).derecha.forEach((d, pos) => (cuenta[derecha.indexOf(d)][pos] += 1));
  for (const fila of cuenta) for (const n of fila) assert.ok(n / TOTAL > 0.1 && n / TOTAL < 0.3, `posición sesgada: ${n}/${TOTAL}`);
});

test('con 2 pares tampoco se delata: sale tanto alineado como cruzado, sin una regla fija que el alumno pueda adivinar', () => {
  const dos = { izquierda: ['A', 'B'], derecha: ['x', 'y'], paresCorrectos: [['A', 'x'], ['B', 'y']] };
  const vistos = new Set(Array.from({ length: 60 }, (_, i) => salidaDe(dos, `q-${i}`).derecha.join('')));
  assert.deepEqual([...vistos].sort(), ['xy', 'yx']);
});

test('corregir NO se ve afectado: se corrige por texto, así que da igual en qué orden se mostraron las opciones', () => {
  const mostrado = salidaDe(opciones, 'pregunta-1');
  // El alumno acierta todo: para cada izquierda elige su pareja correcta, buscándola en la columna que le mostraron.
  const respuestaOk = mostrado.izquierda.map((izq) => [izq, mostrado.derecha.find((d) => d === derecha[izquierda.indexOf(izq)])]);
  assert.equal(corregirPreguntaCerrada('relacionar_pares', opciones, respuestaOk).correcta, true);
  // Y una respuesta cruzada sigue siendo incorrecta.
  const cruzada = mostrado.izquierda.map((izq, k) => [izq, mostrado.derecha[k]]).filter((_, k) => k < 4);
  assert.equal(corregirPreguntaCerrada('relacionar_pares', opciones, cruzada).correcta, false);
});

test('el backend y la vista previa del wizard mezclan EXACTAMENTE igual (copia fiel de la misma regla)', () => {
  for (const semilla of ['', 'a', 'pregunta-1', '|x\u0001y|1\u00012', '🙂ñ', 'x'.repeat(500)]) {
    const listas: unknown[][] = [[], [1], [1, 2], [1, 2, 3], derecha, [...derecha, ...izquierda, 'extra']];
    for (const lista of listas) {
      assert.deepEqual(mezclarEnElFront(lista, semilla), mezclarDeterministico(lista, semilla), `semilla «${semilla.slice(0, 12)}» con ${lista.length} elementos`);
    }
  }
});

test('mezclarDeterministico no muta la lista de entrada', () => {
  const original = [...derecha];
  mezclarDeterministico(derecha, 'x');
  assert.deepEqual(derecha, original);
});

test('el resto de los tipos no cambia: opción múltiple/casillas conservan el orden y siguen sin la clave', () => {
  const op = [{ id: 'a', texto: 'A', correcta: true }, { id: 'b', texto: 'B', correcta: false }, { id: 'c', texto: 'C', correcta: false }];
  assert.deepEqual(sanitizarOpcionesParaAlumno('opcion_multiple', op, 'q'), [{ id: 'a', texto: 'A' }, { id: 'b', texto: 'B' }, { id: 'c', texto: 'C' }]);
  assert.equal(sanitizarOpcionesParaAlumno('verdadero_falso', { correcta: true }, 'q'), null);
  assert.equal(sanitizarOpcionesParaAlumno('numerica', { respuestaCorrecta: 3 }, 'q'), null);
});
