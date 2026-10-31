// Que los datos del seed de demostración cierren (backend/scripts/seed-demo.data.ts): notas = suma de lo que dice cada criterio, cada
// estado tiene lo que le corresponde y nada referencia un id que no existe. Corre sin base de datos.
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ALUMNOS, ESCALA_MAX, NIVELES, PREGUNTAS, armarRespuesta } from '../scripts/seed-demo.data';

const preguntaIds = PREGUNTAS.map(() => randomUUID());
const criterioIds = PREGUNTAS.map((p) => (p.criterios ?? []).map(() => randomUUID()));
const respuestas = ALUMNOS.map((a) => armarRespuesta(a, preguntaIds, criterioIds));
const redondear = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

test('el examen demo vale exactamente la escala y cada criterio suma lo de su pregunta', () => {
  assert.equal(redondear(PREGUNTAS.reduce((s, p) => s + p.puntajeMaximo, 0)), ESCALA_MAX);
  for (const p of PREGUNTAS.filter((q) => q.criterios)) {
    assert.equal(redondear(p.criterios!.reduce((s, c) => s + c.puntajeMaximo, 0)), p.puntajeMaximo, p.enunciado);
  }
});

test('hay alumnos en TODOS los estados y los emails son únicos', () => {
  assert.equal(new Set(ALUMNOS.map((a) => a.email)).size, ALUMNOS.length);
  for (const estado of ['sin_corregir', 'para_revisar', 'vencida', 'aceptada', 'editada'] as const) {
    assert.ok(ALUMNOS.some((a) => a.estado === estado), `falta un alumno «${estado}»`);
  }
  assert.ok(ALUMNOS.filter((a) => a.estado === 'sin_corregir').length >= 2, 'para que tenga sentido «Corregir pendientes»');
  assert.ok(ALUMNOS.some((a) => (a.eventos?.length ?? 0) > 0), 'alguien con señales de integridad');
});

test('cada estado guarda lo que le corresponde (la IA no corrigió: sin notas; revisada: con nota final)', () => {
  for (const r of respuestas) {
    const e = r.alumno.estado;
    if (e === 'sin_corregir') {
      assert.equal(r.estado, 'pendiente_correccion');
      assert.equal(r.notaTotalSugerida, null);
      assert.equal(r.notaTotalFinal, null);
      assert.equal(r.feedbackGeneralSugerido, null);
    } else if (e === 'aceptada' || e === 'editada') {
      assert.equal(r.estado, 'revisado');
      assert.equal(r.estadoRevision, e);
      assert.notEqual(r.notaTotalFinal, null);
      assert.notEqual(r.feedbackGeneralFinal, null);
    } else {
      assert.equal(r.estado, 'corregido');
      assert.equal(r.estadoRevision, 'pendiente');
      assert.notEqual(r.notaTotalSugerida, null);
      assert.equal(r.notaTotalFinal, null);
    }
  }
});

test('la nota sugerida es la suma de las preguntas y cada nota por criterio sale del nivel que le dio la IA', () => {
  for (const r of respuestas.filter((x) => x.notaTotalSugerida !== null)) {
    const suma = redondear(r.respuestasPorPregunta.reduce((s, it) => s + (it.notaSugerida as number), 0));
    assert.equal(r.notaTotalSugerida, suma, r.alumno.nombre);
    assert.ok(suma >= 0 && suma <= ESCALA_MAX, `${r.alumno.nombre}: ${suma}`);
    r.respuestasPorPregunta.slice(3).forEach((it, k) => {
      const criterios = PREGUNTAS[3 + k].criterios!;
      const porCriterio = it.notaPorCriterio as Array<{ criterioId: string; nivelSugerido: number; notaSugerida: number }>;
      assert.equal(porCriterio.length, criterios.length);
      porCriterio.forEach((c, j) => {
        assert.equal(c.criterioId, criterioIds[3 + k][j]);
        assert.ok(c.nivelSugerido >= 1 && c.nivelSugerido <= NIVELES.length);
        assert.equal(c.notaSugerida, redondear((criterios[j].puntajeMaximo * NIVELES[c.nivelSugerido - 1].porcentaje) / 100));
      });
    });
  }
});

test('las cerradas son todo o nada y la que dejó en blanco no suma', () => {
  const camila = respuestas.find((r) => r.alumno.nombre === 'Camila Ortiz')!;
  assert.deepEqual(camila.respuestasPorPregunta.slice(0, 3).map((i) => i.notaSugerida), [2, 2, 2]);
  const ayelen = respuestas.find((r) => r.alumno.nombre === 'Ayelén Romero')!;
  assert.deepEqual(ayelen.respuestasPorPregunta.slice(0, 3).map((i) => i.notaSugerida), [0, 0, 2]);
  const lucia = respuestas.find((r) => r.alumno.nombre === 'Lucía Herrera')!;
  assert.equal(lucia.respuestasPorPregunta[2].notaSugerida, 0, 'numérica en blanco');
  assert.equal(lucia.respuestasPorPregunta[4].notaSugerida, 0, 'desarrollo en blanco');
});

test('«editada»: el docente cambió notas y dejó devolución en las dos preguntas abiertas; la final es la suma de sus notas finales', () => {
  const mateo = respuestas.find((r) => r.alumno.estado === 'editada')!;
  const items = mateo.respuestasPorPregunta;
  assert.ok(String(items[3].feedbackFinal).length > 20);
  assert.ok(String(items[4].feedbackFinal).length > 20);
  assert.ok((items[3].notaFinal as number) > (items[3].notaSugerida as number), 'subió la nota de la pregunta 4');
  assert.equal(mateo.notaTotalFinal, redondear(items.reduce((s, it) => s + (it.notaFinal as number), 0)));
  assert.notEqual(mateo.notaTotalFinal, mateo.notaTotalSugerida);
  for (const it of items) assert.ok((it.notaFinal as number) <= PREGUNTAS[items.indexOf(it)].puntajeMaximo);
});

test('«aceptada»: la nota final es la sugerida', () => {
  for (const r of respuestas.filter((x) => x.alumno.estado === 'aceptada')) {
    assert.equal(r.notaTotalFinal, r.notaTotalSugerida);
  }
});
