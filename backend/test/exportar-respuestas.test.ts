// CSV de respuestas pensado para Excel (BOM, «;», coma decimal, fechas locales, una columna por pregunta, sin inyección de fórmulas), la lista
// para tildar destinatarios de mails y la regla de confirmar con el nombre (igual en el front y en el servidor). Funciones puras:
//   node --require ts-node/register --test test/exportar-respuestas.test.ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { armarCsv, celda, fechaAr, nombreArchivoCsv, numeroAr } from '../../frontend/lib/exportar-respuestas';
import { alternarTodos, filtrarDestinatarios, preseleccion, resumenSeleccion } from '../../frontend/lib/destinatarios';
import { coincideNombre as coincideFront } from '../../frontend/lib/confirmar-nombre';
import { coincideNombre as coincideBack } from '../src/examenes/confirmar-nombre.util';

const base = {
  estado: 'revisado' as const,
  estadoRevision: 'aceptada' as const,
  notaTotalSugerida: '8.5',
  notaConVara: null,
  notaTotalFinal: '8.5',
  createdAt: '2026-11-03T17:05:00Z',
  revisadoEn: '2026-11-04T12:30:00Z',
  notificadoEn: null,
  intento: { estado: 'entregado', eventos: 2 },
  respuestasPorPregunta: [
    { preguntaId: 'p1', notaSugerida: 3, notaFinal: 3 },
    { preguntaId: 'p2', notaSugerida: 5.5, notaFinal: null },
  ],
};
const PREGUNTAS = [
  { id: 'p1', puntajeMaximo: 4 },
  { id: 'p2', puntajeMaximo: 6 },
];

test('numeroAr: coma decimal, sin ceros de más, vacío si no hay número', () => {
  assert.equal(numeroAr(8.5), '8,5');
  assert.equal(numeroAr('7'), '7');
  assert.equal(numeroAr('6.250'), '6,25');
  assert.equal(numeroAr(4.3999999), '4,4');
  assert.equal(numeroAr(null), '');
  assert.equal(numeroAr(undefined), '');
  assert.equal(numeroAr(''), '');
  assert.equal(numeroAr('abc'), '');
  assert.equal(numeroAr(0), '0');
});

test('fechaAr: dd/mm/aaaa hh:mm en hora de Buenos Aires', () => {
  assert.equal(fechaAr('2026-11-03T17:05:00Z'), '03/11/2026 14:05');
  assert.equal(fechaAr('2026-01-01T02:30:00Z'), '31/12/2025 23:30');
  assert.equal(fechaAr(null), '');
  assert.equal(fechaAr('nada'), '');
});

test('celda: comillas cuando hace falta y fórmulas neutralizadas (un alumno puede escribir cualquier nombre)', () => {
  assert.equal(celda('Ana'), 'Ana');
  assert.equal(celda('Pérez; Ana'), '"Pérez; Ana"');
  assert.equal(celda('dijo "hola"'), '"dijo ""hola"""');
  assert.equal(celda('línea 1\nlínea 2'), '"línea 1\nlínea 2"');
  assert.equal(celda('=HYPERLINK("http://malo.com","clic")'), `"'=HYPERLINK(""http://malo.com"",""clic"")"`);
  assert.equal(celda('+54 11 5555'), "'+54 11 5555");
  assert.equal(celda('-2+3'), "'-2+3");
  assert.equal(celda('@usuario'), "'@usuario");
  assert.equal(celda('-3'), '-3', 'un número negativo sigue siendo un número');
  assert.equal(celda('-2,5'), '-2,5');
  assert.equal(celda(7), '7');
  assert.equal(celda(null), '');
});

