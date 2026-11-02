// Contenido y lógica de la guía para docentes: los recorridos de «Mostrame esta pantalla», la tarjeta «Primeros pasos» del inicio y la
// página /ayuda. Sin React ni red, para poder testearlo solo (backend/test/guia.test.ts).
//
// Reglas del texto: lo lee alguien que no se lleva bien con la tecnología. Nada de jerga técnica, frases cortas, y los botones se nombran
// exactamente como aparecen en la pantalla (el test lo ayuda a cuidar). Cada `destino` es un atributo `data-guia` de la pantalla real.

export interface PasoRecorrido {
  /** Valor de `data-guia` del elemento a señalar. Sin destino, el paso se muestra centrado. */
  destino?: string;
  titulo: string;
  texto: string;
}

export interface Recorrido {
  clave: string;
  /** Siempre arranca con un paso sin destino: si la pantalla está vacía o a medio cargar, el recorrido igual tiene algo que mostrar. */
  pasos: PasoRecorrido[];
}

const ID = '[^/]+';

const RECORRIDOS: { ruta: RegExp; recorrido: Recorrido }[] = [
  {
    ruta: /^\/$/,
    recorrido: {
      clave: 'inicio',
      pasos: [
        {
          titulo: 'Esta es tu pantalla de inicio',
          texto: 'Desde acá llegás a todo. Te muestro lo importante en unos pocos pasos. Mirar este recorrido no cambia nada de lo que tenés cargado.',
        },
        {
          destino: 'inicio-para-revisar',
          titulo: 'Lo que te está esperando',
          texto: 'Cuando tus alumnos entregan, el examen aparece acá. Un clic y estás viendo sus respuestas.',
        },
        {
          destino: 'inicio-cursos',
          titulo: 'Tus cursos',
          texto: 'Cada materia o cursada es un curso. Todo lo demás vive adentro: exámenes, apuntes y listas de alumnos.',
        },
        {
          destino: 'inicio-nuevo-curso',
          titulo: 'Sumar un curso',
          texto: 'Empezá por acá. Solo te pide un nombre.',
        },
        {
          destino: 'menu-ayuda',
          titulo: 'Si te perdés',
          texto: 'En «Ayuda» está la guía completa. Y «Mostrame esta pantalla» explica la pantalla en la que estés.',
        },
      ],
    },
  },
  {
    ruta: /^\/cursos\/nuevo$/,
    recorrido: {
      clave: 'curso-nuevo',
      pasos: [
        { titulo: 'Crear un curso', texto: 'Un curso agrupa los exámenes, los apuntes y los alumnos de una materia.' },
        {
          destino: 'curso-nuevo-datos',
          titulo: 'Alcanza con el nombre',
          texto: 'Por ejemplo «Historia 3.º A». La materia es opcional, y después apretá «Crear curso».',
        },
      ],
    },
  },
  {
    ruta: new RegExp(`^/cursos/${ID}$`),
    recorrido: {
      clave: 'curso',
      pasos: [
        { titulo: 'Adentro de un curso', texto: 'Acá está todo lo de esta materia, ordenado en cuatro pestañas.' },
        {
          destino: 'curso-pestanas',
          titulo: 'Las cuatro pestañas',
          texto: 'Material: tus apuntes. Exámenes: lo que armaste. Comisiones: tus grupos de alumnos. Docentes: tus compañeros de cátedra.',
        },
        {
          destino: 'curso-nuevo-examen',
          titulo: 'Armar un examen',
          texto: 'Este botón te lleva paso a paso. Nadie ve el examen hasta que lo publiques.',
        },
      ],
    },
  },
  {
    ruta: /^\/examenes\/nuevo$/,
    recorrido: {
      clave: 'examen-nuevo',
      pasos: [
        { titulo: 'Armar un examen', texto: 'Son tres pasos: Preguntas, Ajustes y Publicar. Mientras trabajás, lo que escribís se guarda automáticamente en esta computadora.' },
        {
          destino: 'examen-titulo',
          titulo: 'El nombre del examen',
          texto: 'Hacé clic y escribilo. Es lo que van a ver tus alumnos.',
        },
        {
          destino: 'examen-preguntas',
          titulo: 'Las preguntas',
          texto: 'Escribilas vos o pedile borradores a la IA. Si la pregunta es de desarrollo, la IA propone la nota; si es de opción múltiple, se corrige sola.',
        },
        {
          destino: 'examen-ajustes',
          titulo: 'Control de integridad',
          texto: 'Es opcional. Te avisa, por ejemplo, si el alumno cambió de pestaña. Solo informa: no bloquea nada ni baja la nota.',
        },
        {
          destino: 'examen-publicar',
          titulo: 'Quiénes lo rinden',
          texto: 'Lo más simple es dejar que entre cualquiera que tenga el link: no tenés que cargar ninguna lista de mails.',
        },
        {
          destino: 'examen-pie',
          titulo: 'Para seguir',
          texto: 'Acá ves en qué paso estás y avanzás al siguiente. Con «Vista previa del alumno» ves el examen como lo va a ver tu alumno.',
        },
      ],
    },
  },
  {
    ruta: new RegExp(`^/examenes/${ID}$`),
    recorrido: {
      clave: 'examen',
      pasos: [
        { titulo: 'Tu examen', texto: 'Acá ves cómo quedó, y el link para mandarles a tus alumnos.' },
        {
          destino: 'examen-pestanas',
          titulo: 'Las tres pestañas',
          texto: 'Examen: las preguntas y el link. Respuestas: lo que entregaron. Vara: subir o bajar las notas de todos con una regla.',
        },
        {
          destino: 'examen-acciones',
          titulo: 'Si querés cambiarlo',
          texto: 'Un examen ya creado no se edita, para que todos rindan el mismo. Con «Duplicar y editar» hacés una copia y cambiás lo que quieras.',
        },
      ],
    },
  },
  {
    ruta: new RegExp(`^/examenes/${ID}/respuestas$`),
    recorrido: {
      clave: 'respuestas',
      pasos: [
        { titulo: 'Las respuestas de tus alumnos', texto: 'La IA ya sugirió una nota para cada uno, pero ninguna le llega al alumno hasta que vos la confirmes.' },
        {
          destino: 'respuestas-filtros',
          titulo: 'Encontrar a alguien',
          texto: 'Filtrá por lo que falta revisar o buscá a un alumno por su nombre.',
        },
        {
          destino: 'respuestas-acciones',
          titulo: 'Dos formas de corregir',
          texto: '«Empezar a revisar» te lleva de un alumno al siguiente. «Aceptar sugerencias de la IA» confirma todas juntas, sin mirarlas una por una.',
        },
        {
          destino: 'respuestas-lista',
          titulo: 'Cada alumno',
          texto: 'Entrá a cualquiera para ver qué respondió, por qué la IA le puso esa nota, y cambiarla si no estás de acuerdo.',
        },
        {
          destino: 'respuestas-publicar',
          titulo: 'El último paso',
          texto: 'Cuando publicás las notas, cada alumno recibe la suya por mail. Esto no se puede retirar, así que la app te pide confirmación.',
        },
      ],
    },
  },
  {
    ruta: new RegExp(`^/examenes/${ID}/respuestas/${ID}$`),
    recorrido: {
      clave: 'revision',
      pasos: [
        { titulo: 'Revisar a un alumno', texto: 'Arriba ves qué respondió en cada pregunta y qué nota sugiere la IA. La decisión es tuya.' },
        {
          destino: 'revision-comentario',
          titulo: 'El comentario para el alumno',
          texto: 'Este texto le llega tal cual. Cambialo todo lo que quieras.',
        },
        {
          destino: 'revision-acciones',
          titulo: 'Decidir',
          texto: 'El primer botón acepta lo que sugirió la IA. «Guardar mis cambios» se queda con lo que corregiste vos. Las dos opciones te pasan al siguiente alumno si queda alguno.',
        },
      ],
    },
  },
  {
    ruta: new RegExp(`^/examenes/${ID}/vara$`),
    recorrido: {
      clave: 'vara',
      pasos: [
        { titulo: 'La vara', texto: 'Sirve para subir o bajar las notas sugeridas de todos con una misma regla. Si no la necesitás, ignorá esta pestaña.' },
        {
          destino: 'vara-regla',
          titulo: 'Sin riesgo',
          texto: 'Primero te muestra cómo quedarían las notas, y recién se aplica si lo confirmás. Después la podés deshacer. Las respuestas que ya revisaste no cambian.',
        },
      ],
    },
  },
  {
    ruta: /^\/matrices(\/nueva)?$/,
    recorrido: {
      clave: 'matrices',
      pasos: [
        {
          titulo: 'Matrices de rúbrica',
          texto: 'Una rúbrica es la lista de cosas que mirás para poner la nota. Si siempre corregís con los mismos criterios, guardalos acá y reusalos.',
        },
        {
          destino: 'matrices-nueva',
          titulo: 'Es opcional',
          texto: 'No hace falta crear ninguna. Si en una pregunta no ponés criterios, la IA la corrige igual, mirando la pregunta entera.',
        },
      ],
    },
  },
];

