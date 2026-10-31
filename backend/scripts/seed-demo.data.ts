// Datos del seed de demostración (scripts/seed-demo.ts): UN examen de Redes con 9 alumnos que rindieron y cuyas respuestas están en
// todos los estados por los que pasa una respuesta (sin corregir, para revisar, por vencimiento, con señales de integridad, aceptada
// y editada por el docente). Son funciones puras, sin base de datos: así se puede testear que las notas cierren
// (backend/test/seed-demo.test.ts) y el script solo se ocupa de escribir.

export const TITULO_DEMO = 'Demo · Parcial de Redes (respuestas en todos los estados)';
export const COMISION_DEMO = 'Comisión Demo';
export const ESCALA_MAX = 10;

export const NIVELES = [
  { orden: 1, nombre: 'Insuficiente', colorHex: '#e0e0e0', porcentaje: 0 },
  { orden: 2, nombre: 'Básico', colorHex: '#bdbdbd', porcentaje: 25 },
  { orden: 3, nombre: 'Intermedio', colorHex: '#8c8c8c', porcentaje: 50 },
  { orden: 4, nombre: 'Avanzado', colorHex: '#555555', porcentaje: 75 },
  { orden: 5, nombre: 'Excelente', colorHex: '#222222', porcentaje: 100 },
];

export type TipoDemo = 'opcion_multiple' | 'verdadero_falso' | 'numerica' | 'respuesta_corta' | 'desarrollo';

export interface CriterioDemo {
  nombre: string;
  descripcion: string;
  puntajeMaximo: number;
}

export interface PreguntaDemo {
  tipo: TipoDemo;
  enunciado: string;
  puntajeMaximo: number;
  opciones?: unknown;
  criterios?: CriterioDemo[];
}

export const PREGUNTAS: PreguntaDemo[] = [
  {
    tipo: 'opcion_multiple',
    enunciado: '¿Qué protocolo usa por defecto el puerto 443?',
    puntajeMaximo: 2,
    opciones: [
      { id: 'a', texto: 'HTTP', correcta: false },
      { id: 'b', texto: 'HTTPS', correcta: true },
      { id: 'c', texto: 'FTP', correcta: false },
      { id: 'd', texto: 'SSH', correcta: false },
    ],
  },
  { tipo: 'verdadero_falso', enunciado: 'UDP garantiza que los paquetes lleguen en orden.', puntajeMaximo: 2, opciones: { correcta: false } },
  { tipo: 'numerica', enunciado: '¿Cuántos bits tiene una dirección IPv4?', puntajeMaximo: 2, opciones: { respuestaCorrecta: 32, tolerancia: 0 } },
  {
    tipo: 'respuesta_corta',
    enunciado: 'Definí en una oración qué hace un router.',
    puntajeMaximo: 2,
    criterios: [
      { nombre: 'Precisión técnica de la función', descripcion: 'La definición es técnicamente correcta: reenvía paquetes entre redes.', puntajeMaximo: 1.2 },
      { nombre: 'Claridad y síntesis', descripcion: 'Responde en una oración, clara y sin rodeos.', puntajeMaximo: 0.8 },
    ],
  },
  {
    tipo: 'desarrollo',
    enunciado: 'Explicá la diferencia entre TCP y UDP y dejá un ejemplo de uso de cada uno.',
    puntajeMaximo: 2,
    criterios: [
      { nombre: 'Diferenciación técnica entre TCP y UDP', descripcion: 'Explica fiabilidad, orientación a conexión, control de flujo y congestión.', puntajeMaximo: 0.8 },
      { nombre: 'Ejemplificación de uso', descripcion: 'Da un ejemplo adecuado de cada protocolo y justifica por qué.', puntajeMaximo: 0.6 },
      { nombre: 'Coherencia y estructura argumentativa', descripcion: 'La respuesta está organizada y se entiende.', puntajeMaximo: 0.6 },
    ],
  },
];

export type EstadoDemo = 'sin_corregir' | 'para_revisar' | 'vencida' | 'aceptada' | 'editada';

export interface AlumnoDemo {
  nombre: string;
  email: string;
  estado: EstadoDemo;
  /** Lo que contestó a cada pregunta, en el orden de PREGUNTAS (null: la dejó en blanco). */
  contenido: Array<string | boolean | number | null>;
  /** Nivel (1 a 5) que la IA le dio a cada criterio de las dos preguntas abiertas: [pregunta 4, pregunta 5]. Sin corregir: no hay. */
  niveles?: [number[], number[]];
  /** Solo en «editada»: lo que cambió el docente. */
  edicion?: { notasFinales: Array<number | null>; devolucion5: string; devolucion4: string; feedbackGeneral: string };
  /** Señales de integridad que registró el intento. */
  eventos?: Array<{ tipo: string; detalle?: string }>;
  /** Horas atrás en que entregó. */
  haceHoras: number;
}

