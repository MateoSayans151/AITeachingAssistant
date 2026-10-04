// Borrador del wizard (se guarda en el navegador) y resumen de los ajustes plegados. Funciones puras, sin DOM ni storage:
//   npm test
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { borradorTieneContenido, claveBorrador, haceCuanto, leerBorrador, serializarBorrador, VERSION_BORRADOR } from '../../frontend/lib/borrador-examen';
import { datosPorDefecto, hayErrorEnAjustes, nivelesPorDefecto, preguntaVacia, resumenAjustes } from '../../frontend/lib/examen-form';
import type { DatosForm, PreguntaForm } from '../../frontend/lib/examen-form';

const NIVELES = nivelesPorDefecto();
const completo = (): { datos: DatosForm; preguntas: PreguntaForm[] } => {
  const datos = { ...datosPorDefecto(), cursoElegido: 'curso-1', titulo: 'Parcial 1', consigna: 'Respondé todo', modalidad: 'sesion_tiempo' as const, duracionMinutos: '45', antiCheatOn: true };
  const abierta: PreguntaForm = { ...preguntaVacia(NIVELES), tipo: 'desarrollo', enunciado: 'Explicá X', puntajeMaximo: '6', criterios: [{ nombre: 'Claridad', descripcion: 'Se entiende', peso: '1', detallar: false, niveles: NIVELES.map((n) => ({ orden: n.orden, nombre: n.nombre, descripcion: '' })) }] };
  const opcion: PreguntaForm = { ...preguntaVacia(NIVELES), tipo: 'opcion_multiple', enunciado: '¿Cuál?', puntajeMaximo: '4', opcionesChoice: [{ id: 'a', texto: 'Uno', correcta: true }, { id: 'b', texto: 'Dos', correcta: false }], plegada: true };
  return { datos, preguntas: [abierta, opcion] };
};

test('ida y vuelta: lo que se guarda se lee igual (datos, preguntas, niveles, plegadas)', () => {
  const { datos, preguntas } = completo();
  const leido = leerBorrador(serializarBorrador(datos, preguntas, 1234));
  assert.ok(leido);
  assert.equal(leido.guardadoEn, 1234);
  assert.deepEqual(leido.datos, datos);
  assert.deepEqual(leido.preguntas, preguntas);
});

test('la clave es por docente (dos docentes en el mismo navegador no ven el borrador del otro)', () => {
  assert.notEqual(claveBorrador('doc-1'), claveBorrador('doc-2'));
  assert.match(claveBorrador('doc-1'), /doc-1$/);
});

test('un storage vacío, roto o de otra versión no se interpreta: devuelve null y no rompe', () => {
  for (const crudo of [null, undefined, '', 'no es json', '{', '[]', '123', 'null', '"texto"', '{"version":99,"datos":{},"preguntas":[]}', '{"version":1}', '{"version":1,"datos":{},"preguntas":"x"}', '{"version":1,"datos":[],"preguntas":[]}']) {
    assert.equal(leerBorrador(crudo as string | null | undefined), null, String(crudo));
  }
});

test('datos incompletos o de tipo equivocado se completan con los valores por defecto (no se confía en el storage)', () => {
  const crudo = JSON.stringify({ version: VERSION_BORRADOR, guardadoEn: 'ayer', datos: { titulo: 42, consigna: 'ok', modalidad: 'rara', escalaMax: null, niveles: 'no' }, preguntas: [{ tipo: 'desarrollo', enunciado: 7 }] });
  const b = leerBorrador(crudo)!;
  assert.equal(b.datos.titulo, '');
  assert.equal(b.datos.consigna, 'ok');
  assert.equal(b.datos.modalidad, 'ventana_dias');
  assert.equal(b.datos.escalaMax, datosPorDefecto().escalaMax);
  assert.deepEqual(b.datos.niveles, nivelesPorDefecto(), 'niveles inválidos -> escala por defecto');
  assert.equal(b.guardadoEn, 0);
  assert.equal(b.preguntas.length, 1);
  assert.equal(b.preguntas[0].enunciado, '');
});

test('preguntas: se descartan las de tipo desconocido o que no son objetos; si no queda ninguna, una pregunta vacía', () => {
  const buena = completo().preguntas[1];
  const crudo = JSON.stringify({ version: 1, guardadoEn: 1, datos: {}, preguntas: [null, 5, 'x', { tipo: 'inventado' }, buena, { enunciado: 'sin tipo' }] });
  const b = leerBorrador(crudo)!;
  assert.equal(b.preguntas.length, 1);
  assert.equal(b.preguntas[0].tipo, 'opcion_multiple');
  const ninguna = leerBorrador(JSON.stringify({ version: 1, guardadoEn: 1, datos: {}, preguntas: [{ tipo: 'inventado' }] }))!;
  assert.equal(ninguna.preguntas.length, 1);
  assert.equal(ninguna.preguntas[0].enunciado, '');
});

