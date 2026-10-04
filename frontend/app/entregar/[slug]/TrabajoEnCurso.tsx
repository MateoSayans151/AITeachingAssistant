'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, EstadoIntentoEntregar, TipoEventoIntegridad, enviarEntrega, guardarBorradorEntrega, registrarEventoEntrega } from '@/lib/api';
import { alCambiarPantallaCompleta, enPantallaCompleta, entrarPantallaCompleta, pantallaCompletaSoportada } from '@/lib/pantalla-completa';

type EstadoGuardado = 'guardado' | 'guardando' | 'pendiente' | 'sin_conexion' | 'demasiado_grande';

// El servidor rechaza con 400 (contenido) o 413 (cuerpo) lo que supera el tamaño máximo.
const esDemasiadoGrande = (e: unknown) => e instanceof ApiError && (e.status === 400 || e.status === 413);

const AUTOGUARDADO_DEBOUNCE_MS = 1500;
const REINTENTO_MS = 5000;
// Copia local para sobrevivir a un refresh sin conexión. En sessionStorage (por pestaña) y no en localStorage: en una
// computadora compartida, el borrador de un alumno no le puede aparecer al siguiente.
const claveLocal = (slug: string) => `ata_borrador_entrega_${slug}`;

function leerBorradorLocal(slug: string): string | null {
  try {
    return window.sessionStorage.getItem(claveLocal(slug));
  } catch {
    return null; // storage bloqueado o roto: se sigue solo con el servidor
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

/** Mensaje que mandó el servidor en un 400, si lo hay. */
function mensajeDelServidor(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  try {
    const m = JSON.parse(e.body)?.message;
    return typeof m === 'string' ? m : null;
  } catch {
    return null;
  }
}

export default function TrabajoEnCurso({
  slug,
  token,
  inicial,
  titulo,
  alTerminar,
}: {
  slug: string;
  token: string;
  inicial: EstadoIntentoEntregar;
  titulo: string;
  alTerminar: (como: 'entregado' | 'vencido') => void;
}) {
  const { consigna, modoSeguro, expiraEn } = inicial;

  // Lo del servidor es la base; si en esta pestaña hay algo escrito después del último guardado
  // (se cortó la conexión), gana lo local.
  const [texto, setTexto] = useState(() => leerBorradorLocal(slug) ?? inicial.borrador);
  const [guardado, setGuardado] = useState<EstadoGuardado>('guardado');
  const [ultimoGuardado, setUltimoGuardado] = useState<Date | null>(null);
  const [entregando, setEntregando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [errorEntrega, setErrorEntrega] = useState<string | null>(null);
  const [fueraDePantalla, setFueraDePantalla] = useState(false);

  // Diferencia entre el reloj del servidor y el de este dispositivo.
  const desfase = useRef(new Date(inicial.ahora).getTime() - Date.now());
  const vencimiento = new Date(expiraEn).getTime();
  const [restanteMs, setRestanteMs] = useState(vencimiento - (Date.now() + desfase.current));

  const textoRef = useRef(texto);
  textoRef.current = texto;
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
        window.sessionStorage.removeItem(claveLocal(slug));
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
    const enviado = textoRef.current;
    setGuardado('guardando');
    try {
      const r = await guardarBorradorEntrega(slug, token, enviado);
      if (textoRef.current === enviado) sucio.current = false; // no cambió mientras se guardaba
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
        setErrorEntrega('Tu sesión venció. Volvé a ingresar con tu nombre y email: lo que escribiste está guardado.');
      } else {
        setGuardado('sin_conexion'); // sigue guardado en esta pestaña; se reintenta solo
      }
    } finally {
      guardandoAhora.current = false;
    }
  }, [slug, token, terminar]);

  function cambiarTexto(valor: string) {
    textoRef.current = valor;
    setTexto(valor);
    sucio.current = true;
    demasiadoGrande.current = false; // cambió algo: vale la pena reintentar
    setGuardado((g) => (g === 'sin_conexion' ? g : 'pendiente'));
    try {
      window.sessionStorage.setItem(claveLocal(slug), valor); // copia local inmediata
    } catch {
      /* ignorar */
    }
  }

  // Guarda poco después de dejar de escribir, y reintenta periódicamente si algo quedó pendiente.
  useEffect(() => {
    if (!sucio.current) return;
    const t = setTimeout(guardarAhora, AUTOGUARDADO_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [texto, guardarAhora]);
  useEffect(() => {
    const t = setInterval(guardarAhora, REINTENTO_MS);
    return () => clearInterval(t);
  }, [guardarAhora]);

  // ---------------------------------------------------------------- entrega
  const entregar = useCallback(
    async (automatica: boolean) => {
      if (terminando.current) return;
      // Con el tiempo cumplido y nada escrito no hay nada que entregar: el servidor cierra el intento solo.
      if (automatica && !textoRef.current.trim()) {
        terminar('vencido');
        return;
      }
      setEntregando(true);
      setErrorEntrega(null);
      try {
        const r = await enviarEntrega(slug, token, textoRef.current);
        terminar(r.aTiempo ? 'entregado' : 'vencido');
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          terminar('vencido');
        } else if (esDemasiadoGrande(e)) {
          if (automatica) {
            // Se terminó el tiempo: se entrega lo último que sí se alcanzó a guardar en el servidor.
            try {
              const r = await enviarEntrega(slug, token);
              terminar(r.aTiempo ? 'entregado' : 'vencido');
              return;
            } catch (e2) {
              if (e2 instanceof ApiError && (e2.status === 400 || e2.status === 409)) {
                terminar('vencido'); // no había nada guardado o ya se cerró
                return;
              }
              /* sin conexión: se reintenta en el próximo ciclo */
            }
          }
          setErrorEntrega(mensajeDelServidor(e) ?? 'Tu trabajo es demasiado largo para entregarlo. Acortalo y probá de nuevo.');
        } else {
          setErrorEntrega(
            automatica
              ? 'Se terminó el tiempo pero no hay conexión para entregar. No cierres la página: se reintenta solo.'
              : 'No se pudo entregar. Revisá tu conexión y probá de nuevo: tu trabajo sigue guardado.',
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
    const t = setInterval(() => setRestanteMs(vencimiento - (Date.now() + desfase.current)), 1000);
    return () => clearInterval(t);
  }, [vencimiento]);
  const seAcabo = restanteMs <= 0;
  useEffect(() => {
    if (!seAcabo) return;
    entregar(true);
    const t = setInterval(() => entregar(true), REINTENTO_MS); // si no había conexión, reintenta
    return () => clearInterval(t);
  }, [seAcabo, entregar]);

  // ---------------------------------------------------------------- modo seguro (solo registra; nunca bloquea ni baja nota)
  const cola = useRef<TipoEventoIntegridad[]>([]);
  const vaciando = useRef(false);
  const vaciarCola = useCallback(async () => {
    // Un solo ciclo a la vez: si entra un evento mientras se envía otro, el ciclo en curso lo
    // toma al seguir (con dos ciclos en paralelo se enviaría dos veces el mismo elemento).
    if (vaciando.current) return;
    vaciando.current = true;
    try {
      while (cola.current.length > 0 && !terminando.current) {
        try {
          await registrarEventoEntrega(slug, token, cola.current[0]);
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
    (tipo: TipoEventoIntegridad) => {
      cola.current.push(tipo);
      vaciarCola();
    },
    [vaciarCola],
  );
  useEffect(() => {
    if (!modoSeguro) return;
    const t = setInterval(vaciarCola, REINTENTO_MS);
    return () => clearInterval(t);
  }, [modoSeguro, vaciarCola]);

  useEffect(() => {
    if (!modoSeguro) return;
    // En un dispositivo que no permite pantalla completa (p. ej. iPhone) ese control no se puede cumplir:
    // ni se exige ni se registra (el alumno lo vio en el aviso antes de empezar).
    const pantallaCompleta = pantallaCompletaSoportada();
    let fuera = false; // un "salir" cuenta una sola vez aunque disparen blur y visibilitychange
    const salio = () => {
      if (fuera || terminando.current) return;
      fuera = true;
      reportar('cambio_pestana');
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
    const onPaste = () => reportar('pegado');
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
  }, [modoSeguro, reportar]);

  // Aviso del navegador al intentar cerrar/recargar con el trabajo abierto.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (terminando.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  const poco = restanteMs < 5 * 60_000;

  const etiquetaGuardado =
    guardado === 'guardando'
      ? 'Guardando…'
      : guardado === 'pendiente'
        ? 'Cambios sin guardar…'
        : guardado === 'sin_conexion'
          ? 'Sin conexión: guardado en esta pestaña, reintentando…'
          : guardado === 'demasiado_grande'
            ? 'No se puede guardar: tu trabajo es demasiado largo. Acortalo (queda guardado en esta pestaña).'
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
        <strong data-testid="reloj" style={{ color: poco ? 'var(--color-danger, #b00020)' : undefined, fontVariantNumeric: 'tabular-nums' }}>
          {seAcabo ? 'Tiempo terminado' : `Tiempo restante ${formatearRestante(restanteMs)}`}
        </strong>
      </div>

      {fueraDePantalla && modoSeguro && !seAcabo && (
        <div className="error-box" role="alert" style={{ marginBottom: 16 }}>
          Este trabajo se entrega en pantalla completa.{' '}
          <button type="button" className="btn btn-primary" onClick={entrarPantallaCompleta}>
            Volver a pantalla completa
          </button>{' '}
          <span className="muted">El tiempo sigue corriendo.</span>
        </div>
      )}

      {errorEntrega && <div className="error-box">{errorEntrega}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          Consigna
        </div>
        <div style={{ whiteSpace: 'pre-wrap' }}>{consigna}</div>
      </div>

      <div className="field">
        <label htmlFor="trabajo">Tu trabajo</label>
        <textarea
          id="trabajo"
          value={texto}
          onChange={(e) => cambiarTexto(e.target.value)}
          disabled={seAcabo || entregando}
          style={{ minHeight: 360 }}
        />
      </div>

      {!confirmando ? (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" type="button" disabled={entregando || seAcabo || !texto.trim()} onClick={() => setConfirmando(true)}>
            Entregar trabajo
          </button>
          {!texto.trim() && <span className="muted">Escribí tu trabajo para poder entregarlo.</span>}
        </div>
      ) : (
        // Confirmación en la página (no un window.confirm): un diálogo del navegador le quita el foco a la
        // ventana y, con modo seguro, contaría como un cambio de pestaña.
        <div className="card">
          <strong>¿Entregar el trabajo?</strong>
          <p className="muted" style={{ margin: '6px 0 12px' }}>
            Después no vas a poder cambiarlo.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" type="button" disabled={entregando} onClick={() => entregar(false)}>
              {entregando ? 'Entregando…' : 'Sí, entregar'}
            </button>
            <button className="btn btn-secondary" type="button" disabled={entregando} onClick={() => setConfirmando(false)}>
              Seguir editando
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
