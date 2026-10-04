'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  ExamenConPendientes,
  FeedbackModo,
  ResumenNotificaciones,
  getResumenNotificaciones,
  liberarFeedback,
  listRespuestasPorExamen,
  reenviarNotificaciones,
} from '@/lib/api';

const formatearFecha = (iso: string) => new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

// Mientras haya mails saliendo se refresca el resumen solo, pero no para siempre: a los 2 minutos se frena (para
// ver cómo sigue, se vuelve a entrar o se toca "Reenviar").
const INTERVALO_SONDEO_MS = 5_000;
const TOPE_SONDEO_MS = 2 * 60_000;

/** Hay mails por salir o saliendo: lo único que justifica seguir refrescando. */
const hayEnvios = (r: ResumenNotificaciones) => r.configurado && (r.enCurso > 0 || r.sinEnviar > 0);

/** El backend responde los errores como JSON `{ message }`: si vino un motivo claro (ej. el 409 por falta de configuración) se muestra. */
function mensajeDe(err: unknown, porDefecto: string): string {
  if (err instanceof ApiError && err.status === 409) {
    try {
      const { message } = JSON.parse(err.body) as { message?: unknown };
      if (typeof message === 'string' && message) return message;
    } catch {
      /* el cuerpo no era JSON: sale el mensaje de siempre */
    }
  }
  return porDefecto;
}

