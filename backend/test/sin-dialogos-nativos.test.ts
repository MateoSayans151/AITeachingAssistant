// El front no usa los diálogos nativos del navegador (confirm, alert, prompt): en los navegadores embebidos de WhatsApp, Instagram o
// Gmail, donde muchos alumnos abren el link del examen, pueden no mostrarse o devolver "no", y entonces el alumno no podía entregar.
// Las confirmaciones pasan por app/components/Confirmar.tsx.
//   node --require ts-node/register --test test/sin-dialogos-nativos.test.ts   (o `npm test`)
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

const RAIZ_FRONT = join(__dirname, '..', '..', 'frontend');

function archivosFuente(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (nombre === 'node_modules' || nombre === '.next') return [];
    if (statSync(ruta).isDirectory()) return archivosFuente(ruta);
    return /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });
}

/** Saca los comentarios para que un `// no usar window.confirm` no cuente como uso. */
function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('ningún archivo del front usa window.confirm, window.alert ni window.prompt', () => {
  const NATIVO = /(?<![.\w])(?:window\.)?(?:confirm|alert|prompt)\s*\(/;
  const usos: string[] = [];
  for (const dir of ['app', 'lib']) {
    for (const archivo of archivosFuente(join(RAIZ_FRONT, dir))) {
      // Confirmar.tsx tiene el único respaldo permitido (sin proveedor se cae a window.confirm).
      if (archivo.endsWith(join('components', 'Confirmar.tsx'))) continue;
      const lineas = sinComentarios(readFileSync(archivo, 'utf8')).split('\n');
      lineas.forEach((linea, i) => {
        if (NATIVO.test(linea)) usos.push(`${relative(RAIZ_FRONT, archivo)}:${i + 1}  ${linea.trim()}`);
      });
    }
  }
  assert.deepEqual(usos, [], `Usá useConfirmar() (app/components/Confirmar.tsx) en vez de diálogos nativos:\n${usos.join('\n')}`);
});

test('el layout envuelve la app en ConfirmarProvider (si no, useConfirmar cae al diálogo nativo)', () => {
  const layout = readFileSync(join(RAIZ_FRONT, 'app', 'layout.tsx'), 'utf8');
  assert.match(layout, /<ConfirmarProvider>/);
});