/** El recorrido de una pantalla, o null si no tiene (el botón del menú entonces no se muestra). */
export function recorridoDe(pathname: string | null): Recorrido | null {
  if (!pathname) return null;
  const ruta = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return RECORRIDOS.find((r) => r.ruta.test(ruta))?.recorrido ?? null;
}

export const todosLosRecorridos = (): Recorrido[] => RECORRIDOS.map((r) => r.recorrido);

// ---------------------------------------------------------------- primeros pasos

/** Lo que la tarjeta necesita saber de cada curso (la lista de cursos trae `examenes` con solo estos campos). */
export interface CursoParaPasos {
  id: string;
  examenes?: { estado: string; feedbackLiberadoEn: string | null }[];
}

export interface PasoInicio {
  clave: 'curso' | 'examen' | 'link' | 'notas';
  titulo: string;
  detalle: string;
  hecho: boolean;
  accion: { href: string; etiqueta: string };
}

/** Los cuatro pasos del camino del docente, marcados según lo que ya hizo de verdad. */
export function pasosDeInicio(cursos: CursoParaPasos[], examenPorRevisarId?: string): PasoInicio[] {
  const examenes = cursos.flatMap((c) => c.examenes ?? []);
  const primerCurso = cursos[0];
  const cursoConExamen = cursos.find((c) => (c.examenes?.length ?? 0) > 0) ?? primerCurso;
  const irAlCurso = cursoConExamen ? `/cursos/${cursoConExamen.id}` : '/cursos/nuevo';
  return [
    {
      clave: 'curso',
      titulo: 'Creá tu curso',
      detalle: 'Le ponés un nombre y listo. Adentro van a estar tus exámenes y tus alumnos.',
      hecho: cursos.length > 0,
      accion: { href: '/cursos/nuevo', etiqueta: 'Crear mi curso' },
    },
    {
      clave: 'examen',
      titulo: 'Armá tu primer examen',
      detalle: 'Escribí las preguntas o pedile borradores a la IA. Nadie lo ve hasta que lo publiques.',
      hecho: examenes.length > 0,
      accion: { href: primerCurso ? `/examenes/nuevo?cursoId=${primerCurso.id}` : '/examenes/nuevo', etiqueta: 'Armar un examen' },
    },
    {
      clave: 'link',
      titulo: 'Mandá el link a tus alumnos',
      detalle: 'Lo publicás y copiás el link, como cualquier link que mandarías por WhatsApp o por mail.',
      hecho: examenes.some((e) => e.estado !== 'borrador'),
      accion: { href: irAlCurso, etiqueta: 'Ir a mis exámenes' },
    },
    {
      clave: 'notas',
      titulo: 'Revisá y publicá las notas',
      detalle: 'La IA sugiere, vos decidís. Cuando publicás, a cada alumno le llega su nota por mail.',
      hecho: examenes.some((e) => e.feedbackLiberadoEn !== null),
      accion: { href: examenPorRevisarId ? `/examenes/${examenPorRevisarId}/respuestas` : irAlCurso, etiqueta: 'Ver las respuestas' },
    },
  ];
}

