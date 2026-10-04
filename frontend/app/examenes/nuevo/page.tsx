'use client';

// Wizard de "Nuevo examen". Este archivo es el orquestador: guarda el estado (`datos`, `preguntas`, paso, errores), valida paso
// a paso, navega entre pasos, crea el examen y precarga el formulario cuando se duplica uno (?desde=<examenId>). Cada paso se
// dibuja en su componente: PasoDatos, PasoPreguntas (con PreguntaCard y RubricaEditor) y PasoPublicar (autocontenido).

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiError, createCurso, createExamen, getExamen, listCursos, listMatricesRubrica } from '@/lib/api';
import type { Curso, MatrizRubrica } from '@/lib/api';
import { useSesion } from '@/lib/auth';
import {
  construirPregunta,
  datosPorDefecto,
  esNumero,
  examenAFormulario,
  formatearPuntos,
  mensajesDelServidor,
  nivelesPorDefecto,
  preguntaVacia,
  redondearPuntos,
  totalCoincideConEscala,
  totalDelExamen,
  validarDatos,
  validarDistribucion,
  validarNiveles,
  validarPregunta,
} from '@/lib/examen-form';
import type { DatosForm, PreguntaForm } from '@/lib/examen-form';
import { PasoDatos } from './PasoDatos';
import { PasoPreguntas } from './PasoPreguntas';
import { PasoPublicar } from './PasoPublicar';

// La escala de niveles y la distribución esperada ya no son pasos: viven en "Opciones avanzadas" del primer paso, porque
// los valores por defecto sirven para la mayoría de los casos y no tiene sentido obligar a pasar por ahí.
const PASOS = ['Datos', 'Preguntas', 'Publicar'];
const PASO_PREGUNTAS = 1;
const PASO_PUBLICAR = 2;

export default function NuevoExamenPage() {
  return (
    <Suspense fallback={<div className="page"><p className="muted">Cargando…</p></div>}>
      <NuevoExamenForm />
    </Suspense>
  );
}

