// Tests de la lógica pura del paso "Publicar" del wizard (frontend/lib/alumnos.ts): sugerencia de correcciones para emails con el
// dominio mal escrito (con los falsos positivos que no deben marcarse), nombre sugerido para la comisión nueva, validación de las
// fechas de apertura y cierre y resumen de una línea. Corren sin base de datos ni navegador.
//   node --require ts-node/register --test test/alumnos-lista.test.ts   (o `npm test`, una vez agregado al script)
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  formatearFechaHora,
  resumenPublicacion,
  siguienteNombreComision,
  sugerirCorreccionDominio,
  validarFechasPublicacion,
} from '../../frontend/lib/alumnos';
import { parsearAlumnos } from '../../frontend/lib/examen-form';

// ---------------------------------------------------------------------------
// sugerirCorreccionDominio
// ---------------------------------------------------------------------------
test('sugerirCorreccionDominio: corrige los errores de tipeo más comunes de los proveedores', () => {
  const casos: [string, string][] = [
    ['ana@gmial.com', 'ana@gmail.com'],
    ['ana@gmal.com', 'ana@gmail.com'],
    ['ana@gmail.con', 'ana@gmail.com'],
    ['ana@gamil.com', 'ana@gmail.com'],
    ['ana@gmaill.com', 'ana@gmail.com'],
    ['ana@hotmial.com', 'ana@hotmail.com'],
    ['ana@hotmal.com', 'ana@hotmail.com'],
    ['ana@hotmail.con', 'ana@hotmail.com'],
    ['ana@outlok.com', 'ana@outlook.com'],
    ['ana@yahho.com', 'ana@yahoo.com'],
    ['ana@yaho.com', 'ana@yahoo.com'],
    ['ana@yaho.com.ar', 'ana@yahoo.com.ar'],
    ['ana@hotmial.com.ar', 'ana@hotmail.com.ar'],
    ['ana@iclod.com', 'ana@icloud.com'],
  ];
  for (const [entrada, esperado] of casos) assert.equal(sugerirCorreccionDominio(entrada), esperado, entrada);
});

test('sugerirCorreccionDominio: ".con" en vez de ".com" se corrige en cualquier dominio', () => {
  assert.equal(sugerirCorreccionDominio('ana@empresa.con'), 'ana@empresa.com');
  assert.equal(sugerirCorreccionDominio('ana@mi-estudio.con'), 'ana@mi-estudio.com');
});

test('sugerirCorreccionDominio: ".com.ar" mal escrito (".com.arr", ".comar", ".com.ra") y ".edu.ar" también', () => {
  assert.equal(sugerirCorreccionDominio('ana@yahoo.com.arr'), 'ana@yahoo.com.ar');
  assert.equal(sugerirCorreccionDominio('ana@hotmail.comar'), 'ana@hotmail.com.ar');
  assert.equal(sugerirCorreccionDominio('ana@empresa.com.ra'), 'ana@empresa.com.ar');
  assert.equal(sugerirCorreccionDominio('ana@uade.edu.arr'), 'ana@uade.edu.ar');
  assert.equal(sugerirCorreccionDominio('ana@ort.eduar'), 'ana@ort.edu.ar');
});

test('sugerirCorreccionDominio: corrige dos errores a la vez y gmail.com.ar (que no existe)', () => {
  assert.equal(sugerirCorreccionDominio('ana@gmial.con'), 'ana@gmail.com');
  assert.equal(sugerirCorreccionDominio('ana@hotmial.comar'), 'ana@hotmail.com.ar');
  assert.equal(sugerirCorreccionDominio('ana@gmail.com.ar'), 'ana@gmail.com');
  assert.equal(sugerirCorreccionDominio('ana@gmail.co'), 'ana@gmail.com');
});

test('sugerirCorreccionDominio: conserva la parte local y pasa el dominio a minúsculas', () => {
  assert.equal(sugerirCorreccionDominio('Ana.Pérez+parcial@GMIAL.COM'), 'Ana.Pérez+parcial@gmail.com');
  assert.equal(sugerirCorreccionDominio('  ana@gmial.com  '), 'ana@gmail.com');
  // La parte local no se toca aunque tenga algo parecido a un error.
  assert.equal(sugerirCorreccionDominio('gmial.con@gmial.com'), 'gmial.con@gmail.com');
});

