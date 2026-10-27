'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Curso, ExamenPorRevisar, listCursos, listExamenesPorRevisar } from '@/lib/api';
import { plural } from '@/lib/texto';
import { useSesion } from '@/lib/auth';
import { supabase, supabaseConfigurado } from '@/lib/supabase';

export default function HomePage() {
  const router = useRouter();
  const { docente, cargando, error: errorSesion, recuperando } = useSesion();

  // El enlace del email de "olvidé mi contraseña" puede aterrizar acá (según las URLs permitidas en Supabase): se lo lleva a elegir la nueva.
  useEffect(() => {
    if (recuperando) router.replace('/restablecer');
  }, [recuperando, router]);
  const [cursos, setCursos] = useState<Curso[] | null>(null);
  const [porRevisar, setPorRevisar] = useState<ExamenPorRevisar[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!docente) return;
    listCursos()
      .then(setCursos)
      .catch((e) => setError(e.message));
    // Si esto falla no se rompe la home: simplemente no se muestra el bloque "Para revisar".
    listExamenesPorRevisar()
      .then(setPorRevisar)
      .catch(() => setPorRevisar([]));
  }, [docente]);

  if (cargando) {
    return (
      <div className="page">
        <p className="muted">Cargando…</p>
      </div>
    );
  }

  if (!docente) {
    return <IdentificacionDocente errorSesion={errorSesion} />;
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">AI Teaching Assistant</div>
        <h1>Hola, {docente.nombre.split(' ')[0]}</h1>
        <p>Armá un examen, mandales el link a tus alumnos y revisá las respuestas desde acá.</p>
      </header>

      <div style={{ marginBottom: 32, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link href="/examenes/nuevo" className="btn btn-primary">
          + Nuevo examen
        </Link>
        <Link href="/cursos/nuevo" className="btn btn-secondary">
          + Nuevo curso
        </Link>
      </div>

      {porRevisar.length > 0 && (
        <section style={{ marginBottom: 32 }} aria-labelledby="para-revisar">
          <h2 id="para-revisar" style={{ fontSize: 22, marginBottom: 14 }}>
            Para revisar
          </h2>
          {porRevisar.map((examen) => (
            <Link key={examen.id} href={`/examenes/${examen.id}/respuestas`} className="card card-link">
              <div className="card-title">{examen.titulo}</div>
              <div className="card-meta">
                {examen.cursoNombre} ·{' '}
                {examen.porRevisar > 0 ? <strong>{plural(examen.porRevisar, 'respuesta para revisar', 'respuestas para revisar')}</strong> : 'la IA está corrigiendo'}
                {examen.porRevisar > 0 && examen.sinCorregir > 0 && ` · ${plural(examen.sinCorregir, 'se está corrigiendo', 'se están corrigiendo')}`}
              </div>
            </Link>
          ))}
        </section>
      )}

      <section>
        <h2 style={{ fontSize: 22, marginBottom: 14 }}>Tus cursos</h2>

        {error && <div className="error-box">{error}</div>}

        {cursos === null && !error && <p className="muted">Cargando…</p>}

        {cursos?.length === 0 && (
          <div className="empty-state">
            Creá tu primer curso o armá un examen: si no tenés curso, el asistente te deja crear uno.
          </div>
        )}

        {cursos?.map((curso) => (
          <Link key={curso.id} href={`/cursos/${curso.id}`} className="card card-link">
            <div className="card-title">{curso.nombre}</div>
            <div className="card-meta">
              {curso.materia ? `${curso.materia} · ` : ''}
              {plural(curso._count?.comisiones ?? 0, 'comisión', 'comisiones')} · {plural(curso._count?.examenes ?? 0, 'examen', 'exámenes')}
            </div>
          </Link>
        ))}
      </section>

      <hr className="hr" style={{ margin: '40px 0 24px' }} />

      {/* Flujo simple (sin cursos ni comisiones): queda a mano pero fuera del camino principal. */}
      <section>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          Trabajos prácticos
        </div>
        <p className="muted" style={{ marginBottom: 14, maxWidth: '62ch' }}>
          Para corregir entregas de una consigna con su rúbrica, sin armar curso ni comisiones.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link href="/trabajos" className="btn btn-secondary">
            Ver trabajos prácticos
          </Link>
          <Link href="/trabajos/nuevo" className="btn btn-secondary">
            + Nuevo trabajo práctico
          </Link>
        </div>
      </section>
    </div>
  );
}

type Modo = 'login' | 'registro' | 'recuperar';

// Mensajes de Supabase Auth → castellano para el docente.
function mensajeDeAuth(err: { message: string; status?: number }): string {
  const m = err.message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Email o contraseña incorrectos.';
  if (m.includes('email not confirmed')) return 'Todavía no confirmaste tu email: revisá tu bandeja de entrada (y el spam).';
  if (m.includes('already registered')) return 'Ya existe una cuenta con ese email. Iniciá sesión o recuperá tu contraseña.';
  if (err.status === 429 || m.includes('rate limit') || m.includes('too many')) return 'Demasiados intentos o emails enviados. Esperá un rato y probá de nuevo.';
  if (m.includes('password') && m.includes('characters')) return 'La contraseña es demasiado corta (mínimo 8 caracteres).';
  return err.message;
}

function IdentificacionDocente({ errorSesion }: { errorSesion: string | null }) {
  const [modo, setModo] = useState<Modo>('login');
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Email al que se mandó el link de confirmación tras registrarse: mientras tenga valor se muestra "Revisá tu mail" en vez del formulario.
  const [confirmarEn, setConfirmarEn] = useState<string | null>(null);
  const [reenviado, setReenviado] = useState(false);

  function cambiarModo(m: Modo) {
    setModo(m);
    setError(null);
    setAviso(null);
    setConfirmarEn(null);
    setReenviado(false);
  }

  async function reenviarConfirmacion() {
    if (!confirmarEn) return;
    setLoading(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.resend({ type: 'signup', email: confirmarEn, options: { emailRedirectTo: window.location.origin } });
      if (err) setError(mensajeDeAuth(err));
      else setReenviado(true);
    } catch {
      setError('No se pudo conectar con el servicio de cuentas. Revisá tu conexión y probá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setAviso(null);
    try {
      if (modo === 'login') {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) setError(mensajeDeAuth(err));
        // Si entró, la sesión se actualiza sola (useSesion) y esta pantalla desaparece.
      } else if (modo === 'registro') {
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { nombre: nombre.trim() }, emailRedirectTo: window.location.origin },
        });
        if (err) setError(mensajeDeAuth(err));
        else if (data.user && data.user.identities?.length === 0) setError('Ya existe una cuenta con ese email. Iniciá sesión o recuperá tu contraseña.');
        else if (!data.session) setConfirmarEn(email.trim());
      } else {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/restablecer` });
        if (err) setError(mensajeDeAuth(err));
        else setAviso('Si ese email tiene una cuenta, te enviamos un enlace para restablecer la contraseña.');
      }
    } catch {
      setError('No se pudo conectar con el servicio de cuentas. Revisá tu conexión y probá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <header className="page-header">
        <div className="eyebrow">AI Teaching Assistant</div>
        <h1>Armá el examen, la IA lo corrige, vos decidís la nota</h1>
        <p>Para docentes que quieren corregir menos a mano y no perder el control de lo que le llega a cada alumno.</p>
      </header>

      <ol className="pasos-inicio">
        <li>
          <strong>Armá tu examen.</strong> Preguntas de opción múltiple, verdadero/falso o de desarrollo, en pocos minutos.
        </li>
        <li>
          <strong>Mandá el link.</strong> Tus alumnos lo rinden desde el celular o la compu, con su mail.
        </li>
        <li>
          <strong>Revisá y publicá.</strong> La IA sugiere una nota y un comentario; vos los aceptás o los cambiás. Nada le llega al alumno sin tu visto bueno.
        </li>
      </ol>

      <h2 style={{ fontSize: 22, marginBottom: 14 }}>
        {confirmarEn ? 'Revisá tu mail' : modo === 'login' ? 'Entrá a tu cuenta' : modo === 'registro' ? 'Creá tu cuenta' : 'Recuperá tu contraseña'}
      </h2>

      {!supabaseConfigurado && (
        <div className="error-box">
          Falta configurar el login: definí NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en frontend/.env.local y reiniciá el front.
        </div>
      )}
      {errorSesion && <div className="error-box">{errorSesion}</div>}
      {error && <div className="error-box">{error}</div>}
      {aviso && <div className="card" style={{ marginBottom: 16 }}>{aviso}</div>}

      {confirmarEn && (
        <div className="card">
          <p style={{ marginBottom: 10 }}>
            Te mandamos un mail a <strong>{confirmarEn}</strong>. Abrí el link que trae para confirmar tu cuenta: te lleva directo a la app.
          </p>
          <p className="muted" style={{ marginBottom: 16 }}>
            Si no lo ves en unos minutos, mirá en la carpeta de spam o correo no deseado.
          </p>
          {reenviado && (
            <p role="status" style={{ marginBottom: 12, color: 'var(--color-success)' }}>
              Listo, te lo mandamos de nuevo.
            </p>
          )}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" onClick={reenviarConfirmacion} disabled={loading}>
              {loading ? 'Un momento…' : 'Mandame el mail de nuevo'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => cambiarModo('login')}>
              Ya confirmé: entrar
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} hidden={Boolean(confirmarEn)}>
        {modo === 'registro' && (
          <div className="field">
            <label htmlFor="nombre">Nombre y apellido</label>
            <input id="nombre" value={nombre} autoComplete="name" placeholder="Ej: Laura Fernández" onChange={(e) => setNombre(e.target.value)} required />
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            autoComplete="email"
            placeholder="tu@mail.com"
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        {modo !== 'recuperar' && (
          <div className="field">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              type="password"
              minLength={modo === 'registro' ? 8 : undefined}
              autoComplete={modo === 'registro' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {modo === 'registro' && (
              <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Mínimo 8 caracteres.
              </p>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" type="submit" disabled={loading || !supabaseConfigurado}>
            {loading ? 'Un momento…' : modo === 'login' ? 'Entrar' : modo === 'registro' ? 'Crear cuenta' : 'Enviar enlace'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => cambiarModo(modo === 'login' ? 'registro' : 'login')}>
            {modo === 'login' ? 'Soy nuevo: crear cuenta' : 'Ya tengo cuenta'}
          </button>
        </div>
        {modo === 'login' && (
          <p style={{ marginTop: 16 }}>
            <button
              type="button"
              onClick={() => cambiarModo('recuperar')}
              style={{ background: 'none', border: 0, padding: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
            >
              Olvidé mi contraseña
            </button>
          </p>
        )}
      </form>
    </div>
  );
}
