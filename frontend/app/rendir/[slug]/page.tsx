'use client';

// Página pública para que el alumno rinda un examen por link.
//   1. Ve los datos generales (sin preguntas) y, si el examen tiene anti-cheat, QUÉ se monitorea.
//   2. Se identifica con su email y acepta el aviso: recién ahí el servidor
//      arranca su reloj y le entrega las preguntas.
//   3. Rinde con autoguardado (ver ExamenEnCurso). Si recarga la página retoma donde estaba
//      y con el mismo vencimiento: cerrar la pestaña no da más tiempo.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ApiError, EstadoIntentoRendir, InfoRendir, getInfoRendir, getIntento, iniciarIntento } from '@/lib/api';
import { entrarPantallaCompleta, pantallaCompletaSoportada, salirDePantallaCompleta } from '@/lib/pantalla-completa';
import ExamenEnCurso from './ExamenEnCurso';

const claveToken = (slug: string) => `ata_intento_${slug}`;

type Sesion = { token: string; estado: EstadoIntentoRendir };

function mensajeDeError(err: unknown): string {
  if (err instanceof ApiError) {
    try {
      const m = JSON.parse(err.body)?.message;
      if (typeof m === 'string') return m;
      if (Array.isArray(m)) return 'Revisá los datos ingresados.';
    } catch {
      /* cuerpo no JSON */
    }
    if (err.status === 429) return 'Demasiados intentos fallidos. Esperá unos minutos y probá de nuevo.';
  }
  return 'No se pudo conectar. Revisá tu conexión y probá de nuevo.';
}