function NuevoExamenForm() {
  const searchParams = useSearchParams();
  const cursoIdParam = searchParams.get('cursoId') ?? '';
  const desdeParam = searchParams.get('desde') ?? ''; // id de un examen para duplicar
  const { docente, cargando } = useSesion();

  const [paso, setPaso] = useState(0);
  const [errores, setErrores] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // Todo el formulario: `datos` (paso 1) y `preguntas` (paso 2). Son objetos planos, fáciles de serializar.
  const [datos, setDatos] = useState<DatosForm>(() => ({ ...datosPorDefecto(), cursoElegido: cursoIdParam }));
  const [preguntas, setPreguntas] = useState<PreguntaForm[]>(() => [preguntaVacia(nivelesPorDefecto())]);
  const [cursos, setCursos] = useState<Curso[] | null>(null);
  const [matrices, setMatrices] = useState<MatrizRubrica[]>([]);

  // Opciones avanzadas del paso 1 (plegadas por defecto). Viven acá para que un error de validación pueda abrirlas.
  const [avanzadoAbierto, setAvanzadoAbierto] = useState(false);
  const [nivelesPersonalizar, setNivelesPersonalizar] = useState(false); // editor de nombres y porcentajes de los niveles

  // Duplicar desde un examen existente (?desde=<examenId>): se carga una sola vez y el formulario se precarga con sus datos.
  const [cargandoDesde, setCargandoDesde] = useState(Boolean(desdeParam));
  const [duplicandoTitulo, setDuplicandoTitulo] = useState<string | null>(null);
  const [errorDesde, setErrorDesde] = useState<string | null>(null);
  const desdeIniciado = useRef(false);

  // Cuando el examen ya está creado (paso Publicar).
  const [examenCreadoId, setExamenCreadoId] = useState<string | null>(null);
  const [cursoDelExamenId, setCursoDelExamenId] = useState('');

  useEffect(() => {
    if (!docente) return;
    listMatricesRubrica().then(setMatrices).catch(() => setMatrices([]));
    listCursos()
      .then((cs) => {
        setCursos(cs);
        // Sin curso indicado: el primero de la lista, o crear uno si todavía no hay ninguno.
        setDatos((prev) => ({ ...prev, cursoElegido: prev.cursoElegido || (cs.length > 0 ? cs[0].id : 'nuevo') }));
      })
      .catch(() => {
        setCursos([]);
        setDatos((prev) => ({ ...prev, cursoElegido: prev.cursoElegido || 'nuevo' }));
      });
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
          distOn: d.distribucion !== null,
          umbralAprobacion: d.distribucion ? d.distribucion.umbralAprobacion : prev.umbralAprobacion,
          aprobadosPct: d.distribucion ? d.distribucion.aprobadosPct : prev.aprobadosPct,
          niveles: d.niveles,
        }));
        setPreguntas(d.preguntas);
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

  if (cargando) {
    return (
      <div className="page">
        <p className="muted">Cargando…</p>
      </div>
    );
  }
  if (!docente) {
    return (
      <div className="page">
        <p className="muted">Identificate primero desde el inicio.</p>
      </div>
    );
  }
  if (cargandoDesde) {
    return (
      <div className="page">
        <p className="muted">Cargando el examen que querés duplicar…</p>
      </div>
    );
  }

  const patchDatos = (patch: Partial<DatosForm>) => setDatos((prev) => ({ ...prev, ...patch }));

  // ---------------------------------------------------------------- validación (paso a paso, con mensajes concretos)
  function validarPaso(p: number): string[] {
    if (p === 0) return validarDatos(datos);
    const e: string[] = [];
    if (p === PASO_PREGUNTAS) {
      preguntas.forEach((q, i) => e.push(...validarPregunta(q, i)));
      // La nota es la suma de puntos y la escala no se normaliza: el total de las preguntas tiene que ser la escala máxima.
      const total = totalDelExamen(preguntas);
      if (esNumero(datos.escalaMax) && !totalCoincideConEscala(total, Number(datos.escalaMax))) {
        const puedeCambiarEscala = !esNumero(datos.escalaMin) || total > Number(datos.escalaMin);
        e.push(
          `El total de puntos de las preguntas (${formatearPuntos(total)}) tiene que ser igual a la escala máxima (${formatearPuntos(Number(datos.escalaMax))}). ` +
            `Ajustá los puntajes de las preguntas${puedeCambiarEscala ? ` o cambiá la escala máxima a ${formatearPuntos(total)}` : ''}.`,
        );
      }
    }
    return e;
  }

  /** Un error de las opciones avanzadas no se ve si el bloque está plegado: se abre para que el motivo quede a la vista. */
  const hayErrorAvanzado = () => validarNiveles(datos.niveles).length > 0 || validarDistribucion(datos).length > 0;

  function irASiguiente() {
    const e = validarPaso(paso);
    setErrores(e);
    if (e.length > 0 && paso === 0 && hayErrorAvanzado()) setAvanzadoAbierto(true);
    if (e.length === 0) setPaso(paso + 1);
  }

  function irAPaso(i: number) {
    if (examenCreadoId || i >= paso) return; // con el examen ya creado no se vuelve a editar
    setErrores([]);
    setPaso(i);
  }

  async function handleCrearExamen() {
    // Se revisa todo junto: si algo de un paso anterior quedó mal, se vuelve ahí con el motivo.
    for (const p of [0, PASO_PREGUNTAS]) {
      const e = validarPaso(p);
      if (e.length > 0) {
        setErrores(e);
        if (p === 0 && hayErrorAvanzado()) setAvanzadoAbierto(true);
        setPaso(p);
        return;
      }
    }
    setErrores([]);
    setLoading(true);
    try {
      let cursoId = datos.cursoElegido;
      if (datos.cursoElegido === 'nuevo') {
        const nuevo = await createCurso({ nombre: datos.cursoNuevoNombre.trim() });
        cursoId = nuevo.id;
        // Si lo que sigue falla, un reintento no tiene que crear otro curso igual.
        setCursos((prev) => [...(prev ?? []), nuevo]);
        patchDatos({ cursoElegido: nuevo.id });
      }
      const examen = await createExamen({
        cursoId,
        titulo: datos.titulo.trim(),
        consigna: datos.consigna.trim(),
        modalidad: datos.modalidad,
        duracionMinutos: datos.modalidad === 'sesion_tiempo' ? Number(datos.duracionMinutos) : undefined,
        escalaMin: Number(datos.escalaMin),
        escalaMax: Number(datos.escalaMax),
        niveles: datos.niveles.map((n) => ({ orden: n.orden, nombre: n.nombre, colorHex: n.colorHex, porcentaje: Number(n.porcentaje) })),
        feedbackModo: datos.feedbackModo,
        distribucionEsperada: datos.distOn
          ? { umbralAprobacion: Number(datos.umbralAprobacion), aprobadosEsperadosPct: Number(datos.aprobadosPct) }
          : undefined,
        antiCheat: datos.antiCheatOn ? { pantallaCompleta: datos.acPantalla, cambioPestana: datos.acPestana, pegado: datos.acPegado } : undefined,
        preguntas: preguntas.map(construirPregunta),
      });
      setExamenCreadoId(examen.id);
      setCursoDelExamenId(cursoId);
      setPaso(PASO_PUBLICAR);
    } catch (err) {
      const detalle = mensajesDelServidor(err);
      setErrores([
        'No se pudo crear el examen. Tus datos siguen acá: corregí lo que se indica y probá de nuevo.',
        ...detalle.slice(0, 5).map((d) => `Detalle: ${d}`),
      ]);
      setPaso(PASO_PREGUNTAS);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">Nuevo examen</div>
        <h1>{datos.titulo || 'Configurar examen'}</h1>
      </header>

      {duplicandoTitulo !== null && (
        <div className="card" style={{ marginBottom: 20 }}>
          Estás duplicando «{duplicandoTitulo}». Revisá y ajustá lo que quieras: se crea como un examen nuevo y el original no cambia.
        </div>
      )}
      {errorDesde && (
        <div className="error-box" role="alert">
          {errorDesde}
        </div>
      )}

      <div className="stepper">
        {PASOS.map((label, i) => {
          const estado = i < paso ? 'done' : i === paso ? 'current' : 'pending';
          const volverPosible = !examenCreadoId && i < paso;
          return (
            <div
              className="step"
              key={label}
              data-state={estado}
              aria-current={estado === 'current' ? 'step' : undefined}
              role={volverPosible ? 'button' : undefined}
              tabIndex={volverPosible ? 0 : undefined}
              onClick={volverPosible ? () => irAPaso(i) : undefined}
              onKeyDown={
                volverPosible
                  ? (ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        irAPaso(i);
                      }
                    }
                  : undefined
              }
              title={volverPosible ? 'Volver a este paso' : undefined}
            >
              <span className="step-num">{estado === 'done' ? `✓ ${i + 1}` : i + 1}</span>
              <span className="step-label">{label}</span>
            </div>
          );
        })}
      </div>

      {errores.length > 0 && (
        <div className="error-box" role="alert">
          {errores.length === 1 ? (
            errores[0]
          ) : (
            <>
              {errores[0]}
              <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                {errores.slice(1).map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {paso === 0 && (
        <PasoDatos
          datos={datos}
          onChange={patchDatos}
          cursos={cursos}
          avanzadoAbierto={avanzadoAbierto}
          onToggleAvanzado={() => setAvanzadoAbierto((v) => !v)}
          personalizarNiveles={nivelesPersonalizar}
          onPersonalizarNiveles={setNivelesPersonalizar}
        />
      )}

      {paso === PASO_PREGUNTAS && (
        <PasoPreguntas
          preguntas={preguntas}
          onChange={setPreguntas}
          niveles={datos.niveles}
          matrices={matrices}
          escalaMin={datos.escalaMin}
          escalaMax={datos.escalaMax}
          onUsarComoEscala={(total) => {
            patchDatos({ escalaMax: String(redondearPuntos(total)) });
            setErrores([]);
          }}
        />
      )}

      {paso === PASO_PUBLICAR && examenCreadoId && (
        <PasoPublicar examenId={examenCreadoId} cursoId={cursoDelExamenId} tituloExamen={datos.titulo.trim()} />
      )}

      {paso < PASO_PUBLICAR && (
        <div style={{ marginTop: 28, display: 'flex', gap: 12 }}>
          {paso > 0 && (
            <button type="button" className="btn btn-secondary" onClick={() => irAPaso(paso - 1)} disabled={loading}>
              Atrás
            </button>
          )}
          {paso < PASO_PREGUNTAS ? (
            <button type="button" className="btn btn-primary" onClick={irASiguiente}>
              Siguiente
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={handleCrearExamen} disabled={loading}>
              {loading ? 'Creando…' : 'Crear examen y continuar'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