/** El primer paso sin hacer: el único que muestra su botón, así siempre hay una sola cosa para hacer ahora. */
export const pasoActual = (pasos: PasoInicio[]): PasoInicio | null => pasos.find((p) => !p.hecho) ?? null;

/** Clave del navegador donde se recuerda que este docente ocultó la tarjeta. */
export const claveOcultarPrimerosPasos = (docenteId: string) => `ata_primeros_pasos_oculta_${docenteId}`;

// ---------------------------------------------------------------- página /ayuda

export interface PasoGuia {
  id: string;
  titulo: string;
  resumen: string;
  pasos: string[];
  /** Algo que conviene saber, en una frase. */
  nota?: string;
}

export const PASOS_GUIA: PasoGuia[] = [
  {
    id: 'cuenta',
    titulo: 'Crear tu cuenta',
    resumen: 'Una sola vez, con tu mail.',
    pasos: [
      'En la pantalla de entrada apretá «Soy nuevo: crear cuenta».',
      'Escribí tu nombre, tu mail y una contraseña de al menos 8 caracteres.',
      'Abrí el mail que te llega y tocá el enlace para confirmar la cuenta.',
    ],
    nota: 'Si el mail no aparece, mirá en la carpeta de spam o correo no deseado.',
  },
  {
    id: 'curso',
    titulo: 'Crear un curso',
    resumen: 'Es la carpeta de una materia.',
    pasos: ['En el inicio apretá «Nuevo curso».', 'Escribí el nombre del curso y apretá «Crear curso».'],
    nota: 'Si compartís la materia, sumá a tus compañeros en la pestaña «Docentes» del curso. Todos pueden hacer lo mismo.',
  },
  {
    id: 'material',
    titulo: 'Subir tus apuntes (opcional)',
    resumen: 'Ayuda a que la IA corrija según lo que diste.',
    pasos: [
      'Entrá al curso y abrí la pestaña «Material».',
      'Arrastrá el archivo o pegá el texto. Sirven PDF, Word, PowerPoint y archivos de texto, de hasta 4 MB.',
    ],
    nota: 'La app lee texto, no imágenes: un PDF escaneado no sirve.',
  },
  {
    id: 'examen',
    titulo: 'Armar el examen',
    resumen: 'Tres pasos: Preguntas, Ajustes y Publicar.',
    pasos: [
      'Entrá al curso y apretá «+ Nuevo examen».',
      'Hacé clic en el título y escribí el nombre del examen.',
      'Agregá las preguntas. Podés escribirlas vos o pedirle borradores a la IA, que después revisás.',
      'Decí cuántos puntos vale el examen: la app los reparte entre las preguntas.',
      'Apretá «Siguiente». En Ajustes casi siempre podés dejar todo como está.',
      'Apretá «Crear examen».',
    ],
    nota: 'Si se te cierra la ventana no perdés lo escrito: al volver, la app te ofrece seguir donde estabas.',
  },
  {
    id: 'publicar',
    titulo: 'Mandar el link a tus alumnos',
    resumen: 'No necesitan cuenta: entran con su mail.',
    pasos: [
      'En el paso Publicar elegí quiénes pueden entrar. Lo más simple es dejar que entre cualquiera que tenga el link.',
      'Si querés, poné cuándo abre y cuándo cierra.',
      'Apretá «Publicar y generar link».',
      'Copiá el link y mandalo por donde quieras: WhatsApp, mail o el aula virtual.',
    ],
    nota: 'Si no ponés fecha de cierre, el link no vence: conviene poner una.',
  },
  {
    id: 'rinden',
    titulo: 'Mientras tus alumnos rinden',
    resumen: 'No tenés que hacer nada.',
    pasos: [
      'Pueden rendir desde el celular o la computadora.',
      'Lo que escriben se guarda solo. Si se les corta internet o recargan la página, siguen donde estaban.',
      'Cuando entregan, la IA empieza a corregir. Tarda unos segundos por alumno.',
    ],
  },
  {
    id: 'revisar',
    titulo: 'Revisar y publicar las notas',
    resumen: 'La IA sugiere. La nota la decidís vos.',
    pasos: [
      'En el inicio aparece «Para revisar». Tocá el examen.',
      'Apretá «Empezar a revisar» para ver a cada alumno, uno por uno.',
      'Aceptá la sugerencia, o cambiá la nota y el comentario y apretá «Guardar mis cambios».',
      'Cuando termines, publicá las notas: a cada alumno le llega la suya por mail.',
    ],
    nota: 'Tus alumnos no ven una pantalla con la nota: se enteran solo por ese mail.',
  },
];

