'use client';

// Asistente de "Nuevo examen" en TRES pasos: Preguntas (el curso, las preguntas y cuánto vale cada una), Ajustes (control de
// integridad, instrucciones, cómo se rinde y cómo corrige la IA: casi siempre alcanzan los valores por defecto, por eso van
// DESPUÉS y no mezclados con las preguntas) y Publicar (el link para los alumnos, una vez creado el examen). El título se edita
// en el encabezado de la página en todos los pasos. Este archivo es el orquestador: guarda el estado (`datos`, `preguntas`, paso,
// errores), valida cada paso, crea el examen al final de Ajustes y precarga el formulario cuando se duplica uno (?desde=<examenId>).
// Se dibuja con PasoDatos (partes 'encabezado', 'integridad' y 'ajustes'), PasoPreguntas (con PreguntaCard y RubricaEditor) y PasoPublicar.
//
// Además guarda un borrador en el navegador mientras se arma el examen (ver lib/borrador-examen.ts): si se cierra la pestaña, al
// volver se ofrece continuar donde se dejó. El examen se crea en el servidor recién al apretar "Crear examen".

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Cargando } from '@/app/components/Cargando';
import { useConfirmar } from '@/app/components/Confirmar';
import { SinSesion } from '@/app/components/SinSesion';
import { TituloEditable } from '@/app/components/TituloEditable';
import { ApiError, createExamen, getExamen, listCursos, listMatricesRubrica, renombrarExamen } from '@/lib/api';
import type { Curso, MatrizRubrica } from '@/lib/api';
import { useSesion } from '@/lib/auth';
import {
  CONSIGNA_POR_DEFECTO,
  TITULO_POR_DEFECTO,
  construirPregunta,
  datosPorDefecto,
  esNumero,
  examenAFormulario,
  formatearPuntos,
  hayErrorEnAjustes,
  mensajesDelServidor,
  nivelesPorDefecto,
  reconciliarNiveles,
  redondearPuntos,
  totalCoincideConEscala,
  totalDelExamen,
  validarAjustes,
  validarEncabezado,
  validarDistribucion,
  validarNiveles,
  validarPregunta,
} from '@/lib/examen-form';
import type { DatosForm, PreguntaForm } from '@/lib/examen-form';
import { plegarCompletas } from '@/lib/examen-preguntas';
import { borradorTieneContenido, claveBorrador, haceCuanto, leerBorrador, serializarBorrador } from '@/lib/borrador-examen';
import type { Borrador } from '@/lib/borrador-examen';
import { PasoDatos } from './PasoDatos';
import { PasoPreguntas } from './PasoPreguntas';
import { PasoPublicar } from './PasoPublicar';
import { VistaPreviaButton } from './VistaPreviaAlumno';

// Curso y título eran un paso entero para dos campos: ahora son el encabezado de la pantalla de armado. La escala de niveles y la
// distribución esperada viven en "Cómo corrige la IA" (plegado), porque los valores por defecto sirven para la mayoría de los casos.
const PASOS = ['Preguntas', 'Ajustes', 'Publicar'];
const hayCursoReal = (id: string) => id !== '' && id !== 'nuevo';
const PASO_PREGUNTAS = 0;
const PASO_AJUSTES = 1;
const PASO_PUBLICAR = 2;

export default function NuevoExamenPage() {
  return (
    <Suspense fallback={<div className="page"><Cargando variante="asistente" etiqueta="Cargando el asistente de examen…" /></div>}>
      <NuevoExamenForm />
    </Suspense>
  );
}

function NuevoExamenForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const cursoIdParam = searchParams.get('cursoId') ?? '';
  const desdeParam = searchParams.get('desde') ?? ''; // id de un examen para duplicar
  const { docente, cargando } = useSesion();
  const confirmar = useConfirmar();

  const [paso, setPaso] = useState(PASO_PREGUNTAS);
  // Los errores se guardan separados: los de las preguntas se le pasan a <PasoPreguntas/> (despliega y lleva el foco a la tarjeta
  // que nombran) y no tienen que dispararse cuando el docente corrige un dato del encabezado.
  const [erroresDatos, setErroresDatos] = useState<string[]>([]);
  const [erroresPreguntas, setErroresPreguntas] = useState<string[]>([]);
  const [errorServidor, setErrorServidor] = useState<string[]>([]);
  const cajaErrores = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);

  // Todo el formulario: `datos` (paso 1) y `preguntas` (paso 2). Son objetos planos, fáciles de serializar.
  const [datos, setDatos] = useState<DatosForm>(() => ({ ...datosPorDefecto(), titulo: TITULO_POR_DEFECTO, cursoElegido: cursoIdParam }));
  const [preguntas, setPreguntas] = useState<PreguntaForm[]>([]);
  const [cursos, setCursos] = useState<Curso[] | null>(null);
  const [matrices, setMatrices] = useState<MatrizRubrica[]>([]);

  // "Cómo se rinde" y "Cómo corrige la IA" de los ajustes (plegados por defecto). Viven acá para que un error de validación pueda abrirlos.
  const [ajustesAbierto, setAjustesAbierto] = useState(false);
  const [avanzadoAbierto, setAvanzadoAbierto] = useState(false);

  // Borrador guardado en el navegador: el que se encontró al entrar (a decidir) y cuándo fue el último autoguardado.
  const [borradorPendiente, setBorradorPendiente] = useState<Borrador | null>(null);
  const [guardadoEn, setGuardadoEn] = useState<number | null>(null);
  const borradorRevisado = useRef(false);

  // Duplicar desde un examen existente (?desde=<examenId>): se carga una sola vez y el formulario se precarga con sus datos.
  const [cargandoDesde, setCargandoDesde] = useState(Boolean(desdeParam));
  const [duplicandoTitulo, setDuplicandoTitulo] = useState<string | null>(null);
  const [errorDesde, setErrorDesde] = useState<string | null>(null);
  const desdeIniciado = useRef(false);

  // Cuando el examen ya está creado (paso Publicar).
  const [examenCreadoId, setExamenCreadoId] = useState<string | null>(null);
  const [cursoDelExamenId, setCursoDelExamenId] = useState('');

  // Un examen se arma desde la página de su curso: sin curso (ni examen para duplicar) no hay nada que hacer acá, se vuelve al inicio.
  useEffect(() => {
    if (docente && !cursoIdParam && !desdeParam) router.replace('/');
  }, [docente, cursoIdParam, desdeParam, router]);

  useEffect(() => {
    if (!docente) return;
    listMatricesRubrica().then(setMatrices).catch(() => setMatrices([]));
    listCursos()
      .then(setCursos)
      .catch(() => setCursos([]));
  }, [docente]);

  useEffect(() => {
    // Una sola vez (aunque el efecto se vuelva a disparar), y el formulario no se muestra hasta que termina:
    // así la precarga nunca pisa lo que el docente ya empezó a tipear.
    if (!docente || !desdeParam || desdeIniciado.current) return;
    desdeIniciado.current = true;
    getExamen(desdeParam)
      .then((examen) => {
        const d = examenAFormulario(examen);
        setDatos((prev) => ({
          ...prev,
          cursoElegido: d.cursoId,
          titulo: d.titulo,
          consigna: d.consigna,
          modalidad: d.modalidad,
          duracionMinutos: d.duracionMinutos ?? prev.duracionMinutos,
          escalaMin: d.escalaMin,
          escalaMax: d.escalaMax,
          feedbackModo: d.feedbackModo,
          antiCheatOn: d.antiCheat !== null,
          acPantalla: d.antiCheat ? d.antiCheat.pantallaCompleta : prev.acPantalla,
          acPestana: d.antiCheat ? d.antiCheat.cambioPestana : prev.acPestana,
          acPegado: d.antiCheat ? d.antiCheat.pegado : prev.acPegado,
          acCaptura: d.antiCheat ? d.antiCheat.pantallaCompartida === true : prev.acCaptura,
          distOn: d.distribucion !== null,
          umbralAprobacion: d.distribucion ? d.distribucion.umbralAprobacion : prev.umbralAprobacion,
          aprobadosPct: d.distribucion ? d.distribucion.aprobadosPct : prev.aprobadosPct,
          niveles: d.niveles,
        }));
        // Un examen largo se abre con las preguntas plegadas (todas completas: vienen de uno ya creado).
        setPreguntas(d.preguntas.length > 3 ? plegarCompletas(d.preguntas) : d.preguntas);
        setDuplicandoTitulo(examen.titulo);
      })
      .catch((err) => {
        setErrorDesde(
          err instanceof ApiError && err.status === 404
            ? 'No encontramos el examen que querías duplicar (puede que ya no exista). Podés armar uno desde cero.'
            : 'No pudimos cargar el examen que querías duplicar. Podés armar uno desde cero o volver a intentarlo más tarde.',
        );
      })
      .finally(() => setCargandoDesde(false));
  }, [docente, desdeParam]);

  // Las matrices se vuelven a pedir al volver a esta pestaña: así aparece la que el docente creó en /matrices/nueva (otra pestaña).
  useEffect(() => {
    if (!docente) return;
    const recargar = () => {
      listMatricesRubrica().then(setMatrices).catch(() => undefined);
    };
    window.addEventListener('focus', recargar);
    return () => window.removeEventListener('focus', recargar);
  }, [docente]);

  // Borrador: ¿había un examen sin terminar guardado en este navegador? No se restaura solo: se le pregunta al docente.
  useEffect(() => {
    if (!docente || borradorRevisado.current) return;
    borradorRevisado.current = true;
    if (desdeParam) return; // duplicando: se parte del examen original, no de un borrador
    try {
      const b = leerBorrador(window.localStorage.getItem(claveBorrador(docente.id)));
      if (b && borradorTieneContenido(b.datos, b.preguntas)) setBorradorPendiente(b);
    } catch {
      /* storage bloqueado (modo privado, políticas): se sigue sin borrador */
    }
  }, [docente, desdeParam]);

  // Autoguardado, con 0,8 s de pausa tras el último cambio. No guarda un formulario vacío (no pisa un borrador anterior) ni
  // mientras haya un borrador por decidir, ni una vez creado el examen.
  useEffect(() => {
    if (!docente || examenCreadoId || borradorPendiente || cargandoDesde || !borradorRevisado.current) return;
    if (!borradorTieneContenido(datos, preguntas)) return;
    const t = setTimeout(() => {
      try {
        const ahora = Date.now();
        window.localStorage.setItem(claveBorrador(docente.id), serializarBorrador(datos, preguntas, ahora));
        setGuardadoEn(ahora);
      } catch {
        /* sin lugar o bloqueado: solo que no hay borrador, el formulario sigue funcionando */
      }
    }, 800);
    return () => clearTimeout(t);
  }, [datos, preguntas, docente, examenCreadoId, borradorPendiente, cargandoDesde]);

  // Al cambiar de paso se vuelve arriba: si no, el paso nuevo aparece scrolleado a la altura del botón que se apretó.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [paso]);

  if (cargando) {
    return (
      <div className="page">
        <Cargando variante="asistente" etiqueta="Cargando…" />
      </div>
    );
  }
  if (!docente) {
    return (
      <div className="page">
        <SinSesion />
      </div>
    );
  }
  if (cargandoDesde) {
    return (
      <div className="page">
        <Cargando variante="asistente" etiqueta="Cargando el examen que querés duplicar…" />
      </div>
    );
  }

  const patchDatos = (patch: Partial<DatosForm>) => setDatos((prev) => ({ ...prev, ...patch }));

  // Cada cambio de la escala de niveles (cantidad, nombre, orden) llega por acá, desde PasoDatos. Los `niveles` de cada criterio
  // de cada pregunta tienen que acompañarla (misma cantidad y nombres, conservando las descripciones ya escritas): se
  // reconcilian en ese mismo evento y no en un efecto, así el precargado de "duplicar" (que arma las dos cosas juntas) y las
  // ediciones de las preguntas nunca se pisan ni hay un bucle. Un cambio que no es de la escala (cualquier otro campo) no toca las preguntas.
  const cambiarDatos = (patch: Partial<DatosForm>) => {
    const nuevos = patch.niveles;
    if (nuevos) {
      const anteriores = datos.niveles;
      setPreguntas((prev) => reconciliarNiveles(prev, nuevos, anteriores));
    }
    patchDatos(patch);
    // Con errores del encabezado o los ajustes a la vista, la lista se actualiza mientras el docente corrige: los que ya resolvió desaparecen.
    if (erroresDatos.length > 0) setErroresDatos(paso === PASO_PREGUNTAS ? validarEncabezado({ ...datos, ...patch }) : validarAjustes({ ...datos, ...patch }));
  };

  // ---------------------------------------------------------------- validación (con mensajes concretos)
  /** Errores del paso «Preguntas»: el encabezado (título, curso, total) y, por separado, las preguntas con sus puntos. */
  function validarPasoPreguntas(): { datos: string[]; preguntas: string[] } {
    const ep: string[] = [];
    if (preguntas.length === 0) ep.push('Agregá al menos una pregunta.');
    preguntas.forEach((q, i) => ep.push(...validarPregunta(q, i)));
    // La nota es la suma de puntos y no se normaliza: lo que suman las preguntas tiene que ser lo que vale el examen.
    const total = totalDelExamen(preguntas);
    if (preguntas.length > 0 && esNumero(datos.escalaMax) && !totalCoincideConEscala(total, Number(datos.escalaMax))) {
      const puedeCambiarTotal = !esNumero(datos.escalaMin) || total > Number(datos.escalaMin);
      ep.push(
        `Las preguntas suman ${formatearPuntos(total)} puntos y el examen vale ${formatearPuntos(Number(datos.escalaMax))}. ` +
          `Ajustá los puntos de alguna pregunta${puedeCambiarTotal ? ` o hacé que el examen valga ${formatearPuntos(total)}` : ''}.`,
      );
    }
    return { datos: validarEncabezado(datos), preguntas: ep };
  }

  /** Un error de un bloque plegado ("Cómo se rinde", "Cómo corrige la IA") no se ve: se abre para que el motivo quede a la vista. */
  const hayErrorAvanzado = () => validarNiveles(datos.niveles).length > 0 || validarDistribucion(datos).length > 0;
  const abrirBloquesConError = () => {
    if (hayErrorAvanzado()) setAvanzadoAbierto(true);
    if (hayErrorEnAjustes(datos)) setAjustesAbierto(true);
  };

  /** Hay algo escrito en el formulario (sin contar el borrador pendiente): continuar con el borrador lo reemplazaría. */
  const hayAlgoEscrito = borradorTieneContenido(datos, preguntas);

  async function continuarBorrador() {
    const b = borradorPendiente;
    if (!b) return;
    // Lo que se escribió desde que se entró se pierde al restaurar: se avisa antes (antes se pisaba sin decir nada).
    if (hayAlgoEscrito && !(await confirmar({ mensaje: 'Lo que escribiste desde que entraste se reemplaza por el borrador guardado.', textoConfirmar: 'Usar el borrador' }))) return;
    // El examen se arma dentro de un curso: un borrador de OTRO curso no se vuelca acá (cambiaría el curso sin que se note), se abre en el suyo.
    const cursoDelBorradorId = b.datos.cursoElegido;
    if (hayCursoReal(cursoDelBorradorId) && cursoDelBorradorId !== datos.cursoElegido) {
      router.push(`/examenes/nuevo?cursoId=${cursoDelBorradorId}`);
      return;
    }
    setDatos({ ...b.datos, titulo: b.datos.titulo.trim() || TITULO_POR_DEFECTO, cursoElegido: datos.cursoElegido });
    setPreguntas(b.preguntas);
    setBorradorPendiente(null);
  }

  function descartarBorrador() {
    try {
      window.localStorage.removeItem(claveBorrador(docente!.id));
    } catch {
      /* nada que borrar */
    }
    setBorradorPendiente(null);
  }

  /** Lleva la vista hasta el cuadro de errores: con el formulario largo, si no, quedaba fuera de pantalla y el botón parecía no hacer nada. */
  function mostrarErrores() {
    setTimeout(() => cajaErrores.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
  }

  /** De «Preguntas» a «Ajustes»: se revisa solo lo de este paso, y todo lo que falta se muestra de una vez. */
  function irAAjustes() {
    const e = validarPasoPreguntas();
    setErroresDatos(e.datos);
    setErroresPreguntas(e.preguntas);
    setErrorServidor([]);
    if (e.datos.length > 0 || e.preguntas.length > 0) {
      mostrarErrores();
      return;
    }
    setPaso(PASO_AJUSTES);
  }

  /** Volver a un paso anterior (antes de crear el examen): no se pierde nada de lo cargado. */
  function irAPaso(i: number) {
    if (examenCreadoId || i >= paso) return; // con el examen ya creado no se vuelve a editar
    setErroresDatos([]);
    setErroresPreguntas([]);
    setErrorServidor([]);
    setPaso(i);
  }

  async function handleCrearExamen() {
    setErrorServidor([]);
    // Por las dudas se vuelve a revisar el paso de preguntas (se puede llegar acá y haber cambiado algo atrás).
    const ep = validarPasoPreguntas();
    if (ep.datos.length > 0 || ep.preguntas.length > 0) {
      setErroresDatos(ep.datos);
      setErroresPreguntas(ep.preguntas);
      setPaso(PASO_PREGUNTAS);
      mostrarErrores();
      return;
    }
    const ea = validarAjustes(datos);
    setErroresDatos(ea);
    setErroresPreguntas([]);
    if (ea.length > 0) {
      abrirBloquesConError();
      mostrarErrores();
      return;
    }
    setLoading(true);
    try {
      const cursoId = datos.cursoElegido;
      const examen = await createExamen({
        cursoId,
        titulo: datos.titulo.trim(),
        consigna: datos.consigna.trim() || CONSIGNA_POR_DEFECTO,
        modalidad: datos.modalidad,
        duracionMinutos: datos.modalidad === 'sesion_tiempo' ? Number(datos.duracionMinutos) : undefined,
        escalaMin: Number(datos.escalaMin),
        escalaMax: Number(datos.escalaMax),
        niveles: datos.niveles.map((n) => ({ orden: n.orden, nombre: n.nombre, colorHex: n.colorHex, porcentaje: Number(n.porcentaje) })),
        feedbackModo: datos.feedbackModo,
        distribucionEsperada: datos.distOn
          ? { umbralAprobacion: Number(datos.umbralAprobacion), aprobadosEsperadosPct: Number(datos.aprobadosPct) }
          : undefined,
        antiCheat: datos.antiCheatOn
          ? { pantallaCompleta: datos.acPantalla, cambioPestana: datos.acPestana, pegado: datos.acPegado, pantallaCompartida: datos.acCaptura }
          : undefined,
        // Red de seguridad: los niveles de cada criterio tienen que tener la forma de la escala (el servidor exige esa cantidad).
        preguntas: reconciliarNiveles(preguntas, datos.niveles).map(construirPregunta),
      });
      setExamenCreadoId(examen.id);
      setCursoDelExamenId(cursoId);
      try {
        if (docente) window.localStorage.removeItem(claveBorrador(docente.id)); // ya está en el servidor: el borrador no hace falta
      } catch {
        /* nada que borrar */
      }
      setPaso(PASO_PUBLICAR);
    } catch (err) {
      const detalle = mensajesDelServidor(err);
      setErrorServidor([
        'No pudimos crear el examen. Tus datos siguen acá: corregí lo que se indica y probá de nuevo.',
        ...detalle.slice(0, 5).map((d) => `Detalle: ${d}`),
      ]);
      mostrarErrores();
    } finally {
      setLoading(false);
    }
  }

  // Los mensajes del cuadro se recalculan en cada render mientras haya errores a la vista: lo que el docente ya resolvió desaparece solo
  // (`erroresPreguntas` queda como lo devolvió el último intento: es lo que le dice a <PasoPreguntas/> qué tarjetas abrir, y si cambiara
  // en cada tecla le robaría el foco al docente).
  const datosVivos = erroresDatos.length > 0 ? (paso === PASO_PREGUNTAS ? validarEncabezado(datos) : validarAjustes(datos)) : [];
  const preguntasVivas = erroresPreguntas.length > 0 ? validarPasoPreguntas().preguntas : [];
  const mensajes = [...datosVivos, ...preguntasVivas];
  const cursoDelBorrador = borradorPendiente ? cursos?.find((c) => c.id === borradorPendiente.datos.cursoElegido)?.nombre : undefined;
  const borradorDeOtroCurso = Boolean(borradorPendiente && hayCursoReal(borradorPendiente.datos.cursoElegido) && borradorPendiente.datos.cursoElegido !== datos.cursoElegido);
  const totalPuntos = totalDelExamen(preguntas);
  const maxPuntos = esNumero(datos.escalaMax) ? Number(datos.escalaMax) : null;
  const puntosRepartidos = maxPuntos !== null && totalCoincideConEscala(totalPuntos, maxPuntos);

  return (
    <div className="page page-asistente">
      <header className="page-header">
        <div className="eyebrow">Nuevo examen</div>
        <div className="page-header-fila">
          <TituloEditable
            valor={datos.titulo}
            onCambiar={(titulo) => patchDatos({ titulo })}
            onConfirmar={examenCreadoId ? (titulo) => renombrarExamen(examenCreadoId, titulo) : undefined}
          />
          <span className="estado-guardado" aria-live="polite" title="Se guarda en este navegador mientras armás el examen">
            {guardadoEn !== null && !borradorPendiente && !examenCreadoId ? '✓ Borrador guardado en este navegador' : ''}
          </span>
        </div>
      </header>

      {duplicandoTitulo !== null && (
        <div className="aviso-info">
          Estás duplicando «{duplicandoTitulo}». Revisá y ajustá lo que quieras: se crea como un examen nuevo y el original no cambia.
        </div>
      )}
      {errorDesde && (
        <div className="error-box" role="alert">
          {errorDesde}
        </div>
      )}
      {borradorPendiente && !examenCreadoId && (
        <div className="aviso-borrador" role="region" aria-label="Borrador sin terminar">
          <div>
            <strong>Tenés un examen sin terminar:</strong> «{borradorPendiente.datos.titulo.trim() || 'Sin título'}»
            {cursoDelBorrador ? ` (${cursoDelBorrador})` : ''} · {borradorPendiente.preguntas.length} {borradorPendiente.preguntas.length === 1 ? 'pregunta' : 'preguntas'} · guardado{' '}
            {haceCuanto(borradorPendiente.guardadoEn)}
            {hayAlgoEscrito && <p className="muted">Mientras decidís, lo que escribís ahora no se guarda.</p>}
          </div>
          <div className="aviso-borrador-acciones">
            <button type="button" className="btn btn-secondary" onClick={continuarBorrador}>
              {borradorDeOtroCurso ? 'Ir a ese examen' : 'Continuar con ese'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={descartarBorrador}>
              Descartar
            </button>
          </div>
        </div>
      )}

      <p className="paso-sub">
        {paso === PASO_PREGUNTAS && 'Armá las preguntas del examen: escribilas vos, partí de uno anterior o pedile borradores a la IA.'}
        {paso === PASO_AJUSTES && 'Casi siempre alcanzan los valores por defecto: tocá solo lo que necesites.'}
        {paso === PASO_PUBLICAR && 'Tu examen está creado. Elegí quiénes lo rinden y mandales el link.'}
      </p>

      {paso !== PASO_PUBLICAR && (mensajes.length > 0 || errorServidor.length > 0) && (
        <div className="error-box" role="alert" ref={cajaErrores}>
          {errorServidor.length > 0 ? (
            <>
              {errorServidor[0]}
              {errorServidor.length > 1 && (
                <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                  {errorServidor.slice(1).map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              )}
            </>
          ) : mensajes.length === 1 ? (
            mensajes[0]
          ) : (
            <>
              Faltan algunas cosas para poder crear el examen:
              <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                {mensajes.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {paso === PASO_PREGUNTAS && (
        <>
          <PasoDatos
            parte="encabezado"
            datos={datos}
            onChange={cambiarDatos}
            cursos={cursos}
            ajustesAbierto={ajustesAbierto}
            onToggleAjustes={() => setAjustesAbierto((v) => !v)}
            avanzadoAbierto={avanzadoAbierto}
            onToggleAvanzado={() => setAvanzadoAbierto((v) => !v)}
          />

          <PasoPreguntas
            preguntas={preguntas}
            onChange={setPreguntas}
            niveles={datos.niveles}
            matrices={matrices}
            escalaMin={datos.escalaMin}
            escalaMax={datos.escalaMax}
            errores={erroresDatos.length > 0 ? undefined : erroresPreguntas}
            cursoId={datos.cursoElegido}
            onMatrizCreada={(m) => setMatrices((prev) => [m, ...prev.filter((x) => x.id !== m.id)])}
            onCambiarTotal={(valor) => patchDatos({ escalaMax: valor })}
            onUsarComoEscala={(total) => {
              patchDatos({ escalaMax: String(redondearPuntos(total)) });
              setErroresPreguntas([]);
            }}
          />
        </>
      )}

      {paso === PASO_AJUSTES && (
        <>
          <PasoDatos
            parte="integridad"
            datos={datos}
            onChange={cambiarDatos}
            cursos={cursos}
            ajustesAbierto={ajustesAbierto}
            onToggleAjustes={() => setAjustesAbierto((v) => !v)}
            avanzadoAbierto={avanzadoAbierto}
            onToggleAvanzado={() => setAvanzadoAbierto((v) => !v)}
          />
          <PasoDatos
            parte="ajustes"
            datos={datos}
            onChange={cambiarDatos}
            cursos={cursos}
            ajustesAbierto={ajustesAbierto}
            onToggleAjustes={() => setAjustesAbierto((v) => !v)}
            avanzadoAbierto={avanzadoAbierto}
            onToggleAvanzado={() => setAvanzadoAbierto((v) => !v)}
          />
        </>
      )}

      {paso === PASO_PUBLICAR && examenCreadoId && (
        <PasoPublicar
          examenId={examenCreadoId}
          cursoId={cursoDelExamenId}
          tituloExamen={datos.titulo.trim()}
          duracionMinutos={datos.modalidad === 'sesion_tiempo' && Number(datos.duracionMinutos) >= 1 ? Number(datos.duracionMinutos) : null}
        />
      )}

      {paso !== PASO_PUBLICAR && (
        <div className="pie-asistente">
          <nav className="progreso" aria-label="Pasos del examen">
            {PASOS.map((label, i) => {
              const estado = i < paso ? 'done' : i === paso ? 'current' : 'pending';
              return (
                <button
                  key={label}
                  type="button"
                  className="progreso-seg"
                  data-state={estado}
                  aria-current={estado === 'current' ? 'step' : undefined}
                  aria-label={`Paso ${i + 1} de ${PASOS.length}: ${label}${estado === 'done' ? ' (volver a este paso)' : ''}`}
                  title={label}
                  disabled={estado !== 'done' || loading}
                  onClick={() => irAPaso(i)}
                />
              );
            })}
          </nav>
          <div className="pie-asistente-fila">
            <div className="pie-asistente-info">
              <strong>
                Paso {paso + 1} de {PASOS.length} · {PASOS[paso]}
              </strong>
              <span className="muted">
                {paso === PASO_PREGUNTAS
                  ? preguntas.length === 0
                    ? 'Todavía no agregaste preguntas'
                    : `${preguntas.length} ${preguntas.length === 1 ? 'pregunta' : 'preguntas'} · ${formatearPuntos(totalPuntos)}${maxPuntos !== null ? ` de ${formatearPuntos(maxPuntos)}` : ''} pts${puntosRepartidos ? ' ✓' : ''}`
                  : 'Ningún alumno ve nada hasta que publiques.'}
              </span>
            </div>
            <div className="pie-asistente-acciones">
              {paso === PASO_AJUSTES && (
                <button type="button" className="btn btn-ghost" onClick={() => irAPaso(PASO_PREGUNTAS)} disabled={loading}>
                  Atrás
                </button>
              )}
              {preguntas.length > 0 && <VistaPreviaButton datos={datos} preguntas={preguntas} />}
              {paso === PASO_PREGUNTAS ? (
                <button type="button" className="btn btn-primary" onClick={irAAjustes}>
                  Siguiente
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={handleCrearExamen} disabled={loading}>
                  {loading ? 'Creando el examen…' : 'Crear examen'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
