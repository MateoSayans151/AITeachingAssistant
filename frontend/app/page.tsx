'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TrabajoPractico, listTrabajosPracticos } from '@/lib/api';
import { useSesion } from '@/lib/auth';
import { supabase, supabaseConfigurado } from '@/lib/supabase';

export default function HomePage() {
  const router = useRouter();
  const { docente, cargando, error: errorSesion, recuperando } = useSesion();

  // El enlace del email de "olvidé mi contraseña" puede aterrizar acá (según las URLs permitidas en Supabase): se lo lleva a elegir la nueva.
  useEffect(() => {
    if (recuperando) router.replace('/restablecer');
  }, [recuperando, router]);
  const [trabajos, setTrabajos] = useState<TrabajoPractico[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!docente) return;
    listTrabajosPracticos()
      .then(setTrabajos)
      .catch((e) => setError(e.message));
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
        <p>Tus trabajos prácticos y el estado de corrección de cada uno.</p>
      </header>

      <div style={{ marginBottom: 24, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link href="/trabajos/nuevo" className="btn btn-primary">
          + Nuevo trabajo práctico
        </Link>
        <Link href="/cursos" className="btn btn-secondary">
          Ir a Cátedra (exámenes por curso)
        </Link>
      </div>

      {error && <div className="error-box">{error}</div>}

      {trabajos === null && !error && <p className="muted">Cargando…</p>}

      {trabajos?.length === 0 && (
        <div className="empty-state">
          Todavía no cargaste ningún trabajo práctico. Arrancá creando la consigna y la rúbrica.
        </div>
      )}

      {trabajos?.map((tp) => (
        <Link key={tp.id} href={`/trabajos/${tp.id}`} className="card card-link">
          <div className="card-title">{tp.titulo}</div>
          <div className="card-meta">
            {tp.materia ? `${tp.materia} · ` : ''}
            {tp.criterios.length} criterios de rúbrica · {tp._count?.entregas ?? 0} entregas
          </div>
        </Link>
      ))}
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

  function cambiarModo(m: Modo) {
    setModo(m);
    setError(null);
    setAviso(null);
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
        else if (!data.session) setAviso('Te enviamos un email para confirmar tu cuenta. Cuando lo confirmes, iniciá sesión.');
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
    <div className="page" style={{ maxWidth: 480 }}>
      <header className="page-header">
        <div className="eyebrow">AI Teaching Assistant</div>
        <h1>{modo === 'login' ? 'Iniciá sesión' : modo === 'registro' ? 'Creá tu cuenta' : 'Recuperá tu contraseña'}</h1>
      </header>

      {!supabaseConfigurado && (
        <div className="error-box">
          Falta configurar el login: definí NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en frontend/.env.local y reiniciá el front.
        </div>
      )}
      {errorSesion && <div className="error-box">{errorSesion}</div>}
      {error && <div className="error-box">{error}</div>}
      {aviso && <div className="card" style={{ marginBottom: 16 }}>{aviso}</div>}

      <form onSubmit={handleSubmit}>
        {modo === 'registro' && (
          <div className="field">
            <label htmlFor="nombre">Nombre</label>
            <input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
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
          </div>
        )}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" type="submit" disabled={loading || !supabaseConfigurado}>
            {loading ? 'Un momento…' : modo === 'login' ? 'Entrar' : modo === 'registro' ? 'Crear cuenta' : 'Enviar enlace'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => cambiarModo(modo === 'login' ? 'registro' : 'login')}>
            {modo === 'login' ? 'Crear una cuenta' : 'Ya tengo cuenta'}
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