export interface PreguntaFrecuente {
  pregunta: string;
  respuesta: string;
}

export const PREGUNTAS_FRECUENTES: PreguntaFrecuente[] = [
  {
    pregunta: '¿La IA puede ponerle una nota a un alumno sin que yo la vea?',
    respuesta: 'No. La IA solo sugiere. Ninguna nota sale hasta que la aceptás o la cambiás, y publicás las notas.',
  },
  {
    pregunta: 'Me equivoqué en una pregunta y el examen ya está creado.',
    respuesta:
      'Un examen ya creado no se edita, para que todos rindan el mismo. Apretá «Duplicar y editar», corregí la copia y publicala. Solo el título se puede cambiar en cualquier momento.',
  },
  {
    pregunta: 'Quiero borrar un examen y no me deja.',
    respuesta: 'Solo se puede eliminar si ningún alumno empezó ni entregó. Es para que nadie pierda lo que escribió.',
  },
  {
    pregunta: 'Un alumno dice que no le llegó la nota.',
    respuesta:
      'Primero, que mire en spam. Después fijate en la pantalla de respuestas cuántos mails salieron: si alguno falló, apretá «Reenviar a los que faltan». Si el mail del alumno estaba mal escrito, la app no se entera, así que conviene pasarle la nota por otro lado.',
  },
  {
    pregunta: 'Cambié una nota después de publicarla.',
    respuesta: 'El cambio queda guardado, pero al alumno no le llega un segundo mail. Avisale vos, respondiéndole o por el canal que uses.',
  },
  {
    pregunta: 'Un alumno quiere rendir de nuevo.',
    respuesta: 'Con el mismo mail se rinde una sola vez. Si necesita otra oportunidad, duplicá el examen y mandale el link de la copia.',
  },
  {
    pregunta: 'Una respuesta sigue «sin corregir».',
    respuesta: 'A veces la IA está saturada. Apretá «Corregir pendientes con IA» en la pantalla de respuestas, o poné la nota a mano.',
  },
  {
    pregunta: '¿El control de integridad descubre si alguien se copió?',
    respuesta: 'No. Solo te muestra señales, como que cambió de pestaña o pegó texto. No bloquea el examen ni baja la nota: es información para tu criterio.',
  },
  {
    pregunta: '¿Cuántos mails se pueden mandar?',
    respuesta: 'Depende del plan contratado. En el plan gratuito son 100 por día en total. Si se llega al límite, los que faltan se mandan después con «Reenviar a los que faltan».',
  },
];