test('la cantidad de niveles guardada se respeta si es válida (3 a 7) y se descarta si no', () => {
  const con = (n: number) => ({ version: 1, guardadoEn: 1, datos: { niveles: Array.from({ length: n }, (_, i) => ({ nombre: `N${i}`, colorHex: '#000000', porcentaje: String(i * 10) })) }, preguntas: [] });
  assert.equal(leerBorrador(JSON.stringify(con(3)))!.datos.niveles.length, 3);
  assert.equal(leerBorrador(JSON.stringify(con(7)))!.datos.niveles.length, 7);
  assert.equal(leerBorrador(JSON.stringify(con(2)))!.datos.niveles.length, 5);
  assert.equal(leerBorrador(JSON.stringify(con(8)))!.datos.niveles.length, 5);
  assert.deepEqual(leerBorrador(JSON.stringify(con(4)))!.datos.niveles.map((n) => n.orden), [1, 2, 3, 4], 'orden renumerado');
});

test('un borrador absurdamente grande se acota (tope de preguntas)', () => {
  const muchas = Array.from({ length: 500 }, () => completo().preguntas[1]);
  assert.equal(leerBorrador(JSON.stringify({ version: 1, guardadoEn: 1, datos: {}, preguntas: muchas }))!.preguntas.length, 200);
});

test('relacionar pares: las dos columnas quedan del mismo largo aunque el storage las traiga desparejas', () => {
  const crudo = JSON.stringify({ version: 1, guardadoEn: 1, datos: {}, preguntas: [{ tipo: 'relacionar_pares', paresIzquierda: ['a', 'b', 'c'], paresDerecha: ['x'] }] });
  const p = leerBorrador(crudo)!.preguntas[0];
  assert.equal(p.paresIzquierda.length, p.paresDerecha.length);
  assert.deepEqual(p.paresIzquierda, ['a', 'b', 'c']);
  assert.deepEqual(p.paresDerecha, ['x', '', '']);
});

test('borradorTieneContenido: un formulario recién abierto no cuenta; cualquier texto escrito sí', () => {
  const vacio = { datos: datosPorDefecto(), preguntas: [preguntaVacia(NIVELES)] };
  assert.equal(borradorTieneContenido(vacio.datos, vacio.preguntas), false);
  assert.equal(borradorTieneContenido({ ...vacio.datos, titulo: ' x ' }, vacio.preguntas), true);
  assert.equal(borradorTieneContenido({ ...vacio.datos, titulo: '   ' }, vacio.preguntas), false, 'solo espacios no es contenido');
  assert.equal(borradorTieneContenido(vacio.datos, [{ ...vacio.preguntas[0], enunciado: 'Algo' }]), true);
  assert.equal(borradorTieneContenido(vacio.datos, [{ ...vacio.preguntas[0], opcionesChoice: [{ id: 'a', texto: 'Op', correcta: true }] }]), true);
  assert.equal(borradorTieneContenido(vacio.datos, [{ ...vacio.preguntas[0], paresDerecha: ['', 'x'] }]), true);
});

test('haceCuanto: expresiones en castellano y nunca negativas', () => {
  const t = 1_700_000_000_000;
  assert.equal(haceCuanto(t, t + 10_000), 'hace un momento');
  assert.equal(haceCuanto(t, t + 5 * 60_000), 'hace 5 min');
  assert.equal(haceCuanto(t, t + 3 * 3_600_000), 'hace 3 h');
  assert.equal(haceCuanto(t, t + 24 * 3_600_000), 'hace 1 día');
  assert.equal(haceCuanto(t, t + 3 * 24 * 3_600_000), 'hace 3 días');
  assert.equal(haceCuanto(t, t - 99_999), 'hace un momento', 'un reloj adelantado no da tiempos negativos');
});

test('hayErrorEnAjustes: escala no numérica o desordenada y sesión sin duración abren el bloque; lo demás no', () => {
  const d = datosPorDefecto();
  assert.equal(hayErrorEnAjustes(d), false);
  assert.equal(hayErrorEnAjustes({ ...d, escalaMax: '' }), true);
  assert.equal(hayErrorEnAjustes({ ...d, escalaMin: 'x' }), true);
  assert.equal(hayErrorEnAjustes({ ...d, escalaMin: '10', escalaMax: '10' }), true);
  assert.equal(hayErrorEnAjustes({ ...d, modalidad: 'sesion_tiempo', duracionMinutos: '0' }), true);
  assert.equal(hayErrorEnAjustes({ ...d, modalidad: 'sesion_tiempo', duracionMinutos: '30' }), false);
  assert.equal(hayErrorEnAjustes({ ...d, modalidad: 'ventana_dias', duracionMinutos: '' }), false, 'la duración no importa en una ventana de días');
  assert.equal(hayErrorEnAjustes({ ...d, titulo: '', consigna: '' }), false, 'un título vacío no es un error de ajustes');
});

test('resumenAjustes: una línea con modalidad, escala, feedback e integridad', () => {
  const d = datosPorDefecto();
  assert.equal(resumenAjustes(d), 'ventana de varios días · escala 0 a 10 · feedback manual · sin señales de integridad');
  assert.equal(resumenAjustes({ ...d, modalidad: 'sesion_tiempo', duracionMinutos: '45', feedbackModo: 'inmediato', antiCheatOn: true }), 'sesión de 45 min · escala 0 a 10 · feedback inmediato · con señales de integridad');
  assert.match(resumenAjustes({ ...d, antiCheatOn: true, acPantalla: false, acPestana: false, acPegado: false }), /sin señales de integridad/, 'activado pero sin ningún control = sin monitoreo');
  assert.match(resumenAjustes({ ...d, escalaMax: '' }), /escala 0 a \?/);
});
