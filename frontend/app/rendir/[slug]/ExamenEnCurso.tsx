'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  AntiCheatConfig,
  EstadoIntentoRendir,
  MotivoCaptura,
  TipoEventoCliente,
  enviarLatido,
  entregarIntento,
  guardarBorrador,
  registrarEvento,
  subirCaptura,
} from '@/lib/api';
import {
  ErrorCompartirPantalla,
  MENSAJES_COMPARTIR,
  capturarFrame,
  compartirPantalla,
  detenerPantalla,
  hayMonitorExtendido,
  pantallaActiva,
} from '@/lib/captura-pantalla';
import { TarjetaPreguntaAlumno } from '@/app/components/PreguntaAlumno';
import { useConfirmar } from '@/app/components/Confirmar';
import { alCambiarPantallaCompleta, enPantallaCompleta, entrarPantallaCompleta, pantallaCompletaSoportada } from '@/lib/pantalla-completa';

type Respuestas = Record<string, unknown>;
type EstadoGuardado = 'guardado' | 'guardando' | 'pendiente' | 'sin_conexion' | 'demasiado_grande';

// El servidor rechaza con 400 (contenido) o 413 (cuerpo) lo que supera el tamaño máximo.
const esDemasiadoGrande = (e: unknown) => e instanceof ApiError && (e.status === 400 || e.status === 413);

const AUTOGUARDADO_DEBOUNCE_MS = 1500;
const REINTENTO_MS = 5000;
/** Cada cuánto avisa el navegador que sigue vivo (y recibe la marca y los pedidos de captura). */
const LATIDO_MS = 15_000;
/** Después de un evento sospechoso se toman dos capturas: cuando la otra ventana ya está al frente, y unos segundos más tarde. */
const CAPTURAS_DE_EVENTO_MS = [1500, 5000];

/** El servidor cerró esta sesión porque el alumno volvió a ingresar (con su código) desde otro lugar. */
function esSesionReemplazada(e: unknown): boolean {
  if (!(e instanceof ApiError) || e.status !== 401) return false;
  try {
    return JSON.parse(e.body)?.codigo === 'SESION_REEMPLAZADA';
  } catch {
    return false;
  }
}
const claveLocal = (slug: string) => `ata_borrador_${slug}`;

function leerBorradorLocal(slug: string): Respuestas | null {
  try {
    const raw = window.localStorage.getItem(claveLocal(slug));
    return raw ? (JSON.parse(raw) as Respuestas) : null;
  } catch {
    return null; // localStorage bloqueado o roto: se sigue solo con el servidor
  }
}

