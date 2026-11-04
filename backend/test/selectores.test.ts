// Lógica de los selectores propios: el menú desplegable (teclado) y el selector de fecha y hora (calendario). Funciones puras:
//   node --require ts-node/register --test test/selectores.test.ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buscarPorTexto, indiceDe, moverIndice, primerHabilitado } from '../../frontend/lib/desplegable';
import {
  acotarNumero,
  compararDias,
  diasDelMes,
  fechaHoraLegible,
  formatearFechaHora,
  mismoDia,
  moverDia,
  moverMes,
  nombreDelMes,
  parsearFechaHora,
} from '../../frontend/lib/calendario';

const op = (...etiquetas: string[]) => etiquetas.map((e) => ({ valor: e.toLowerCase(), etiqueta: e }));

// ---------------------------------------------------------------------------
// Desplegable
// ---------------------------------------------------------------------------
test('moverIndice: salta las deshabilitadas, no da la vuelta y se queda en el borde', () => {
  const o = [{ valor: 'a', etiqueta: 'A' }, { valor: 'b', etiqueta: 'B', deshabilitada: true }, { valor: 'c', etiqueta: 'C' }];
  assert.equal(moverIndice(o, 0, 1), 2, 'salta la deshabilitada');
  assert.equal(moverIndice(o, 2, -1), 0);
  assert.equal(moverIndice(o, 2, 1), 2, 'en el borde se queda');
  assert.equal(moverIndice(o, 0, -1), 0);
  assert.equal(moverIndice(o, -1, 1), 0, 'sin nada resaltado, la flecha abajo va a la primera');
  assert.equal(moverIndice([], -1, 1), -1);
});

test('primerHabilitado e indiceDe', () => {
  const o = [{ valor: 'a', etiqueta: 'A', deshabilitada: true }, { valor: 'b', etiqueta: 'B' }, { valor: 'c', etiqueta: 'C' }, { valor: 'd', etiqueta: 'D', deshabilitada: true }];
  assert.equal(primerHabilitado(o, 'inicio'), 1);
  assert.equal(primerHabilitado(o, 'fin'), 2);
  assert.equal(primerHabilitado([{ valor: 'a', etiqueta: 'A', deshabilitada: true }], 'inicio'), -1);
  assert.equal(indiceDe(o, 'c'), 2);
  assert.equal(indiceDe(o, 'zzz'), -1);
  assert.equal(indiceDe(o, ''), -1, 'sin opción con valor vacío, el valor vacío no coincide con nada (se ve el placeholder)');
});

test('buscarPorTexto: una letra salta a la siguiente que empieza con ella (y repetirla recorre las que comparten inicio); varias letras afinan; sin tildes', () => {
  const o = op('Verdadero', 'Falso', 'Varios', 'Última', 'Uno');
  assert.equal(buscarPorTexto(o, 'v', -1), 0);
  assert.equal(buscarPorTexto(o, 'v', 0), 2, 'la misma letra otra vez: la siguiente con V');
  assert.equal(buscarPorTexto(o, 'v', 2), 0, 'y da la vuelta');
  assert.equal(buscarPorTexto(o, 'va', 0), 2, 'varias letras: la que empieza con "va"');
  assert.equal(buscarPorTexto(o, 'ver', 2), 0);
  assert.equal(buscarPorTexto(o, 'u', 2), 3, 'una U: Última');
  assert.equal(buscarPorTexto(o, 'ultima', 0), 3, 'sin tildes');
  assert.equal(buscarPorTexto(o, 'x', 0), -1);
  assert.equal(buscarPorTexto(o, '', 0), -1);
  assert.equal(buscarPorTexto([], 'a', -1), -1);
  assert.equal(buscarPorTexto(o, 'vv', 0), 2, 'la misma letra repetida rápido cuenta como repetir la tecla');
});

// ---------------------------------------------------------------------------
// Calendario
// ---------------------------------------------------------------------------
test('parsearFechaHora / formatearFechaHora: ida y vuelta con el formato de datetime-local; rechaza lo inválido', () => {
  assert.deepEqual(parsearFechaHora('2026-11-03T21:19'), { año: 2026, mes: 10, dia: 3, hora: 21, minuto: 19 });
  assert.equal(formatearFechaHora({ año: 2026, mes: 0, dia: 5, hora: 9, minuto: 5 }), '2026-01-05T09:05');
  for (const malo of ['', null, undefined, 'mañana', '2026-02-30T10:00', '2026-04-31T10:00', '2026-11-03T24:00', '2026-11-03T10:60', '2026-13-01T10:00', '2026-11-03']) {
    assert.equal(parsearFechaHora(malo as any), null, String(malo));
  }
  assert.deepEqual(parsearFechaHora('2028-02-29T00:00'), { año: 2028, mes: 1, dia: 29, hora: 0, minuto: 0 }, 'año bisiesto');
  assert.equal(parsearFechaHora('2027-02-29T00:00'), null);
});