// Publicar las notas de un examen (feedback "manual"): cada alumno con el examen ya revisado recibe por mail su nota y su
// feedback; el resto, apenas el docente revise el suyo. Es autocontenido: la página solo pasa el estado actual y se
// entera del cambio por onChange. Publicar no se puede retirar, por eso pide confirmación. También muestra cómo va el
// envío (enviados / con error / sin enviar) y deja reintentar a los que faltan. `revisadas` es cuántas respuestas están
// revisadas: cuando cambia, se vuelve a pedir el resumen (en feedback inmediato, revisar dispara un mail).
export function LiberarNotasButton({
  examenId,
  feedbackModo,
  liberadoEn,
  revisadas,
  onChange,
}: {
  examenId: string;
  feedbackModo: FeedbackModo;
  liberadoEn: string | null;
  revisadas?: number;
  onChange: (examen: ExamenConPendientes) => void;
}) {
  const [publicadoEn, setPublicadoEn] = useState<string | null>(null);
  const [sinRevisar, setSinRevisar] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumen, setResumen] = useState<ResumenNotificaciones | null>(null);
  const [reenviando, setReenviando] = useState(false);
  const [errorReenvio, setErrorReenvio] = useState<string | null>(null);
  // Hasta cuándo seguir refrescando el resumen (0 = no se está siguiendo nada).
  const [seguirHasta, setSeguirHasta] = useState(0);

  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const refrescar = useCallback(async () => {
    try {
      const r = await getResumenNotificaciones(examenId);
      if (montado.current) setResumen(r);
      return r;
    } catch {
      return null; // sin resumen se sigue mostrando lo de siempre; el servidor igual valida al publicar
    }
  }, [examenId]);

  // Al entrar (y cada vez que cambian las revisadas) se pide el resumen; si ya hay mails saliendo, se los sigue.
  useEffect(() => {
    let cancelado = false;
    void refrescar().then((r) => {
      if (!cancelado && r && hayEnvios(r)) setSeguirHasta(Date.now() + TOPE_SONDEO_MS);
    });
    return () => {
      cancelado = true;
    };
  }, [refrescar, revisadas]);

  useEffect(() => {
    if (!seguirHasta) return;
    const timer = setInterval(async () => {
      const r = await refrescar();
      if (Date.now() >= seguirHasta || (r && !hayEnvios(r))) {
        clearInterval(timer);
        if (montado.current) setSeguirHasta(0);
      }
    }, INTERVALO_SONDEO_MS);
    return () => clearInterval(timer);
  }, [seguirHasta, refrescar]);

  const seguirEnvios = () => {
    setSeguirHasta(Date.now() + TOPE_SONDEO_MS);
    void refrescar();
  };

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      // Antes de confirmar se cuenta a quiénes les llega el mail ya y cuántos exámenes siguen sin revisar.
      let aviso = '';
      try {
        const respuestas = await listRespuestasPorExamen(examenId);
        const pendientes = respuestas.filter((r) => r.estadoRevision === 'pendiente').length;
        const revisadasAhora = respuestas.length - pendientes;
        aviso =
          (revisadasAhora > 0
            ? `Se van a enviar por mail las notas de ${revisadasAhora} alumno(s) con el examen revisado. `
            : 'Todavía no revisaste ninguna respuesta: por ahora no se envía ningún mail. ') +
          (pendientes > 0
            ? `Hay ${pendientes} respuesta(s) sin revisar: esos alumnos reciben su mail apenas las revises. `
            : '');
      } catch {
        /* si no se pudo contar, se confirma igual sin ese detalle */
      }
      if (resumen?.modoPrueba) {
        aviso += `Estás en modo prueba: los mails llegan a ${resumen.modoPrueba}, no a los alumnos. `;
      }
      if (!window.confirm(`${aviso}Las notas publicadas no se pueden retirar. ¿Publicarlas y enviarlas por mail?`)) return;

      const examen = await liberarFeedback(examenId);
      setPublicadoEn(examen.feedbackLiberadoEn);
      setSinRevisar(examen.pendientesDeRevision);
      onChange(examen);
      seguirEnvios();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudieron publicar las notas. Probá de nuevo.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleReenviar() {
    setReenviando(true);
    setErrorReenvio(null);
    try {
      await reenviarNotificaciones(examenId);
      seguirEnvios();
    } catch (err) {
      setErrorReenvio(mensajeDe(err, 'No se pudo reenviar. Probá de nuevo.'));
    } finally {
      setReenviando(false);
    }
  }

  const sinMail = resumen !== null && !resumen.configurado;
  const fecha = publicadoEn ?? liberadoEn;

  const avisos = (
    <>
      {sinMail && (
        <div className="error-box" role="alert">
          El servidor todavía no tiene configurado el envío de mails (faltan <code>RESEND_API_KEY</code> y <code>EMAIL_FROM</code>), así que los
          alumnos no pueden recibir su nota. Configuralo en el backend y recargá esta página.
        </div>
      )}
      {resumen?.modoPrueba && (
        <p role="status" style={{ marginBottom: 12 }}>
          <span className="badge badge-pendiente" style={{ marginRight: 8 }}>
            Modo prueba
          </span>
          Los mails llegan a <strong>{resumen.modoPrueba}</strong>, no a los alumnos.
        </p>
      )}
    </>
  );

  const envios = resumen && resumen.configurado && (
    <div role="status" style={{ marginTop: 12 }}>
      <strong>
        {resumen.enviados} {resumen.enviados === 1 ? 'enviado' : 'enviados'} · {resumen.conError} con error · {resumen.sinEnviar} sin enviar
      </strong>
      {resumen.enCurso > 0 && <span className="muted"> · enviando…</span>}
      {resumen.conError > 0 && resumen.ultimoError && (
        <div className="error-box" style={{ marginTop: 8 }}>
          Último error: {resumen.ultimoError}
        </div>
      )}
      {resumen.conError + resumen.sinEnviar > 0 && (
        <div style={{ marginTop: 8 }}>
          <button className="btn btn-secondary" onClick={handleReenviar} disabled={reenviando || resumen.enCurso > 0}>
            {reenviando || resumen.enCurso > 0 ? 'Enviando…' : 'Reenviar a los que faltan'}
          </button>
        </div>
      )}
      {errorReenvio && (
        <div className="error-box" style={{ marginTop: 8 }}>
          {errorReenvio}
        </div>
      )}
    </div>
  );

  if (feedbackModo === 'inmediato') {
    return (
      <div>
        {avisos}
        <p className="muted">
          Este examen es de feedback inmediato: cada alumno recibe su nota y su feedback por mail apenas revisás su examen. No hace falta
          publicar las notas.
        </p>
        {envios}
      </div>
    );
  }

  if (fecha) {
    const faltanRevisar = resumen?.sinRevisar ?? sinRevisar;
    return (
      <div>
        {avisos}
        <div role="status">
          <strong>Notas publicadas el {formatearFecha(fecha)}</strong>
          <p className="muted" style={{ marginTop: 6 }}>
            Cada alumno recibe su nota por mail apenas revisás su examen
            {faltanRevisar ? `: todavía te quedan ${faltanRevisar} respuesta(s) sin revisar` : ''}.
          </p>
        </div>
        {envios}
      </div>
    );
  }

  return (
    <div>
      {avisos}
      <button
        className="btn btn-primary"
        onClick={handleClick}
        disabled={loading || sinMail}
        title={sinMail ? 'Primero hay que configurar el envío de mails en el servidor.' : undefined}
      >
        {loading ? 'Publicando…' : 'Publicar notas y enviarlas por mail'}
      </button>
      {error && (
        <div className="error-box" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}
