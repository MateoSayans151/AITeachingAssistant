// Seed de demostración: crea en un curso UN examen con 9 alumnos cuyas respuestas están en todos los estados (ver seed-demo.data.ts).
// Sirve para mostrar y probar la pantalla de respuestas (filtros, revisión, aceptar en bloque, integridad…) sin tener que rendir 9 veces.
//
//   cd backend
//   npx ts-node scripts/seed-demo.ts                      # curso «QA-Redes»
//   npx ts-node scripts/seed-demo.ts --curso "Otro curso" # otro curso (el nombre tiene que existir)
//   npx ts-node scripts/seed-demo.ts --dry-run            # muestra qué haría, sin escribir nada
//   npx ts-node scripts/seed-demo.ts --quitar             # borra el examen demo (y nada más)
//
// Escribe en la base de DATABASE_URL (backend/.env): la misma que usa la app. Se puede correr las veces que haga falta: si el examen
// demo ya existe se reemplaza (solo el que lleva exactamente este título, en ese curso). Los alumnos y la comisión demo se reusan.

import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ALUMNOS, COMISION_DEMO, NIVELES, PREGUNTAS, TITULO_DEMO, armarRespuesta } from './seed-demo.data';

try {
  (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile?.('.env');
} catch {
  /* sin .env: se usa lo que ya haya en el entorno */
}

const args = process.argv.slice(2);
const valorDe = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const NOMBRE_CURSO = valorDe('--curso') ?? 'QA-Redes';
const SIMULAR = args.includes('--dry-run');
const QUITAR = args.includes('--quitar');

const hace = (horas: number) => new Date(Date.now() - horas * 3_600_000);

async function main() {
  const prisma = new PrismaClient();
  try {
    const cursos = await prisma.curso.findMany({ where: { nombre: NOMBRE_CURSO }, orderBy: { createdAt: 'asc' } });
    if (cursos.length === 0) throw new Error(`No hay ningún curso llamado «${NOMBRE_CURSO}». Usá --curso "<nombre exacto>".`);
    const curso = cursos[0];
    console.log(`Curso: «${curso.nombre}» (${curso.id})${cursos.length > 1 ? ` — hay ${cursos.length} con ese nombre, uso el más antiguo` : ''}`);

    const previos = await prisma.examen.findMany({ where: { cursoId: curso.id, titulo: TITULO_DEMO }, select: { id: true } });
    console.log(previos.length > 0 ? `Examen demo existente: ${previos.length} (se ${QUITAR ? 'borra' : 'reemplaza'}).` : 'No hay un examen demo previo.');

    if (SIMULAR) {
      console.log(`[dry-run] ${QUITAR ? 'Borraría' : 'Crearía'} «${TITULO_DEMO}» con ${PREGUNTAS.length} preguntas y ${ALUMNOS.length} respuestas. No escribí nada.`);
      return;
    }

    if (previos.length > 0) await prisma.examen.deleteMany({ where: { id: { in: previos.map((p) => p.id) } } });
    if (QUITAR) {
      console.log('Listo: examen demo borrado.');
      return;
    }

    // Comisión y alumnos demo (se reusan si ya estaban).
    const comision =
      (await prisma.comision.findFirst({ where: { cursoId: curso.id, nombre: COMISION_DEMO } })) ??
      (await prisma.comision.create({ data: { cursoId: curso.id, nombre: COMISION_DEMO } }));
    const alumnoDe = new Map<string, string>();
    for (const a of ALUMNOS) {
      const alumno = await prisma.alumno.upsert({
        where: { comisionId_email: { comisionId: comision.id, email: a.email } },
        update: { nombre: a.nombre },
        create: { comisionId: comision.id, nombre: a.nombre, email: a.email, codigoAcceso: randomBytes(3).toString('hex').toUpperCase() },
      });
      alumnoDe.set(a.email, alumno.id);
    }

    // Examen, preguntas y criterios (con ids propios: las respuestas guardadas los referencian).
    const examenId = randomUUID();
    const preguntaIds = PREGUNTAS.map(() => randomUUID());
    const criterioIds = PREGUNTAS.map((p) => (p.criterios ?? []).map(() => randomUUID()));
    const nivelesDescripcion = (nombreCriterio: string) => NIVELES.map((n) => ({ orden: n.orden, nombre: n.nombre, descripcion: `Nivel «${n.nombre}» en «${nombreCriterio}».` }));

    await prisma.examen.create({
      data: {
        id: examenId,
        cursoId: curso.id,
        titulo: TITULO_DEMO,
        consigna: 'Respondé todas las preguntas. Las cuatro primeras son breves; la última pide desarrollo.',
        modalidad: 'ventana_dias',
        escalaMin: 0,
        escalaMax: 10,
        niveles: NIVELES,
        feedbackModo: 'manual',
        estado: 'publicado',
        antiCheat: { pantallaCompleta: true, cambioPestana: true, pegado: true, pantallaCompartida: false },
        creadoPorId: curso.docenteId,
        preguntas: {
          create: PREGUNTAS.map((p, i) => ({
            id: preguntaIds[i],
            tipo: p.tipo,
            enunciado: p.enunciado,
            orden: i,
            puntajeMaximo: p.puntajeMaximo,
            ...(p.opciones !== undefined ? { opciones: p.opciones as object } : {}),
            ...(p.criterios
              ? {
                  criterios: {
                    create: p.criterios.map((c, k) => ({
                      id: criterioIds[i][k],
                      nombre: c.nombre,
                      descripcion: c.descripcion,
                      puntajeMaximo: c.puntajeMaximo,
                      orden: k,
                      nivelesDescripcion: nivelesDescripcion(c.nombre),
                    })),
                  },
                }
              : {}),
          })),
        },
        comisiones: { create: [{ comisionId: comision.id, slugAcceso: `demo-${randomBytes(6).toString('hex')}`, accesoAbierto: true }] },
      },
    });

    // Intento + respuesta (+ señales de integridad) de cada alumno.
    for (const a of ALUMNOS) {
      const alumnoId = alumnoDe.get(a.email)!;
      const entrega = hace(a.haceHoras);
      const inicio = new Date(entrega.getTime() - 40 * 60_000);
      const borrador = Object.fromEntries(PREGUNTAS.map((_, i) => [preguntaIds[i], a.contenido[i] ?? null]));
      const intento = await prisma.intentoExamen.create({
        data: {
          examenId,
          alumnoId,
          inicioEn: inicio,
          expiraEn: a.estado === 'vencida' ? entrega : null,
          estado: a.estado === 'vencida' ? 'vencido' : 'entregado',
          borrador,
          borradorActualizadoEn: entrega,
          consentimientoEn: inicio,
          entregadoEn: entrega,
        },
      });
      if (a.eventos?.length) {
        await prisma.eventoIntegridad.createMany({
          data: a.eventos.map((e, k) => ({ intentoId: intento.id, tipo: e.tipo as never, detalle: e.detalle ?? null, ocurridoEn: new Date(inicio.getTime() + (k + 1) * 3 * 60_000) })),
        });
      }

      const r = armarRespuesta(a, preguntaIds, criterioIds);
      await prisma.respuestaExamen.create({
        data: {
          examenId,
          alumnoId,
          modeloIa: r.estado === 'pendiente_correccion' ? null : 'seed-demo',
          respuestasPorPregunta: r.respuestasPorPregunta as object[],
          notaTotalSugerida: r.notaTotalSugerida,
          feedbackGeneralSugerido: r.feedbackGeneralSugerido,
          notaTotalFinal: r.notaTotalFinal,
          feedbackGeneralFinal: r.feedbackGeneralFinal,
          estado: r.estado,
          estadoRevision: r.estadoRevision,
          revisadoEn: r.estado === 'revisado' ? new Date(entrega.getTime() + 20 * 60_000) : null,
          createdAt: entrega,
        },
      });
      console.log(`  · ${a.nombre.padEnd(16)} ${a.estado.padEnd(13)} ${r.notaTotalSugerida === null ? 'sin nota' : `sugerida ${r.notaTotalSugerida}`}${r.notaTotalFinal !== null ? ` · final ${r.notaTotalFinal}` : ''}`);
    }

    console.log(`\nListo. Examen demo: /examenes/${examenId}/respuestas`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('No se pudo cargar el seed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