test('sugerirCorreccionDominio: NO marca los dominios válidos (falsos positivos)', () => {
  const validos = [
    'gmail.com',
    'GMAIL.COM',
    'hotmail.com',
    'hotmail.com.ar',
    'hotmail.es',
    'outlook.com',
    'outlook.es',
    'outlook.com.ar',
    'yahoo.com',
    'yahoo.com.ar',
    'yahoo.es',
    'icloud.com',
    'live.com',
    'live.com.ar',
    'mail.com', // a una letra de gmail.com, pero es un proveedor real
    'ymail.com',
    'gmx.com',
    'proton.me',
    'protonmail.com',
    'uade.edu.ar',
    'ort.edu.ar',
    'itba.edu.ar',
    'ucema.edu.ar',
    'utn.edu.ar',
    'frba.utn.edu.ar',
    'empresa.com.ar',
    'startup.co',
    'ejemplo.io',
    'consultora.com',
    'comarca.com', // contiene "comar" pero no termina así
  ];
  for (const dominio of validos) assert.equal(sugerirCorreccionDominio(`ana@${dominio}`), null, dominio);
});

test('sugerirCorreccionDominio: entradas que no son un email devuelven null y no rompen', () => {
  for (const entrada of ['', '   ', 'sin-arroba', 'ana@', '@gmail.con', 'ana@localhost', 'ana@gmail', 'ana@.con']) {
    assert.equal(sugerirCorreccionDominio(entrada), null, JSON.stringify(entrada));
  }
});

test('sugerirCorreccionDominio: es idempotente (el email corregido ya no se marca)', () => {
  for (const entrada of ['ana@gmial.con', 'ana@yaho.com.arr', 'ana@hotmal.com', 'ana@gmail.com.ar']) {
    const corregido = sugerirCorreccionDominio(entrada);
    assert.ok(corregido, entrada);
    assert.equal(sugerirCorreccionDominio(corregido), null, `${entrada} -> ${corregido}`);
  }
});

test('con la lista pegada: los emails que parsearAlumnos reconoce se pueden revisar uno por uno', () => {
  const { alumnos, errores } = parsearAlumnos(
    ['Ana Pérez, ana@gmial.com', 'luis@uade.edu.ar', 'María\tmaria@hotmail.con', 'luis@uade.edu.ar', 'sin email'].join('\n'),
  );
  assert.equal(alumnos.length, 3);
  assert.equal(errores.length, 2);
  assert.deepEqual(
    alumnos.map((a) => sugerirCorreccionDominio(a.email)),
    ['ana@gmail.com', null, 'maria@hotmail.com'],
  );
});

// ---------------------------------------------------------------------------
// siguienteNombreComision
// ---------------------------------------------------------------------------
test('siguienteNombreComision: "Comisión A" si el curso no tiene comisiones', () => {
  assert.equal(siguienteNombreComision([]), 'Comisión A');
});

test('siguienteNombreComision: salta las letras que ya existen (sin distinguir mayúsculas ni acentos)', () => {
  assert.equal(siguienteNombreComision(['Comisión A']), 'Comisión B');
  assert.equal(siguienteNombreComision(['Comisión A', 'Comisión B', 'Comisión C']), 'Comisión D');
  assert.equal(siguienteNombreComision(['comision a', ' COMISIÓN   B ']), 'Comisión C');
  // Si falta una del medio, la usa: no repite ninguna existente.
  assert.equal(siguienteNombreComision(['Comisión A', 'Comisión C']), 'Comisión B');
});

test('siguienteNombreComision: ignora comisiones con otros nombres', () => {
  assert.equal(siguienteNombreComision(['Turno noche', 'Parcial 1 — Estructuras']), 'Comisión A');
});

test('siguienteNombreComision: pasadas las 26 letras numera', () => {
  const todas = Array.from({ length: 26 }, (_, i) => `Comisión ${String.fromCharCode(65 + i)}`);
  assert.equal(siguienteNombreComision(todas), 'Comisión 27');
  assert.equal(siguienteNombreComision([...todas, 'Comisión 27']), 'Comisión 28');
});

// ---------------------------------------------------------------------------
// validarFechasPublicacion / formatearFechaHora / resumenPublicacion
// ---------------------------------------------------------------------------
// "Ahora" fijo (hora local, como los <input type="datetime-local">): sábado 10/10/2026 12:00.
const AHORA = new Date(2026, 9, 10, 12, 0, 0);

