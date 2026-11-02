// La guía para docentes (frontend/lib/guia.ts): cada recorrido tiene que seguir apuntando a la pantalla real y hablar en el idioma de
// alguien que no se lleva bien con la tecnología. Si se renombra un botón o se saca un `data-guia`, este test avisa.
//   npm test
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CursoParaPasos,
  GLOSARIO,
  PASOS_GUIA,
  PREGUNTAS_FRECUENTES,
  pasoActual,
  pasosDeInicio,
  recorridoDe,
  todosLosRecorridos,
} from '../../frontend/lib/guia';

const RAIZ_FRONT = join(__dirname, '..', '..', 'frontend');

function archivosFuente(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivosFuente(ruta);
    return /\.tsx$/.test(nombre) ? [ruta] : [];
  });
}

const fuenteDelFront = archivosFuente(join(RAIZ_FRONT, 'app'))
  .map((a) => readFileSync(a, 'utf8'))
  .join('\n');

const textosDeLaGuia = [
  ...todosLosRecorridos().flatMap((r) => r.pasos.flatMap((p) => [p.titulo, p.texto])),
  ...PASOS_GUIA.flatMap((p) => [p.titulo, p.resumen, ...p.pasos, p.nota ?? '']),
  ...PREGUNTAS_FRECUENTES.flatMap((p) => [p.pregunta, p.respuesta]),
  ...GLOSARIO.flatMap((g) => [g.termino, g.definicion]),
];

test('cada paso de un recorrido apunta a un data-guia que existe en el front', () => {
  for (const r of todosLosRecorridos()) {
    for (const p of r.pasos) {
      if (!p.destino) continue;
      assert.ok(fuenteDelFront.includes(`data-guia="${p.destino}"`) || fuenteDelFront.includes(`'${p.destino}'`), `${r.clave}: no existe data-guia="${p.destino}"`);
    }
  }
});

test('todo recorrido arranca centrado, para que nunca quede sin nada que mostrar', () => {
  for (const r of todosLosRecorridos()) assert.equal(r.pasos[0].destino, undefined, r.clave);
});

test('recorridoDe: cada pantalla del docente encuentra el suyo', () => {
  const casos: [string, string][] = [
    ['/', 'inicio'],
    ['/cursos/nuevo', 'curso-nuevo'],
    ['/cursos/abc', 'curso'],
    ['/examenes/nuevo', 'examen-nuevo'],
    ['/examenes/abc', 'examen'],
    ['/examenes/abc/', 'examen'],
    ['/examenes/abc/respuestas', 'respuestas'],
    ['/examenes/abc/respuestas/def', 'revision'],
    ['/examenes/abc/vara', 'vara'],
    ['/matrices', 'matrices'],
    ['/matrices/nueva', 'matrices'],
  ];
  for (const [ruta, clave] of casos) assert.equal(recorridoDe(ruta)?.clave, clave, ruta);
});

test('recorridoDe: el alumno y la propia ayuda no tienen recorrido', () => {
  assert.equal(recorridoDe('/rendir/abc'), null);
  assert.equal(recorridoDe('/ayuda'), null);
  assert.equal(recorridoDe(null), null);
});

test('la guía no usa jerga técnica', () => {
  const JERGA = /\b(backend|frontend|api|endpoint|token|prompt|llm|rag|embedding|servidor|base de datos|deploy|bucket|url|otp)\b/i;
  for (const t of textosDeLaGuia) assert.ok(!JERGA.test(t), `Jerga en: ${t}`);
});

test('los botones que nombra la guía existen en la pantalla', () => {
  const nombrados = [...new Set(textosDeLaGuia.flatMap((t) => [...t.matchAll(/«([^»]+)»/g)].map((m) => m[1])))];
  // Lo que va entre comillas pero no es un botón: ejemplos, secciones y estados.
  const NO_SON_BOTONES = new Set(['Historia 3.º A', 'Claridad', 'Uso de fuentes', 'Turno mañana', 'Insuficiente', 'Excelente', 'sin corregir', 'Aceptar sugerencias de la IA']);
  for (const n of nombrados) {
    if (NO_SON_BOTONES.has(n)) continue;
    assert.ok(fuenteDelFront.includes(n), `La guía nombra «${n}», que no aparece en ninguna pantalla`);
  }
});

const curso = (id: string, examenes: CursoParaPasos['examenes'] = []): CursoParaPasos => ({ id, examenes });

test('primeros pasos: un docente nuevo arranca por el curso', () => {
  const pasos = pasosDeInicio([]);
  assert.equal(pasos.filter((p) => p.hecho).length, 0);
  assert.equal(pasoActual(pasos)?.clave, 'curso');
  assert.equal(pasoActual(pasos)?.accion.href, '/cursos/nuevo');
});

test('primeros pasos: con un curso, el examen se arma en ese curso', () => {
  const actual = pasoActual(pasosDeInicio([curso('c1')]));
  assert.equal(actual?.clave, 'examen');
  assert.equal(actual?.accion.href, '/examenes/nuevo?cursoId=c1');
});

test('primeros pasos: un examen en borrador todavía no mandó el link', () => {
  const actual = pasoActual(pasosDeInicio([curso('c1'), curso('c2', [{ estado: 'borrador', feedbackLiberadoEn: null }])]));
  assert.equal(actual?.clave, 'link');
  assert.equal(actual?.accion.href, '/cursos/c2');
});

test('primeros pasos: publicado, lleva a lo que hay para revisar', () => {
  const actual = pasoActual(pasosDeInicio([curso('c1', [{ estado: 'publicado', feedbackLiberadoEn: null }])], 'e9'));
  assert.equal(actual?.clave, 'notas');
  assert.equal(actual?.accion.href, '/examenes/e9/respuestas');
});

test('primeros pasos: con las notas publicadas no queda nada por hacer', () => {
  assert.equal(pasoActual(pasosDeInicio([curso('c1', [{ estado: 'publicado', feedbackLiberadoEn: '2026-11-01T00:00:00Z' }])])), null);
});