export interface TerminoGlosario {
  termino: string;
  definicion: string;
}

export const GLOSARIO: TerminoGlosario[] = [
  { termino: 'Curso', definicion: 'La carpeta de una materia. Adentro están sus exámenes, apuntes, comisiones y docentes.' },
  { termino: 'Comisión', definicion: 'Un grupo de alumnos dentro del curso, por ejemplo «Turno mañana». Cada una tiene su propio link.' },
  { termino: 'Link', definicion: 'La dirección que les mandás a tus alumnos. Al tocarla, entran al examen.' },
  { termino: 'Rúbrica', definicion: 'La lista de cosas que mirás para poner la nota, por ejemplo «Claridad» o «Uso de fuentes».' },
  { termino: 'Criterio', definicion: 'Cada una de las cosas de esa lista. Puede pesar más o menos en la nota.' },
  { termino: 'Matriz de rúbrica', definicion: 'Una rúbrica guardada para volver a usarla en otros exámenes.' },
  { termino: 'Niveles de desempeño', definicion: 'Los escalones de la corrección, por ejemplo de «Insuficiente» a «Excelente». Cada uno equivale a un porcentaje de los puntos.' },
  { termino: 'Vara', definicion: 'Una regla para subir o bajar las notas sugeridas de todos a la vez, por ejemplo para que apruebe el 60 %.' },
  { termino: 'Material', definicion: 'Los apuntes o la bibliografía que subís al curso. La IA los consulta como referencia al corregir.' },
  { termino: 'Control de integridad', definicion: 'Señales opcionales sobre cómo se rindió el examen. Los alumnos ven el aviso antes de empezar.' },
  { termino: 'Borrador', definicion: 'Un examen sin publicar. Tus alumnos todavía no lo pueden ver.' },
];

/** El camino completo, tal como lo dibuja la animación de /ayuda. */
export const CAMINO: { quien: string; que: string }[] = [
  { quien: 'Vos', que: 'armás el examen' },
  { quien: 'Tus alumnos', que: 'lo rinden con el link' },
  { quien: 'La IA', que: 'sugiere una nota' },
  { quien: 'Vos', que: 'decidís la nota final' },
];
