'use client';

// Página pública para que el alumno entregue un trabajo práctico por link.
//   1. Ve los datos generales (sin la consigna) y, si hay modo seguro, QUÉ se monitorea.
//   2. Pone su nombre y su email y acepta el aviso: recién ahí el servidor arranca su reloj y
//      le entrega la consigna.
//   3. Escribe con autoguardado (ver TrabajoEnCurso). Si recarga la página retoma donde estaba
//      y con el mismo vencimiento: cerrar la pestaña no da más tiempo.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ApiError, EstadoIntentoEntregar, InfoEntregar, getInfoEntregar, getIntentoEntrega, iniciarEntrega } from '@/lib/api';
import { entrarPantallaCompleta, pantallaCompletaSoportada, salirDePantallaCompleta } from '@/lib/pantalla-completa';
import TrabajoEnCurso from './TrabajoEnCurso';

const claveToken = (slug: string) => `ata_entrega_${slug}`;

type Sesion = { token: string; estado: EstadoIntentoEntregar };

function mensajeDeError(err: unknown): string {
  if (err instanceof ApiError) {
    try {
      const m = JSON.parse(err.body)?.message;
      if (typeof m === 'string') return m;
      if (Array.isArray(m)) return 'Revisá los datos ingresados (nombre y email).';
    } catch {
      /* cuerpo no JSON */
    }
  }
  return 'No se pudo conectar. Revisá tu conexión y probá de nuevo.';
}

const formatearFecha = (iso: string) => new Date(iso).toLocaleString('es-AR', { dateStyle: 'long', timeStyle: 'short' });

export default function EntregarTrabajoPage() {
  // null hasta montar: el soporte se consulta en el navegador (no en el render del servidor).
  const [pantallaCompletaOk, setPantallaCompletaOk] = useState<boolean | null>(null);
  useEffect(() => setPantallaCompletaOk(pantallaCompletaSoportada()), []);
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [info, setInfo] = useState<InfoEntregar | null>(null);
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [terminado, setTerminado] = useState<null | 'entregado' | 'vencido'>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  // Formulario de identificación. Los errores de envío NO reemplazan la página: el alumno
  // tiene que poder corregir el email sin perder nada.
  const [alumnoNombre, setAlumnoNombre] = useState('');
  const [alumnoEmail, setAlumnoEmail] = useState('');
  const [consentimiento, setConsentimiento] = useState(false);
  const [iniciando, setIniciando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const i = await getInfoEntregar(slug);
        if (!vivo) return;
        setInfo(i);
        // ¿Había un intento en curso en esta pestaña? Se retoma sin volver a identificarse.
        const token = window.sessionStorage.getItem(claveToken(slug));
        if (token) {
          try {
            const estado = await getIntentoEntrega(slug, token);
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
    const quierePantallaCompleta = info.trabajo.modoSeguro && pantallaCompletaSoportada();
    if (quierePantallaCompleta) entrarPantallaCompleta();

    try {
      const r = await iniciarEntrega(slug, {
        alumnoNombre: alumnoNombre.trim(),
        alumnoEmail: alumnoEmail.trim(),
        consentimiento: info.trabajo.modoSeguro ? consentimiento : undefined,
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
        <div className="error-box">{loadError ?? 'No se pudo cargar el trabajo práctico.'}</div>
      </div>
    );
  }

  if (terminado) {
    return (
      <div className="page" style={{ maxWidth: 640 }}>
        <div className="card">
          <div className="card-title" style={{ marginBottom: 8 }}>
            {terminado === 'entregado' ? '¡Listo!' : 'Se terminó el tiempo'}
          </div>
          <p className="muted">
            {terminado === 'entregado'
              ? 'Tu trabajo se envió correctamente. Tu docente te va a avisar cuando esté el feedback.'
              : 'Se entregó automáticamente lo que alcanzaste a completar. Tu docente te va a avisar cuando esté el feedback.'}
          </p>
        </div>
      </div>
    );
  }

  if (sesion) {
    return <TrabajoEnCurso slug={slug} token={sesion.token} inicial={sesion.estado} titulo={info.trabajo.titulo} alTerminar={alTerminar} />;
  }

  const { trabajo, ventana } = info;
  const cerrada = ventana.estado === 'cerrada';
  const noAbierta = ventana.estado === 'no_abierta';

  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <header className="page-header">
        <div className="eyebrow">{trabajo.materia ?? 'Trabajo práctico'}</div>
        <h1>{trabajo.titulo}</h1>
      </header>

      {cerrada && <div className="error-box">La entrega de este trabajo práctico ya cerró.</div>}
      {noAbierta && (
        <div className="error-box">
          Este trabajo práctico todavía no está abierto{ventana.fechaInicio ? `: se habilita el ${formatearFecha(ventana.fechaInicio)}` : ''}.
        </div>
      )}

      {!cerrada && !noAbierta && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            {trabajo.duracionMinutos ? (
              <>
                <strong>Tenés {trabajo.duracionMinutos} minutos.</strong>
                <p className="muted" style={{ marginTop: 6 }}>
                  El tiempo empieza a correr cuando tocás “Comenzar” y no se detiene aunque cierres la pestaña. Lo que escribas se
                  guarda solo; si se termina el tiempo, se entrega lo último guardado.
                </p>
              </>
            ) : (
              <>
                <strong>Podés entregar hasta el {ventana.fechaFin ? formatearFecha(ventana.fechaFin) : 'vencimiento'}.</strong>
                <p className="muted" style={{ marginTop: 6 }}>
                  Lo que escribas se guarda solo; si llega el vencimiento, se entrega lo último guardado. La consigna aparece cuando
                  ingresás.
                </p>
              </>
            )}
          </div>

          {trabajo.modoSeguro && (
            <div className="card" style={{ marginBottom: 16 }} role="region" aria-label="Qué se monitorea durante la entrega">
              <div className="card-title" style={{ marginBottom: 8 }}>
                Qué se monitorea durante la entrega
              </div>
              <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
                {pantallaCompletaOk !== false && <li>Se escribe en pantalla completa: se registra cada vez que salís de ella.</li>}
                {pantallaCompletaOk === false && (
                  <li>
                    Se pide pantalla completa, pero tu dispositivo o navegador no la permite (por ejemplo, un iPhone): en tu caso ese
                    control no se aplica.
                  </li>
                )}
                <li>Se registra cada vez que cambiás de pestaña o de ventana.</li>
                <li>Se registra cuando pegás texto en tu respuesta.</li>
              </ul>
              <p className="muted" style={{ marginBottom: 12 }}>
                No se graba tu pantalla, tu cámara ni lo que escribís fuera de esta página. Estos registros se le muestran a tu docente
                como información adicional: no bajan tu nota automáticamente.
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
              <label htmlFor="nombre">Tu nombre y apellido</label>
              <input id="nombre" value={alumnoNombre} onChange={(e) => setAlumnoNombre(e.target.value)} maxLength={120} required />
            </div>
            <div className="field">
              <label htmlFor="email">Tu email</label>
              <input id="email" type="email" value={alumnoEmail} onChange={(e) => setAlumnoEmail(e.target.value)} required />
            </div>
            <button className="btn btn-primary" type="submit" disabled={iniciando || (trabajo.modoSeguro && !consentimiento)}>
              {iniciando ? 'Ingresando…' : trabajo.duracionMinutos ? 'Comenzar' : 'Ingresar'}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