export default function RendirExamenPage() {
  // null hasta montar: el soporte se consulta en el navegador (no en el render del servidor).
  const [pantallaCompletaOk, setPantallaCompletaOk] = useState<boolean | null>(null);
  useEffect(() => setPantallaCompletaOk(pantallaCompletaSoportada()), []);
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [info, setInfo] = useState<InfoRendir | null>(null);
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [terminado, setTerminado] = useState<null | 'entregado' | 'vencido'>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  // Formulario de identificación. Los errores de envío NO reemplazan la página: el alumno
  // tiene que poder corregir el email sin perder nada.
  const [alumnoEmail, setAlumnoEmail] = useState('');
  const [consentimiento, setConsentimiento] = useState(false);
  const [iniciando, setIniciando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const i = await getInfoRendir(slug);
        if (!vivo) return;
        setInfo(i);
        // ¿Había un intento en curso en esta pestaña? Se retoma sin volver a identificarse.
        const token = window.sessionStorage.getItem(claveToken(slug));
        if (token) {
          try {
            const estado = await getIntento(slug, token);
            if (vivo) setSesion({ token, estado });
          } catch (e) {
            window.sessionStorage.removeItem(claveToken(slug));
            if (vivo && e instanceof ApiError && e.status === 409) setTerminado('vencido');
          }
        }
      } catch (e) {
        if (vivo) setLoadError(e instanceof ApiError && e.status === 404 ? 'Este link no es válido.' : mensajeDeError(e));
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [slug]);

  async function handleComenzar(e: React.FormEvent) {
    e.preventDefault();
    if (!info) return;
    setIniciando(true);
    setError(null);

    // El navegador solo permite pasar a pantalla completa como respuesta a un click, así que se
    // pide acá (antes de esperar al servidor) y se revierte si la identificación falla.
    const quierePantallaCompleta = info.examen.antiCheat?.pantallaCompleta;
    if (quierePantallaCompleta && pantallaCompletaSoportada()) entrarPantallaCompleta();

    try {
      const r = await iniciarIntento(slug, {
        alumnoEmail: alumnoEmail.trim(),
        consentimiento: info.examen.antiCheat ? consentimiento : undefined,
      });
      window.sessionStorage.setItem(claveToken(slug), r.token);
      const { token, ...estado } = r;
      setSesion({ token, estado });
    } catch (err) {
      if (quierePantallaCompleta) salirDePantallaCompleta();
      setError(mensajeDeError(err));
    } finally {
      setIniciando(false);
    }
  }

  function alTerminar(como: 'entregado' | 'vencido') {
    window.sessionStorage.removeItem(claveToken(slug));
    salirDePantallaCompleta();
    setSesion(null);
    setTerminado(como);
  }

  if (cargando) {
    return (
      <div className="page">
        <p className="muted">Cargando…</p>
      </div>
    );
  }

  if (loadError || !info) {
    return (
      <div className="page">
        <div className="error-box">{loadError ?? 'No se pudo cargar el examen.'}</div>
      </div>
    );
  }

  if (terminado) {
    return (
      <div className="page">
        <div className="card">
          <div className="card-title" style={{ marginBottom: 8 }}>
            {terminado === 'entregado' ? '¡Listo!' : 'Se terminó el tiempo'}
          </div>
          <p className="muted">
            {terminado === 'entregado'
              ? 'Tu respuesta se envió correctamente. Tu docente te va a avisar cuando esté el feedback.'
              : 'Se entregó automáticamente lo que alcanzaste a completar. Tu docente te va a avisar cuando esté el feedback.'}
          </p>
        </div>
      </div>
    );
  }

  if (sesion) {
    return <ExamenEnCurso slug={slug} token={sesion.token} inicial={sesion.estado} titulo={info.examen.titulo} alTerminar={alTerminar} />;
  }

  const { examen, comision, ventana } = info;
  const cfg = examen.antiCheat;
  const cerrada = ventana.estado === 'cerrada';
  const noAbierta = ventana.estado === 'no_abierta';
  const cuandoAbre = ventana.fechaInicio ? new Date(ventana.fechaInicio).toLocaleString('es-AR') : null;

  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <header className="page-header">
        <div className="eyebrow">{comision.nombre}</div>
        <h1>{examen.titulo}</h1>
        <p>{examen.consigna}</p>
      </header>

      {cerrada && <div className="error-box">La ventana de entrega de este examen ya cerró.</div>}
      {noAbierta && <div className="error-box">Este examen todavía no está abierto{cuandoAbre ? `: se habilita el ${cuandoAbre}` : ''}.</div>}

      {!cerrada && !noAbierta && (
        <>
          {examen.duracionMinutos && (
            <div className="card" style={{ marginBottom: 16 }}>
              <strong>Tenés {examen.duracionMinutos} minutos.</strong>
              <p className="muted" style={{ marginTop: 6 }}>
                El tiempo empieza a correr cuando tocás “Comenzar” y no se detiene aunque cierres la pestaña. Lo que escribas se guarda
                solo; si se termina el tiempo, se entrega lo último guardado.
              </p>
            </div>
          )}

          {cfg && (
            <div className="card" style={{ marginBottom: 16 }} role="region" aria-label="Qué se monitorea durante este examen">
              <div className="card-title" style={{ marginBottom: 8 }}>
                Qué se monitorea durante este examen
              </div>
              <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
                {cfg.pantallaCompleta && pantallaCompletaOk !== false && (
                  <li>El examen se rinde en pantalla completa: se registra cada vez que salís de ella.</li>
                )}
                {cfg.pantallaCompleta && pantallaCompletaOk === false && (
                  <li>
                    Este examen pide pantalla completa, pero tu dispositivo o navegador no la permite (por ejemplo, un iPhone): en tu caso
                    ese control no se aplica.
                  </li>
                )}
                {cfg.cambioPestana && <li>Se registra cada vez que cambiás de pestaña o de ventana.</li>}
                {cfg.pegado && <li>Se registra cuando pegás texto en una respuesta.</li>}
              </ul>
              <p className="muted" style={{ marginBottom: 12 }}>
                No se graba tu pantalla, tu cámara ni lo que escribís fuera del examen. Estos registros se le muestran a tu docente como
                información adicional: no bajan tu nota automáticamente.
              </p>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <input type="checkbox" checked={consentimiento} onChange={(e) => setConsentimiento(e.target.checked)} style={{ marginTop: 4 }} />
                <span>Leí el aviso y entiendo qué se monitorea.</span>
              </label>
            </div>
          )}

          {error && <div className="error-box">{error}</div>}

          <form onSubmit={handleComenzar}>
            <div className="field">
              <label htmlFor="email">Tu email (el mismo con el que estás en el listado de la comisión)</label>
              <input id="email" type="email" value={alumnoEmail} onChange={(e) => setAlumnoEmail(e.target.value)} required />
            </div>
            <button className="btn btn-primary" type="submit" disabled={iniciando || (!!cfg && !consentimiento)}>
              {iniciando ? 'Ingresando…' : examen.duracionMinutos ? 'Comenzar examen' : 'Ingresar'}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