test('armarCsv: BOM, separador «;», saltos CRLF, encabezado con la escala y una columna por pregunta', () => {
  const csv = armarCsv([{ ...base, alumno: { nombre: 'Ana Pérez', email: 'ana@mail.com' } }], PREGUNTAS, 10);
  assert.ok(csv.startsWith('﻿'), 'lleva BOM');
  const [encabezado, fila] = csv.slice(1).split('\r\n');
  assert.equal(
    encabezado,
    'Alumno;Email;Fecha de entrega;Cómo se cerró;Corrección de la IA;Revisión del docente;Nota sugerida por la IA (sobre 10);Nota con vara;Nota final (sobre 10);Fecha de revisión;Mail con la nota enviado;Señales de integridad;Pregunta 1 (máx. 4);Pregunta 2 (máx. 6)',
  );
  assert.equal(fila, 'Ana Pérez;ana@mail.com;03/11/2026 14:05;Entregado por el alumno;Revisada;Aceptada;8,5;;8,5;04/11/2026 09:30;;2;3;5,5');
  assert.ok(csv.endsWith('\r\n'));
});

test('armarCsv: la nota de una pregunta es la del docente o, si no revisó, la sugerida; nada se corre de columna con datos vacíos', () => {
  const pendiente = { ...base, alumno: { nombre: 'Beto', email: 'beto@mail.com' }, estado: 'corregido' as const, estadoRevision: 'pendiente' as const, notaTotalFinal: null, revisadoEn: null, intento: { estado: 'vencido', eventos: 0 }, respuestasPorPregunta: [{ preguntaId: 'p2', notaSugerida: 1, notaFinal: 2 }] };
  const sinDatos = { ...base, alumno: null, intento: null, respuestasPorPregunta: null, notaTotalSugerida: null, notaTotalFinal: null, revisadoEn: null };
  const lineas = armarCsv([pendiente, sinDatos], PREGUNTAS, 10).slice(1).split('\r\n');
  const columnas = (l: string) => l.split(';').length;
  assert.equal(columnas(lineas[1]), columnas(lineas[0]));
  assert.equal(columnas(lineas[2]), columnas(lineas[0]));
  const b = lineas[1].split(';');
  assert.equal(b[3], 'Venció el tiempo');
  assert.equal(b[5], 'Para revisar');
  assert.equal(b[8], '', 'sin nota final todavía');
  assert.equal(b[12], '', 'p1 no figura en la respuesta');
  assert.equal(b[13], '2', 'p2: la del docente pisa a la de la IA');
});

test('armarCsv: el nombre de un alumno con una fórmula sale neutralizado, no ejecutable', () => {
  const csv = armarCsv([{ ...base, alumno: { nombre: '=cmd|\' /C calc\'!A0', email: 'x@mail.com' } }], PREGUNTAS, 10);
  const fila = csv.slice(1).split('\r\n')[1];
  assert.ok(fila.startsWith("'=cmd"), fila);
});

test('nombreArchivoCsv: sin tildes, espacios ni caracteres reservados, con la fecha del día', () => {
  const hoy = new Date(2026, 10, 3);
  assert.equal(nombreArchivoCsv('Parcial 1: Álgebra / Final', hoy), 'Parcial_1_Algebra_Final_respuestas_2026-11-03.csv');
  assert.equal(nombreArchivoCsv('???', hoy), 'examen_respuestas_2026-11-03.csv');
  assert.ok(nombreArchivoCsv('x'.repeat(200), hoy).length < 90);
});

// ---------------------------------------------------------------------------
// Lista de destinatarios
// ---------------------------------------------------------------------------
const lista = [
  { id: 'a', nombre: 'Ana Pérez', email: 'ana@mail.com' },
  { id: 'b', nombre: 'Beto Gómez', email: 'beto@mail.com', enviadoEn: '2026-11-01T10:00:00Z', veces: 1 },
  { id: 'c', nombre: 'Cami Díaz', email: 'cami@otro.com', enCamino: true },
  { id: 'd', nombre: 'Dani Ruiz', email: 'dani@mail.com', error: 'cuota' },
];

test('preseleccion: viene tildado solo lo que nunca salió (y no está en camino); reenviar es una decisión del docente', () => {
  assert.deepEqual([...preseleccion(lista)].sort(), ['a', 'd']);
});