export const ALUMNOS: AlumnoDemo[] = [
  {
    nombre: 'Camila Ortiz', email: 'camila.ortiz@demo.catedra.test', estado: 'aceptada', haceHoras: 30,
    contenido: ['b', false, 32, 'Un router reenvía paquetes entre redes distintas eligiendo la mejor ruta.', 'TCP es orientado a conexión: garantiza orden y entrega con control de flujo y congestión, por ejemplo en la web. UDP no garantiza nada pero tiene menos demora, por ejemplo en videollamadas y juegos en línea.'],
    niveles: [[5, 5], [5, 4, 5]],
  },
  {
    nombre: 'Mateo Sosa', email: 'mateo.sosa@demo.catedra.test', estado: 'editada', haceHoras: 29,
    contenido: ['c', false, 32, 'Un router conecta redes y manda los datos.', 'TCP confirma que llegó todo y UDP no. TCP se usa para mandar mails y UDP para ver videos.'],
    niveles: [[4, 3], [3, 3, 3]],
    edicion: {
      notasFinales: [null, null, null, 1.6, 1.4],
      devolucion4: 'Identificás bien la función (conectar redes y reenviar datos), pero falta mencionar que lo hace según la dirección IP de destino.',
      devolucion5: 'Distinguís bien la fiabilidad de TCP frente a UDP. Tus ejemplos son correctos pero los dejaste sin justificar: sumá por qué cada uno conviene en ese caso. Subí la nota porque el planteo general es sólido.',
      feedbackGeneral: 'Buen parcial. Repasá puertos y protocolos de aplicación (la primera pregunta) y justificá tus ejemplos con el requisito de cada servicio.',
    },
  },
  {
    nombre: 'Ayelén Romero', email: 'ayelen.romero@demo.catedra.test', estado: 'aceptada', haceHoras: 28,
    contenido: ['a', true, 32, 'Un router es un aparato de internet.', 'TCP y UDP son protocolos. Uno es más rápido.'],
    niveles: [[2, 2], [2, 1, 2]],
  },
  {
    nombre: 'Tomás Ledesma', email: 'tomas.ledesma@demo.catedra.test', estado: 'para_revisar', haceHoras: 6,
    contenido: ['b', false, 32, 'Un router reenvía paquetes entre redes según la dirección de destino.', 'TCP es orientado a conexión y garantiza orden y entrega, por ejemplo en la web. UDP no garantiza nada pero es más rápido, por ejemplo en videollamadas.'],
    niveles: [[5, 5], [4, 4, 4]],
  },
  {
    nombre: 'Valentina Cruz', email: 'valentina.cruz@demo.catedra.test', estado: 'para_revisar', haceHoras: 5,
    contenido: ['b', true, 31, 'Un router une redes y les da la dirección IP a las computadoras.', 'TCP es más seguro. UDP es más rápido, se usa para streaming y TCP para páginas.'],
    niveles: [[3, 4], [3, 2, 3]],
  },
  {
    nombre: 'Joaquín Ríos', email: 'joaquin.rios@demo.catedra.test', estado: 'para_revisar', haceHoras: 4,
    contenido: ['b', false, 32, 'Un router es un dispositivo de capa 3 que reenvía paquetes entre redes distintas según la dirección IP de destino.', 'TCP es un protocolo de transporte orientado a conexión que ofrece entrega confiable y ordenada, control de flujo y de congestión; se usa en HTTP. UDP es no orientado a conexión, sin garantías, con menor latencia; se usa en DNS y videollamadas.'],
    niveles: [[5, 5], [5, 5, 5]],
    eventos: [
      { tipo: 'salida_pantalla_completa' }, { tipo: 'salida_pantalla_completa' }, { tipo: 'salida_pantalla_completa' },
      { tipo: 'cambio_pestana' }, { tipo: 'cambio_pestana' }, { tipo: 'cambio_pestana' }, { tipo: 'cambio_pestana' },
      { tipo: 'pegado', detalle: '412 caracteres en la pregunta 5' }, { tipo: 'pegado', detalle: '168 caracteres en la pregunta 4' },
      { tipo: 'salto_de_texto', detalle: 'Aparecieron 380 caracteres en 1 segundo' },
    ],
  },
  {
    nombre: 'Lucía Herrera', email: 'lucia.herrera@demo.catedra.test', estado: 'vencida', haceHoras: 3,
    contenido: ['b', false, null, 'Un router conecta redes', null],
    niveles: [[3, 2], [1, 1, 1]],
    eventos: [{ tipo: 'cambio_pestana' }],
  },
  {
    nombre: 'Sofía Benítez', email: 'sofia.benitez@demo.catedra.test', estado: 'sin_corregir', haceHoras: 1,
    contenido: ['b', false, 32, 'Un router reenvía paquetes entre redes.', 'TCP garantiza la entrega y UDP no. TCP en la web, UDP en videollamadas.'],
  },
  {
    nombre: 'Bruno Paz', email: 'bruno.paz@demo.catedra.test', estado: 'sin_corregir', haceHoras: 1,
    contenido: ['d', true, 128, 'Un router sirve para tener wifi.', 'No me acuerdo bien la diferencia.'],
  },
];