function formatearRestante(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function ExamenEnCurso({
  slug,
  token,
  inicial,
  titulo,
  consigna,
  alTerminar,
  alReemplazar,
  pantallaInicial,
}: {
  slug: string;
  token: string;
  inicial: EstadoIntentoRendir;
  /** La pantalla que el alumno compartió antes de empezar (si el examen la pide). Tras un refresh no hay: se vuelve a pedir. */
  pantallaInicial?: MediaStream | null;
  /** El servidor cerró esta sesión porque el alumno ingresó desde otro lugar: vuelve a la pantalla de ingreso. */
  alReemplazar?: () => void;
  titulo: string;
  /** Instrucciones generales del examen: antes de empezar se ven en la pantalla de ingreso; durante el examen quedan a mano acá. */
  consigna?: string;
  alTerminar: (como: 'entregado' | 'vencido') => void;
}) {
  const { preguntas, antiCheat, expiraEn } = inicial;
  const confirmar = useConfirmar();

  // Lo del servidor es la base; si en este dispositivo hay algo escrito después del último
  // guardado (se cortó la conexión), gana lo local.
  const [respuestas, setRespuestas] = useState<Respuestas>(() => ({ ...inicial.borrador, ...(leerBorradorLocal(slug) ?? {}) }));
  const [guardado, setGuardado] = useState<EstadoGuardado>('guardado');
  const [ultimoGuardado, setUltimoGuardado] = useState<Date | null>(null);
  const [entregando, setEntregando] = useState(false);
  const [errorEntrega, setErrorEntrega] = useState<string | null>(null);
  const [fueraDePantalla, setFueraDePantalla] = useState(false);
  const [sesionReemplazada, setSesionReemplazada] = useState(false);
  // Pantalla compartida (control opcional del examen) y la marca que muestra la página (tiene que verse en las capturas).
  const [pantalla, setPantalla] = useState<MediaStream | null>(pantallaInicial ?? null);
  const [errorPantalla, setErrorPantalla] = useState<string | null>(null);
  const [compartiendoAhora, setCompartiendoAhora] = useState(false);
  const [marca, setMarca] = useState<string | null>(null);
  const pantallaRef = useRef<MediaStream | null>(pantalla);
  pantallaRef.current = pantalla;
  const marcaRef = useRef<string | null>(null);
  const necesitaPantalla = !!antiCheat?.pantallaCompartida;

  // Diferencia entre el reloj del servidor y el de este dispositivo.
  const desfase = useRef(new Date(inicial.ahora).getTime() - Date.now());
  const vencimiento = expiraEn ? new Date(expiraEn).getTime() : null;
  const [restanteMs, setRestanteMs] = useState<number | null>(vencimiento ? vencimiento - (Date.now() + desfase.current) : null);

  const respuestasRef = useRef(respuestas);
  respuestasRef.current = respuestas;
  const sucio = useRef(false); // hay cambios sin confirmar en el servidor
  const guardandoAhora = useRef(false);
  const terminando = useRef(false);
  const demasiadoGrande = useRef(false); // el servidor rechazó el tamaño: no insistir hasta que el alumno cambie algo

  // ---------------------------------------------------------------- terminar (entrega o vencimiento)
  const terminar = useCallback(
    (como: 'entregado' | 'vencido') => {
      if (terminando.current) return;
      terminando.current = true;
      detenerPantalla(pantallaRef.current);
      try {
        window.localStorage.removeItem(claveLocal(slug));
      } catch {
        /* ignorar */
      }
      alTerminar(como);
    },
    [slug, alTerminar],
  );

  // ---------------------------------------------------------------- autoguardado
  const guardarAhora = useCallback(async () => {
    if (guardandoAhora.current || !sucio.current || terminando.current || demasiadoGrande.current) return;
    guardandoAhora.current = true;
    const enviado = respuestasRef.current;
    setGuardado('guardando');
    try {
      const r = await guardarBorrador(slug, token, enviado);
      if (respuestasRef.current === enviado) sucio.current = false; // no cambió mientras se guardaba
      setUltimoGuardado(new Date(r.guardadoEn));
      setGuardado(sucio.current ? 'pendiente' : 'guardado');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        terminar('vencido'); // el servidor ya cerró el intento
      } else if (esDemasiadoGrande(e)) {
        demasiadoGrande.current = true; // no se reintenta: cada intento reenviaría todo el texto
        setGuardado('demasiado_grande');
      } else if (esSesionReemplazada(e)) {
        setSesionReemplazada(true);
      } else if (e instanceof ApiError && e.status === 401) {
        setGuardado('sin_conexion');
        setErrorEntrega('Tu sesión del examen venció. Volvé a ingresar con tu email: lo que escribiste está guardado.');
      } else {
        setGuardado('sin_conexion'); // sigue guardado en este dispositivo; se reintenta solo
      }
    } finally {
      guardandoAhora.current = false;
    }
  }, [slug, token, terminar]);

  function cambiarRespuesta(preguntaId: string, valor: unknown) {
    const siguiente = { ...respuestasRef.current, [preguntaId]: valor };
    respuestasRef.current = siguiente;
    setRespuestas(siguiente);
    sucio.current = true;
    demasiadoGrande.current = false; // cambió algo: vale la pena reintentar
    setGuardado((g) => (g === 'sin_conexion' ? g : 'pendiente'));
    try {
      window.localStorage.setItem(claveLocal(slug), JSON.stringify(siguiente)); // copia local inmediata
    } catch {
      /* ignorar */
    }
  }

  // Guarda poco después de dejar de escribir, y reintenta periódicamente si algo quedó pendiente.
  useEffect(() => {
    if (!sucio.current) return;
    const t = setTimeout(guardarAhora, AUTOGUARDADO_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [respuestas, guardarAhora]);
  useEffect(() => {
    const t = setInterval(guardarAhora, REINTENTO_MS);
    return () => clearInterval(t);
  }, [guardarAhora]);

  // ---------------------------------------------------------------- entrega
  const entregar = useCallback(
    async (automatica: boolean) => {
      if (terminando.current) return;
      setEntregando(true);
      setErrorEntrega(null);
      try {
        const r = await entregarIntento(slug, token, respuestasRef.current);
        terminar(r.aTiempo ? 'entregado' : 'vencido');
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          terminar('vencido');
        } else if (esSesionReemplazada(e)) {
          setSesionReemplazada(true);
        } else if (esDemasiadoGrande(e)) {
          if (automatica) {
            // Se terminó el tiempo: se entrega lo último que sí se alcanzó a guardar en el servidor.
            try {
              const r = await entregarIntento(slug, token);
              terminar(r.aTiempo ? 'entregado' : 'vencido');
              return;
            } catch {
              /* se reintenta en el próximo ciclo */
            }
          }
          setErrorEntrega('Tus respuestas juntas son demasiado largas para entregarlas. Acortá alguna y probá de nuevo.');
        } else {
          setErrorEntrega(
            automatica
              ? 'Se terminó el tiempo pero no hay conexión para entregar. No cierres la página: se reintenta solo.'
              : 'No se pudo entregar. Revisá tu conexión y probá de nuevo: tus respuestas siguen guardadas.',
          );
        }
      } finally {
        setEntregando(false);
      }
    },
    [slug, token, terminar],
  );

  // ---------------------------------------------------------------- reloj
  useEffect(() => {
    if (!vencimiento) return;
    const t = setInterval(() => setRestanteMs(vencimiento - (Date.now() + desfase.current)), 1000);
    return () => clearInterval(t);
  }, [vencimiento]);
  const seAcabo = restanteMs !== null && restanteMs <= 0;
  useEffect(() => {
    if (!seAcabo) return;
    entregar(true);
    const t = setInterval(() => entregar(true), REINTENTO_MS); // si no había conexión, reintenta
    return () => clearInterval(t);
  }, [seAcabo, entregar]);

  // ---------------------------------------------------------------- anti-cheat (solo registra; nunca bloquea ni baja nota)
  const cola = useRef<Array<{ tipo: TipoEventoCliente; detalle?: string }>>([]);
  const vaciando = useRef(false);
  const vaciarCola = useCallback(async () => {
    // Un solo ciclo a la vez: si entra un evento mientras se envía otro, el ciclo en curso lo
    // toma al seguir (con dos ciclos en paralelo se enviaría dos veces el mismo elemento).
    if (vaciando.current) return;
    vaciando.current = true;
    try {
      while (cola.current.length > 0 && !terminando.current) {
        const ev = cola.current[0];
        try {
          await registrarEvento(slug, token, ev.tipo, ev.detalle);
          cola.current.shift();
        } catch (e) {
          // 4xx (sesión/estado) no se reintenta; error de red sí, en el próximo ciclo.
          if (e instanceof ApiError) cola.current.shift();
          else return;
        }
      }
    } finally {
      vaciando.current = false;
    }
  }, [slug, token]);
  const reportar = useCallback(
    (tipo: TipoEventoCliente, detalle?: string) => {
      cola.current.push({ tipo, detalle });
      vaciarCola();
    },
    [vaciarCola],
  );

  // ---------------------------------------------------------------- pantalla compartida y capturas
  const capturando = useRef(false);
  const ultimaDeEvento = useRef<Record<string, number>>({});
  /** Saca una captura de lo que se ve y la manda. Si falla no se reintenta: el servidor anota si una pedida no llega. */
  const tomarCaptura = useCallback(
    async (motivo: MotivoCaptura, pedidoId?: string) => {
      const stream = pantallaRef.current;
      if (!stream || terminando.current || capturando.current) return;
      capturando.current = true;
      try {
        const imagen = await capturarFrame(stream);
        if (!imagen) return;
        await subirCaptura(slug, token, { motivo, pedidoId, marca: marcaRef.current ?? undefined, imagen });
      } catch {
        /* sin reintento */
      } finally {
        capturando.current = false;
      }
    },
    [slug, token],
  );
  /** Dos capturas después de un evento sospechoso (el servidor limita cuántas guarda). */
  const capturarPorEvento = useCallback(
    (motivo: Exclude<MotivoCaptura, 'muestreo'>) => {
      if (!necesitaPantalla) return;
      const ahora = Date.now();
      if (ahora - (ultimaDeEvento.current[motivo] ?? 0) < 8000) return; // no más de un par por evento seguido
      ultimaDeEvento.current[motivo] = ahora;
      for (const ms of CAPTURAS_DE_EVENTO_MS) setTimeout(() => tomarCaptura(motivo), ms);
    },
    [necesitaPantalla, tomarCaptura],
  );

  // Si el alumno corta la pantalla compartida (botón del navegador) queda anotado y el examen se oculta hasta que la vuelva a compartir.
  useEffect(() => {
    const pista = pantalla?.getVideoTracks()[0];
    setCompartiendoAhora(pantallaActiva(pantalla));
    if (!pista) return;
    const alCortar = () => {
      setCompartiendoAhora(false);
      if (!terminando.current) reportar('pantalla_compartida_detenida');
    };
    pista.addEventListener('ended', alCortar);
    return () => pista.removeEventListener('ended', alCortar);
  }, [pantalla, reportar]);

  async function volverACompartir() {
    setErrorPantalla(null);
    try {
      const nueva = await compartirPantalla();
      setPantalla(nueva);
      if (antiCheat?.pantallaCompleta && !enPantallaCompleta()) entrarPantallaCompleta(); // mejor esfuerzo: si el navegador no deja, queda el aviso de siempre
    } catch (e) {
      setErrorPantalla(MENSAJES_COMPARTIR[e instanceof ErrorCompartirPantalla ? e.motivo : 'error']);
    }
  }

  // Latido: el navegador avisa que sigue vivo, y el servidor responde con la marca visible y, a veces, con el pedido de una captura.
  useEffect(() => {
    if (!antiCheat || sesionReemplazada) return;
    let vivo = true;
    let extendidoAnotado = false;
    const latir = async () => {
      if (terminando.current) return;
      try {
        const r = await enviarLatido(slug, token, { foco: document.hasFocus(), visible: !document.hidden, compartiendo: pantallaActiva(pantallaRef.current) });
        if (!vivo) return;
        marcaRef.current = r.marca;
        setMarca(r.marca);
        if (r.capturaPedida) void tomarCaptura('muestreo', r.capturaPedida.id);
        if (antiCheat.pantallaCompartida && hayMonitorExtendido() && !extendidoAnotado) {
          extendidoAnotado = true;
          reportar('monitor_extendido');
        }
      } catch (e) {
        if (!vivo) return;
        if (esSesionReemplazada(e)) setSesionReemplazada(true);
        else if (e instanceof ApiError && e.status === 409) terminar('vencido');
        /* sin conexión: el próximo latido lo reintenta (el servidor anota el hueco) */
      }
    };
    void latir();
    const t = setInterval(latir, LATIDO_MS);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [antiCheat, slug, token, sesionReemplazada, tomarCaptura, reportar, terminar]);
  useEffect(() => {
    const t = setInterval(vaciarCola, REINTENTO_MS);
    return () => clearInterval(t);
  }, [vaciarCola]);

  useEffect(() => {
    const cfg: AntiCheatConfig | null = antiCheat;
    if (!cfg) return;
    // En un dispositivo que no permite pantalla completa (p. ej. iPhone) ese control no se puede cumplir:
    // ni se exige ni se registra (el alumno lo vio en el aviso antes de empezar).
    const pantallaCompleta = !!cfg.pantallaCompleta && pantallaCompletaSoportada();
    let fuera = false; // un "salir" cuenta una sola vez aunque disparen blur y visibilitychange
    const salio = () => {
      if (fuera || terminando.current) return;
      fuera = true;
      if (cfg.cambioPestana) reportar('cambio_pestana');
      capturarPorEvento('cambio_pestana');
    };
    const volvio = () => {
      fuera = false;
    };
    const onVisibility = () => (document.hidden ? salio() : volvio());
    const onFullscreen = () => {
      if (terminando.current) return;
      if (pantallaCompleta && !enPantallaCompleta()) {
        setFueraDePantalla(true);
        reportar('salida_pantalla_completa');
        capturarPorEvento('salida_pantalla_completa');
      } else {
        setFueraDePantalla(false);
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!cfg.pegado) return;
      const el = (e.target as HTMLElement | null)?.closest?.('[data-pregunta]') as HTMLElement | null;
      reportar('pegado', el?.dataset.pregunta ? `pregunta ${el.dataset.pregunta}` : undefined);
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', salio);
    window.addEventListener('focus', volvio);
    const dejarDeEscucharPantalla = alCambiarPantallaCompleta(onFullscreen);
    document.addEventListener('paste', onPaste);
    // Si al retomar (refresh) ya no estamos en pantalla completa, hay que pedirla de nuevo.
    if (pantallaCompleta && !enPantallaCompleta()) setFueraDePantalla(true);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', salio);
      window.removeEventListener('focus', volvio);
      dejarDeEscucharPantalla();
      document.removeEventListener('paste', onPaste);
    };
  }, [antiCheat, reportar, capturarPorEvento]);

  // Aviso del navegador al intentar cerrar/recargar con el examen abierto.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (terminando.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  const respondidas = useMemo(() => preguntas.filter((p) => tieneRespuesta(respuestas[p.id])).length, [preguntas, respuestas]);
  const poco = restanteMs !== null && restanteMs < 5 * 60_000;
  // Sin pantalla compartida (si el examen la pide) no se ven las preguntas: el tiempo sigue corriendo.
  const bloqueadoPorPantalla = necesitaPantalla && !compartiendoAhora && !seAcabo;

  const etiquetaGuardado =
    guardado === 'guardando'
      ? 'Guardando…'
      : guardado === 'pendiente'
        ? 'Cambios sin guardar…'
        : guardado === 'sin_conexion'
          ? 'Sin conexión: guardado en este dispositivo, reintentando…'
          : guardado === 'demasiado_grande'
            ? 'No se puede guardar: tus respuestas juntas son demasiado largas. Acortá alguna (queda guardado en este dispositivo).'
            : ultimoGuardado
              ? `Guardado ${ultimoGuardado.toLocaleTimeString('es-AR')}`
              : 'Todo guardado';

  return (
    <div className="page">
      {/* Barra fija: el reloj y el estado del guardado siempre a la vista */}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          padding: '10px 0',
          marginBottom: 16,
          background: 'var(--color-bg, #fff)',
          borderBottom: '1px solid var(--color-divider, #ddd)',
        }}
      >
        <strong>{titulo}</strong>
        <span className="muted" data-testid="estado-guardado">
          {etiquetaGuardado}
        </span>
        {necesitaPantalla && marca && !sesionReemplazada && (
          <span className="muted" data-testid="marca" title="Este código cambia solo; tiene que verse en las capturas de tu pantalla." style={{ fontFamily: 'monospace', letterSpacing: 2 }}>
            ID {marca}
          </span>
        )}
        {restanteMs !== null && (
          <strong data-testid="reloj" style={{ color: poco ? 'var(--color-danger, #b00020)' : undefined, fontVariantNumeric: 'tabular-nums' }}>
            {seAcabo ? 'Tiempo terminado' : `Tiempo restante ${formatearRestante(restanteMs)}`}
          </strong>
        )}
      </div>

      {sesionReemplazada && (
        <div className="error-box" role="alert" data-testid="sesion-reemplazada" style={{ marginBottom: 16 }}>
          <strong>Abriste este examen en otro lugar.</strong> Esta sesión se cerró para que no haya dos personas respondiendo a la vez. Lo que escribiste
          antes está guardado. Si querés seguir desde acá, ingresá de nuevo con un código nuevo (eso cerrará la otra sesión).{' '}
          <button type="button" className="btn btn-primary" onClick={alReemplazar}>
            Ingresar de nuevo
          </button>
        </div>
      )}

      {bloqueadoPorPantalla && !sesionReemplazada && (
        <div className="card" role="alert" data-testid="barrera-pantalla" style={{ marginBottom: 16 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>
            Compartí tu pantalla para continuar
          </div>
          <p className="muted" style={{ marginBottom: 12 }}>
            Este examen se rinde compartiendo la pantalla completa. Tus respuestas siguen guardadas y el tiempo sigue corriendo.
          </p>
          {errorPantalla && <div className="error-box">{errorPantalla}</div>}
          <button type="button" className="btn btn-primary" onClick={volverACompartir}>
            Compartir pantalla completa
          </button>
        </div>
      )}

      {fueraDePantalla && antiCheat?.pantallaCompleta && !seAcabo && !bloqueadoPorPantalla && !sesionReemplazada && (
        <div className="error-box" role="alert" style={{ marginBottom: 16 }}>
          Este examen se rinde en pantalla completa.{' '}
          <button
            type="button"
            className="btn btn-primary"
            onClick={entrarPantallaCompleta}
          >
            Volver a pantalla completa
          </button>{' '}
          <span className="muted">El tiempo sigue corriendo.</span>
        </div>
      )}

      {errorEntrega && <div className="error-box">{errorEntrega}</div>}

      {consigna?.trim() && !sesionReemplazada && (
        <details className="instrucciones-examen">
          <summary>Instrucciones del examen</summary>
          <p>{consigna}</p>
        </details>
      )}

      {!bloqueadoPorPantalla && !sesionReemplazada && preguntas.map((p, i) => (
        <TarjetaPreguntaAlumno
          key={p.id}
          pregunta={p}
          numero={i + 1}
          valor={respuestas[p.id]}
          onChange={(v) => cambiarRespuesta(p.id, v)}
          deshabilitado={seAcabo || entregando}
        />
      ))}

      {!bloqueadoPorPantalla && !sesionReemplazada && (
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          type="button"
          disabled={entregando || seAcabo}
          onClick={async () => {
            const faltan = preguntas.length - respondidas;
            const aviso = faltan > 0 ? `${faltan === 1 ? 'Te falta 1 pregunta sin responder' : `Te faltan ${faltan} preguntas sin responder`}.\n\n` : '';
            const confirmado = await confirmar({
              titulo: '¿Entregar el examen?',
              mensaje: `${aviso}Después no vas a poder cambiar tus respuestas.`,
              textoConfirmar: 'Entregar',
              textoCancelar: faltan > 0 ? 'Volver a revisar' : 'Cancelar',
            });
            if (confirmado) entregar(false);
          }}
        >
          {entregando ? 'Entregando…' : 'Entregar examen'}
        </button>
        <span className="muted">
          {respondidas} de {preguntas.length} respondidas
        </span>
      </div>
      )}
    </div>
  );
}

function tieneRespuesta(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}