test('filtrarDestinatarios: busca por nombre o mail, sin distinguir mayúsculas ni tildes', () => {
  assert.deepEqual(filtrarDestinatarios(lista, 'PEREZ').map((d) => d.id), ['a']);
  assert.deepEqual(filtrarDestinatarios(lista, 'otro.com').map((d) => d.id), ['c']);
  assert.deepEqual(filtrarDestinatarios(lista, '  ').map((d) => d.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(filtrarDestinatarios(lista, 'zzz'), []);
});

test('alternarTodos: marca todos los que se ven; si ya estaban todos marcados, los desmarca; lo que no se ve no se toca', () => {
  const marcados = alternarTodos(lista, new Set(['d']), lista);
  assert.deepEqual([...marcados].sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual([...alternarTodos(lista, marcados, lista)], []);
  const soloAna = filtrarDestinatarios(lista, 'ana');
  assert.deepEqual([...alternarTodos(lista, new Set(['d']), soloAna)].sort(), ['a', 'd'], 'marcar los que se ven conserva el resto');
  assert.deepEqual([...alternarTodos(lista, new Set(['a', 'd']), soloAna)], ['d'], 'desmarcar los que se ven conserva el resto');
  assert.deepEqual([...alternarTodos(lista, new Set(['zzz']), [])], [], 'ids que ya no están en la lista se descartan');
});

test('resumenSeleccion: cuenta cuántos se mandan y cuántos de ellos son reenvíos', () => {
  assert.deepEqual(resumenSeleccion(lista, new Set(['a', 'b'])), { total: 2, nuevos: 1, repetidos: 1 });
  assert.deepEqual(resumenSeleccion(lista, new Set()), { total: 0, nuevos: 0, repetidos: 0 });
});

// ---------------------------------------------------------------------------
// Confirmar con el nombre: el front y el servidor tienen que decidir lo mismo
// ---------------------------------------------------------------------------
test('coincideNombre: el front y el servidor coinciden en todos los casos', () => {
  const casos: Array<[string | null | undefined, string]> = [
    ['Parcial 1', 'Parcial 1'],
    ['  Parcial   1 ', 'Parcial 1'],
    ['parcial 1', 'Parcial 1'],
    ['', 'Parcial 1'],
    ['', ''],
    [undefined, 'x'],
    ['Álgebra'.normalize('NFD'), 'Álgebra'],
    ['Parcial 1 ', 'Parcial  1'],
  ];
  for (const [escrito, nombre] of casos) assert.equal(coincideFront(escrito, nombre), coincideBack(escrito, nombre), `${escrito} / ${nombre}`);
});

// ---------------------------------------------------------------------------
// Textos del panel «En vivo»
// ---------------------------------------------------------------------------
import { haceCuanto, porcentajeAvance, resumenSenales, tiempoRestante, tiempoTranscurrido } from '../../frontend/lib/en-vivo';
import { isoAFechaLocal } from '../../frontend/lib/fechas';

test('haceCuanto / tiempoTranscurrido / tiempoRestante: textos cortos y sin negativos', () => {
  const ahora = '2026-11-03T12:00:00Z';
  assert.equal(haceCuanto('2026-11-03T11:59:55Z', ahora), 'ahora');
  assert.equal(haceCuanto('2026-11-03T11:59:30Z', ahora), 'hace 30 s');
  assert.equal(haceCuanto('2026-11-03T11:55:00Z', ahora), 'hace 5 min');
  assert.equal(haceCuanto('2026-11-03T09:30:00Z', ahora), 'hace 2 h 30 min');
  assert.equal(haceCuanto('2026-11-03T12:00:10Z', ahora), 'ahora', 'una hora futura no da negativos');
  assert.equal(tiempoTranscurrido('2026-11-03T11:59:40Z', ahora), 'recién empezó');
  assert.equal(tiempoTranscurrido('2026-11-03T11:00:00Z', ahora), '1 h');
  assert.equal(tiempoRestante(null, ahora), 'sin límite');
  assert.equal(tiempoRestante('2026-11-03T11:59:00Z', ahora), 'venció');
  assert.equal(tiempoRestante('2026-11-03T12:00:30Z', ahora), 'menos de 1 min');
  assert.equal(tiempoRestante('2026-11-03T12:32:00Z', ahora), '32 min');
});

test('porcentajeAvance y resumenSenales', () => {
  assert.equal(porcentajeAvance(2, 4), 50);
  assert.equal(porcentajeAvance(0, 0), 0);
  assert.equal(porcentajeAvance(9, 4), 100);
  assert.equal(resumenSenales({ pegado: 1, cambio_pestana: 3, nueva_rara: 0 }), 'Cambió de pestaña ×3, Pegó texto');
  assert.equal(resumenSenales({}), '');
});

test('isoAFechaLocal: vuelve al formato del input datetime-local y tolera vacíos', () => {
  assert.equal(isoAFechaLocal(null), '');
  assert.equal(isoAFechaLocal('basura'), '');
  assert.match(isoAFechaLocal('2026-11-03T12:00:00Z'), /^2026-11-0[23]T\d{2}:\d{2}$/);
});

// ---------------------------------------------------------------------------
// CSV de varios exámenes juntos (descarga opcional antes de borrar un curso o una comisión)
// ---------------------------------------------------------------------------
import { armarCsvResumen, totalDeRespuestas } from '../../frontend/lib/exportar-resumen';

test('armarCsvResumen: una columna con el examen, las filas de todos los exámenes juntas, y el mismo formato que el de un examen', () => {
  const ana = { ...base, alumno: { nombre: 'Ana Pérez', email: 'ana@mail.com' } };
  const beto = { ...base, alumno: { nombre: 'Beto', email: 'beto@mail.com' }, notaTotalFinal: '6.5', notaTotalSugerida: '6.5', intento: { estado: 'vencido', eventos: 0 } };
  const csv = armarCsvResumen([
    { titulo: 'Parcial 1', escalaMax: 10, filas: [ana, beto] },
    { titulo: 'Final; "oral"', escalaMax: 100, filas: [ana] },
  ]);
  assert.ok(csv.startsWith('﻿'), 'lleva BOM');
  const lineas = csv.slice(1).split('\r\n');
  assert.equal(lineas.length, 5, 'encabezado + 3 filas + el salto final');
  assert.equal(
    lineas[0],
    'Examen;Alumno;Email;Fecha de entrega;Cómo se cerró;Corrección de la IA;Revisión del docente;Nota sugerida por la IA;Nota con vara;Nota final;Sobre (puntaje máximo);Fecha de revisión;Mail con la nota enviado;Señales de integridad',
  );
  assert.equal(lineas[1], 'Parcial 1;Ana Pérez;ana@mail.com;03/11/2026 14:05;Entregado por el alumno;Revisada;Aceptada;8,5;;8,5;10;04/11/2026 09:30;;2');
  assert.ok(lineas[2].startsWith('Parcial 1;Beto;') && lineas[2].includes('Venció el tiempo') && lineas[2].includes(';6,5;;6,5;10;'));
  assert.ok(lineas[3].startsWith('"Final; ""oral""";Ana Pérez;'), 'el título con ; y comillas se escapa');
  assert.ok(lineas[3].includes(';8,5;;8,5;100;'), 'cada examen con su escala');
  assert.equal(totalDeRespuestas([{ titulo: 'a', escalaMax: 10, filas: [ana, beto] }, { titulo: 'b', escalaMax: 10, filas: [] }]), 2);
});

test('armarCsvResumen: sin exámenes ni respuestas queda solo el encabezado; un título con fórmula se neutraliza', () => {
  assert.equal(armarCsvResumen([]).slice(1).split('\r\n').length, 2);
  const csv = armarCsvResumen([{ titulo: '=SUMA(1;1)', escalaMax: 10, filas: [{ ...base, alumno: { nombre: 'x', email: 'x@mail.com' } }] }]);
  assert.ok(csv.slice(1).split('\r\n')[1].startsWith(`"'=SUMA(1;1)"`));
});