// ---------------------------------------------------------------------------------------------------------------------------------

const redondear = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** ¿Acertó la pregunta cerrada `indice` (0 a 2)? Todo o nada, como en la corrección real. */
export function acierta(indice: number, contenido: AlumnoDemo['contenido'][number]): boolean {
  if (indice === 0) return contenido === 'b';
  if (indice === 1) return contenido === false;
  if (indice === 2) return Number(contenido) === 32 && contenido !== null;
  return false;
}

const COMENTARIOS = [
  ['Falta casi todo lo pedido.', 'Define la función de forma muy parcial.', 'Cubre lo esencial, con imprecisiones.', 'Explicación correcta, con algún detalle por pulir.', 'Explicación exacta y completa.'],
  ['No se entiende o no responde.', 'Aporta una idea pero sin desarrollo.', 'Se entiende, aunque con poco desarrollo.', 'Bien organizada, con pequeños saltos.', 'Muy clara y bien organizada.'],
];

export interface RespuestaDemo {
  alumno: AlumnoDemo;
  estado: 'pendiente_correccion' | 'corregido' | 'revisado';
  estadoRevision: 'pendiente' | 'aceptada' | 'editada';
  respuestasPorPregunta: Array<Record<string, unknown>>;
  notaTotalSugerida: number | null;
  notaTotalFinal: number | null;
  feedbackGeneralSugerido: string | null;
  feedbackGeneralFinal: string | null;
}

/**
 * La respuesta de cada alumno tal como queda guardada. `preguntaIds` y `criterioIds` (por pregunta, en orden) son los ids con que se
 * crearon las preguntas y sus criterios.
 */
export function armarRespuesta(alumno: AlumnoDemo, preguntaIds: string[], criterioIds: string[][]): RespuestaDemo {
  const corregida = alumno.estado !== 'sin_corregir';
  const items = PREGUNTAS.map((p, i) => {
    const base = { preguntaId: preguntaIds[i], contenidoRespuesta: alumno.contenido[i] ?? null, notaSugerida: 0, notaFinal: null as number | null };
    if (!corregida) return base;
    if (i < 3) {
      const correcta = acierta(i, alumno.contenido[i]);
      return { ...base, correcta, notaSugerida: correcta ? p.puntajeMaximo : 0 };
    }
    const niveles = alumno.niveles![i - 3];
    const notaPorCriterio = p.criterios!.map((c, k) => {
      const nivel = niveles[k];
      const respondio = alumno.contenido[i] !== null;
      return {
        criterioId: criterioIds[i][k],
        nombre: c.nombre,
        nivelSugerido: nivel,
        notaSugerida: redondear((c.puntajeMaximo * NIVELES[nivel - 1].porcentaje) / 100),
        comentario: respondio ? COMENTARIOS[k === 0 ? 0 : 1][nivel - 1] : 'No respondió esta pregunta.',
      };
    });
    return { ...base, notaSugerida: redondear(notaPorCriterio.reduce((s, n) => s + n.notaSugerida, 0)), notaPorCriterio };
  });

  const notaTotalSugerida = corregida ? redondear(items.reduce((s, it) => s + (it.notaSugerida as number), 0)) : null;
  const revisada = alumno.estado === 'aceptada' || alumno.estado === 'editada';

  if (alumno.estado === 'aceptada') items.forEach((it) => (it.notaFinal = it.notaSugerida as number));
  if (alumno.estado === 'editada') {
    const e = alumno.edicion!;
    items.forEach((it, i) => {
      it.notaFinal = e.notasFinales[i] ?? (it.notaSugerida as number);
    });
    (items[3] as Record<string, unknown>).feedbackFinal = e.devolucion4;
    (items[4] as Record<string, unknown>).feedbackFinal = e.devolucion5;
  }

  const sugerido = corregida
    ? notaTotalSugerida! >= 7
      ? 'Muy buen desempeño: dominás los conceptos centrales. Revisá los detalles que se señalan en cada pregunta.'
      : notaTotalSugerida! >= 4
        ? 'Aprobado con aspectos a mejorar: repasá las preguntas en las que perdiste puntos y justificá mejor tus respuestas.'
        : 'Necesitás reforzar los contenidos básicos de la unidad. Te recomendamos volver sobre el material antes del recuperatorio.'
    : null;

  return {
    alumno,
    estado: !corregida ? 'pendiente_correccion' : revisada ? 'revisado' : 'corregido',
    estadoRevision: alumno.estado === 'editada' ? 'editada' : alumno.estado === 'aceptada' ? 'aceptada' : 'pendiente',
    respuestasPorPregunta: items,
    notaTotalSugerida,
    notaTotalFinal: revisada ? redondear(items.reduce((s, it) => s + ((it.notaFinal as number) ?? 0), 0)) : null,
    feedbackGeneralSugerido: sugerido,
    feedbackGeneralFinal: alumno.estado === 'editada' ? alumno.edicion!.feedbackGeneral : alumno.estado === 'aceptada' ? sugerido : null,
  };
}