test('validarFechasPublicacion: sin fechas, o con fechas futuras en orden, está bien', () => {
  assert.equal(validarFechasPublicacion('', '', AHORA), null);
  assert.equal(validarFechasPublicacion('2026-10-12T09:00', '', AHORA), null);
  assert.equal(validarFechasPublicacion('', '2026-10-12T18:00', AHORA), null);
  assert.equal(validarFechasPublicacion('2026-10-12T09:00', '2026-10-12T18:00', AHORA), null);
});

test('validarFechasPublicacion: el cierre no puede ser anterior (ni igual) a la apertura', () => {
  assert.match(validarFechasPublicacion('2026-10-12T18:00', '2026-10-12T09:00', AHORA) ?? '', /posterior a la apertura/);
  assert.match(validarFechasPublicacion('2026-10-12T18:00', '2026-10-12T18:00', AHORA) ?? '', /posterior a la apertura/);
});

test('validarFechasPublicacion: el cierre no puede estar en el pasado', () => {
  assert.match(validarFechasPublicacion('', '2026-10-09T18:00', AHORA) ?? '', /ya pasó/);
  assert.match(validarFechasPublicacion('2026-10-08T09:00', '2026-10-09T18:00', AHORA) ?? '', /ya pasó/);
  // Justo ahora también cuenta como pasado: ya no queda tiempo para rendir.
  assert.match(validarFechasPublicacion('', '2026-10-10T12:00', AHORA) ?? '', /ya pasó/);
});

test('validarFechasPublicacion: una apertura pasada no es error (equivale a "habilitado ahora")', () => {
  assert.equal(validarFechasPublicacion('2026-10-09T09:00', '2026-10-12T18:00', AHORA), null);
  assert.equal(validarFechasPublicacion('2026-10-09T09:00', '', AHORA), null);
});

test('validarFechasPublicacion: valores que no son fechas se tratan como vacíos', () => {
  assert.equal(validarFechasPublicacion('basura', 'otra-basura', AHORA), null);
});

test('formatearFechaHora: formato es-AR (día/mes y 24 h), con año solo si no es el actual', () => {
  assert.equal(formatearFechaHora('2026-10-12T18:00', AHORA), '12/10 18:00');
  assert.equal(formatearFechaHora('2026-03-05T09:05', AHORA), '05/03 09:05');
  assert.equal(formatearFechaHora('2027-01-02T00:30', AHORA), '02/01/2027 00:30');
  assert.equal(formatearFechaHora('', AHORA), null);
  assert.equal(formatearFechaHora('basura', AHORA), null);
});

test('resumenPublicacion: el ejemplo completo en una línea', () => {
  assert.equal(
    resumenPublicacion({ alumnos: 32, inicio: '', fin: '2026-10-12T18:00', duracionMinutos: 60, ahora: AHORA }),
    '32 alumnos · se habilita ahora · cierra el 12/10 18:00 · 60 min por alumno',
  );
});

test('resumenPublicacion: lo que no aplica se omite', () => {
  assert.equal(resumenPublicacion({ alumnos: 1, inicio: '', fin: '', ahora: AHORA }), '1 alumno · se habilita ahora');
  assert.equal(resumenPublicacion({ alumnos: 28, inicio: '', fin: '', duracionMinutos: null, ahora: AHORA }), '28 alumnos · se habilita ahora');
  assert.equal(resumenPublicacion({ alumnos: null, inicio: '', fin: '', duracionMinutos: 0, ahora: AHORA }), 'se habilita ahora');
  assert.equal(
    resumenPublicacion({ alumnos: null, inicio: '2026-10-11T08:00', fin: '', duracionMinutos: 45, ahora: AHORA }),
    'se habilita el 11/10 08:00 · 45 min por alumno',
  );
});

test('resumenPublicacion: una apertura que ya pasó se dice "ahora"; 0 alumnos se muestra', () => {
  assert.equal(resumenPublicacion({ alumnos: 3, inicio: '2026-10-09T09:00', fin: '', ahora: AHORA }), '3 alumnos · se habilita ahora');
  assert.equal(resumenPublicacion({ alumnos: 0, inicio: '', fin: '', ahora: AHORA }), '0 alumnos · se habilita ahora');
});
