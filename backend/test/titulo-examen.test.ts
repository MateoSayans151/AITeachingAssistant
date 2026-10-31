// Renombrar un examen ya creado: el DTO de PATCH /examenes/:id (solo el título, sin espacios de más, con tope) y el nombre por
// defecto con el que arranca un examen nuevo. Corre sin base de datos:
//   node --require ts-node/register --test test/titulo-examen.test.ts
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateExamenDto } from '../src/examenes/dto/update-examen.dto';
import { TITULO_POR_DEFECTO, datosPorDefecto, validarAjustes, validarDatos, validarEncabezado } from '../../frontend/lib/examen-form';

const errores = async (body: unknown) => (await validate(plainToInstance(UpdateExamenDto, body))).length;

test('UpdateExamenDto: acepta un título y lo recorta; rechaza vacío, solo espacios, sin título o larguísimo', async () => {
  assert.equal(await errores({ titulo: 'Parcial 1' }), 0);
  assert.equal(plainToInstance(UpdateExamenDto, { titulo: '  Parcial 1  ' }).titulo, 'Parcial 1');
  assert.ok((await errores({ titulo: '' })) > 0);
  assert.ok((await errores({ titulo: '    ' })) > 0);
  assert.ok((await errores({})) > 0);
  assert.ok((await errores({ titulo: 5 })) > 0);
  assert.ok((await errores({ titulo: 'x'.repeat(201) })) > 0);
  assert.equal(await errores({ titulo: 'x'.repeat(200) }), 0);
});

test('el título por defecto es un título válido (el examen se puede crear sin tocarlo) y datosPorDefecto sigue pidiéndolo', () => {
  assert.ok(TITULO_POR_DEFECTO.trim().length > 0);
  assert.deepEqual(validarDatos({ ...datosPorDefecto(), titulo: TITULO_POR_DEFECTO, cursoElegido: 'c1' }), []);
  assert.ok(validarDatos(datosPorDefecto()).includes('Falta el título del examen.'));
});

test('validarEncabezado (paso Preguntas) y validarAjustes (paso Ajustes) no se pisan, y juntos dan validarDatos', () => {
  const ok = { ...datosPorDefecto(), titulo: 'Parcial', cursoElegido: 'c1' };
  assert.deepEqual(validarEncabezado(ok), []);
  assert.deepEqual(validarAjustes(ok), []);
  // Lo del encabezado: título, curso, total del examen.
  assert.deepEqual(validarEncabezado({ ...ok, titulo: ' ' }), ['Falta el título del examen.']);
  assert.deepEqual(validarEncabezado({ ...ok, cursoElegido: '' }), ['Elegí un curso.']);
  assert.deepEqual(validarEncabezado({ ...ok, escalaMax: '' }), ['Indicá cuántos puntos vale el examen (un número mayor que 0).']);
  // Lo de los ajustes no aparece en el paso de preguntas…
  const conAjustesMalos = { ...ok, modalidad: 'sesion_tiempo' as const, duracionMinutos: '0', escalaMin: '99', distOn: true, aprobadosPct: '500' };
  assert.deepEqual(validarEncabezado(conAjustesMalos), []);
  // …y lo del encabezado no aparece en el paso de ajustes (sin total válido tampoco se juzga la nota mínima).
  assert.deepEqual(validarAjustes({ ...ok, titulo: '', cursoElegido: '', escalaMax: '' }), []);
  // nota mínima fuera de rango, duración 0, y en la distribución: la nota de aprobación (6) queda por debajo del mínimo 99 y el 500 % no existe.
  assert.equal(validarAjustes(conAjustesMalos).length, 4);
  assert.deepEqual(validarDatos(conAjustesMalos), [...validarEncabezado(conAjustesMalos), ...validarAjustes(conAjustesMalos)]);
});
