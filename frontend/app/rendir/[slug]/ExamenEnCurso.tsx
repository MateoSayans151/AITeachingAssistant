'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  AntiCheatConfig,
  EstadoIntentoRendir,
  PreguntaRendir,
  TipoEventoIntegridad,
  entregarIntento,
  guardarBorrador,
  registrarEvento,
} from '@/lib/api';
import { alCambiarPantallaCompleta, enPantallaCompleta, entrarPantallaCompleta, pantallaCompletaSoportada } from '@/lib/pantalla-completa';

type Respuestas = Record<string, unknown>;
type EstadoGuardado = 'guardado' | 'guardando' | 'pendiente' | 'sin_conexion' | 'demasiado_grande';

// El servidor rechaza con 400 (contenido) o 413 (cuerpo) lo que supera el tamaño máximo.
const esDemasiadoGrande = (e: unknown) => e instanceof ApiError && (e.status === 400 || e.status === 413);

const AUTOGUARDADO_DEBOUNCE_MS = 1500;
const REINTENTO_MS = 5000;
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
  alTerminar,
}: {
  slug: string;
  token: string;
  inicial: EstadoIntentoRendir;
  titulo: string;
  alTerminar: (como: 'entregado' | 'vencido') => void;
}) {
  const { preguntas, antiCheat, expiraEn } = inicial;

  // Lo del servidor es la base; si en este dispositivo hay algo escrito después del último
  // guardado (se cortó la conexión), gana lo local.
  const [respuestas, setRespuestas] = useState<Respuestas>(() => ({ ...inicial.borrador, ...(leerBorradorLocal(slug) ?? {}) }));
  const [guardado, setGuardado] = useState<EstadoGuardado>('guardado');
  const [ultimoGuardado, setUltimoGuardado] = useState<Date | null>(null);
  const [entregando, setEntregando] = useState(false);
  const [errorEntrega, setErrorEntrega] = useState<string | null>(null);
  const [fueraDePantalla, setFueraDePantalla] = useState(false);

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
      } else if (e instanceof ApiError && e.status === 401) {
        setGuardado('sin_conexion');
        setErrorEntrega('Tu sesión del examen venció. Volvé a ingresar con tu email y código: lo que escribiste está guardado.');
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
  const cola = useRef<Array<{ tipo: TipoEventoIntegridad; detalle?: string }>>([]);
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
    (tipo: TipoEventoIntegridad, detalle?: string) => {
      cola.current.push({ tipo, detalle });
      vaciarCola();
    },
    [vaciarCola],
  );
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
  }, [antiCheat, reportar]);

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
        {restanteMs !== null && (
          <strong data-testid="reloj" style={{ color: poco ? 'var(--color-danger, #b00020)' : undefined, fontVariantNumeric: 'tabular-nums' }}>
            {seAcabo ? 'Tiempo terminado' : `Tiempo restante ${formatearRestante(restanteMs)}`}
          </strong>
        )}
      </div>

      {fueraDePantalla && antiCheat?.pantallaCompleta && !seAcabo && (
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

      {preguntas.map((p, i) => (
        <div key={p.id} className="card" style={{ marginBottom: 16 }} data-pregunta={i + 1}>
          <div className="card-title" style={{ marginBottom: 12 }}>
            {i + 1}. {p.enunciado} <span className="muted">({p.puntajeMaximo} pts)</span>
          </div>
          <CampoRespuesta pregunta={p} valor={respuestas[p.id]} onChange={(v) => cambiarRespuesta(p.id, v)} disabled={seAcabo || entregando} />
        </div>
      ))}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          type="button"
          disabled={entregando || seAcabo}
          onClick={() => {
            const faltan = preguntas.length - respondidas;
            const aviso = faltan > 0 ? `Te faltan ${faltan} pregunta(s) sin responder. ` : '';
            if (window.confirm(`${aviso}¿Entregar el examen? Después no vas a poder cambiar tus respuestas.`)) entregar(false);
          }}
        >
          {entregando ? 'Entregando…' : 'Entregar examen'}
        </button>
        <span className="muted">
          {respondidas} de {preguntas.length} respondidas
        </span>
      </div>
    </div>
  );
}

function tieneRespuesta(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function CampoRespuesta({
  pregunta: p,
  valor,
  onChange,
  disabled,
}: {
  pregunta: PreguntaRendir;
  valor: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
}) {
  const abiertas = ['desarrollo', 'resolucion_problema', 'demostracion', 'analisis_caso', 'respuesta_corta'];

  if (abiertas.includes(p.tipo)) {
    return (
      <textarea
        aria-label={`Respuesta a: ${p.enunciado}`}
        value={typeof valor === 'string' ? valor : ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    );
  }

  if (p.tipo === 'numerica') {
    return (
      <input
        type="number"
        aria-label={`Respuesta a: ${p.enunciado}`}
        value={typeof valor === 'number' ? valor : ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        disabled={disabled}
      />
    );
  }

  if (p.tipo === 'verdadero_falso') {
    return (
      <div style={{ display: 'flex', gap: 16 }}>
        {[
          { label: 'Verdadero', v: true },
          { label: 'Falso', v: false },
        ].map((o) => (
          <label key={o.label} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="radio" name={`vf-${p.id}`} checked={valor === o.v} onChange={() => onChange(o.v)} disabled={disabled} />
            {o.label}
          </label>
        ))}
      </div>
    );
  }

  if (p.tipo === 'opcion_multiple') {
    return (
      <>
        {(p.opciones as Array<{ id: string; texto: string }>).map((o) => (
          <label key={o.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <input type="radio" name={`om-${p.id}`} checked={valor === o.id} onChange={() => onChange(o.id)} disabled={disabled} />
            {o.texto}
          </label>
        ))}
      </>
    );
  }

  if (p.tipo === 'casillas') {
    const actuales = Array.isArray(valor) ? (valor as string[]) : [];
    return (
      <>
        {(p.opciones as Array<{ id: string; texto: string }>).map((o) => (
          <label key={o.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={actuales.includes(o.id)}
              onChange={(e) => onChange(e.target.checked ? [...actuales, o.id] : actuales.filter((id) => id !== o.id))}
              disabled={disabled}
            />
            {o.texto}
          </label>
        ))}
      </>
    );
  }

  if (p.tipo === 'relacionar_pares') {
    const cfg = p.opciones as { izquierda: string[]; derecha: string[] };
    const pares = Array.isArray(valor) ? (valor as Array<[string, string]>) : [];
    return (
      <>
        {cfg.izquierda.map((izq) => (
          <div key={izq} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
            <div style={{ paddingTop: 10 }}>{izq}</div>
            <select
              aria-label={`Elegí la pareja de ${izq}`}
              value={pares.find(([i]) => i === izq)?.[1] ?? ''}
              onChange={(e) => {
                const resto = pares.filter(([i]) => i !== izq);
                onChange(e.target.value ? [...resto, [izq, e.target.value]] : resto);
              }}
              disabled={disabled}
            >
              <option value="">Elegí…</option>
              {cfg.derecha.map((der) => (
                <option key={der} value={der}>
                  {der}
                </option>
              ))}
            </select>
          </div>
        ))}
      </>
    );
  }

  return null;
}