test('fechaHoraLegible: dd/mm/aaaa hh:mm, vacío si no hay fecha', () => {
  assert.equal(fechaHoraLegible('2026-11-03T21:19'), '03/11/2026 21:19');
  assert.equal(fechaHoraLegible('2026-01-05T09:05'), '05/01/2026 09:05');
  assert.equal(fechaHoraLegible(''), '');
  assert.equal(fechaHoraLegible('basura'), '');
});

test('diasDelMes: 42 días en 6 semanas que empiezan en lunes, con los del mes marcados', () => {
  const nov = diasDelMes(2026, 10); // noviembre 2026: el 1 cae domingo
  assert.equal(nov.length, 42);
  assert.deepEqual(nov[0], { año: 2026, mes: 9, dia: 26, delMes: false }, 'la grilla arranca el lunes 26 de octubre');
  assert.deepEqual(nov[6], { año: 2026, mes: 10, dia: 1, delMes: true }, 'el domingo 1 de noviembre es la última de la primera fila');
  assert.equal(nov.filter((d) => d.delMes).length, 30);
  assert.deepEqual(nov[41], { año: 2026, mes: 11, dia: 6, delMes: false });
  const ene = diasDelMes(2026, 0); // el 1 de enero de 2026 cae jueves
  assert.deepEqual(ene[0], { año: 2025, mes: 11, dia: 29, delMes: false });
  assert.deepEqual(ene[3], { año: 2026, mes: 0, dia: 1, delMes: true });
  const lunesPrimero = diasDelMes(2026, 5); // 1 de junio de 2026 cae lunes: sin días del mes anterior
  assert.deepEqual(lunesPrimero[0], { año: 2026, mes: 5, dia: 1, delMes: true });
});

test('moverMes y moverDia cruzan meses y años; nombreDelMes en castellano', () => {
  assert.deepEqual(moverMes(2026, 11, 1), { año: 2027, mes: 0 });
  assert.deepEqual(moverMes(2026, 0, -1), { año: 2025, mes: 11 });
  assert.deepEqual(moverDia({ año: 2026, mes: 10, dia: 30 }, 1), { año: 2026, mes: 11, dia: 1 });
  assert.deepEqual(moverDia({ año: 2026, mes: 0, dia: 1 }, -1), { año: 2025, mes: 11, dia: 31 });
  assert.deepEqual(moverDia({ año: 2026, mes: 10, dia: 3 }, 7), { año: 2026, mes: 10, dia: 10 });
  assert.equal(nombreDelMes(2026, 10).toLowerCase(), 'noviembre de 2026');
});

test('mismoDia y compararDias comparan solo la fecha', () => {
  assert.ok(mismoDia({ año: 2026, mes: 10, dia: 3 }, { año: 2026, mes: 10, dia: 3 }));
  assert.ok(!mismoDia({ año: 2026, mes: 10, dia: 3 }, { año: 2026, mes: 9, dia: 3 }));
  assert.ok(compararDias({ año: 2026, mes: 10, dia: 2 }, { año: 2026, mes: 10, dia: 3 }) < 0);
  assert.ok(compararDias({ año: 2027, mes: 0, dia: 1 }, { año: 2026, mes: 11, dia: 31 }) > 0);
  assert.equal(compararDias({ año: 2026, mes: 10, dia: 3 }, { año: 2026, mes: 10, dia: 3 }), 0);
});

test('acotarNumero: lleva lo escrito al rango (hora 0-23, minutos 0-59); vacío o basura usa el valor por defecto', () => {
  assert.equal(acotarNumero('7', 23, 9), 7);
  assert.equal(acotarNumero('07', 23, 9), 7);
  assert.equal(acotarNumero('45', 23, 9), 23);
  assert.equal(acotarNumero('99', 59, 0), 59);
  assert.equal(acotarNumero('', 23, 9), 9);
  assert.equal(acotarNumero('ab', 23, 9), 9);
  assert.equal(acotarNumero('1a2', 59, 0), 12, 'solo cuentan los dígitos');
});
