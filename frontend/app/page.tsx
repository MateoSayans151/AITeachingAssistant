'use client';

import { Cargando } from '@/app/components/Cargando';
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
        <Cargando variante="pagina" />
      </div>
    );
  }

  if (!docente) {
    return <IdentificacionDocente errorSesion={errorSesion} />;
  }

  // Cuántas respuestas esperan al docente en cada curso: se muestra en la card del curso para llegar directo a lo que hay que revisar.
  const porRevisarDelCurso = new Map<string, number>();
  for (const e of porRevisar) porRevisarDelCurso.set(e.cursoId, (porRevisarDelCurso.get(e.cursoId) ?? 0) + e.porRevisar);

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">Hola, {docente.nombre.split(' ')[0]}</div>
        <h1>Tus cursos</h1>
        <p>Entrá a un curso para armar exámenes, mandarles el link a tus alumnos y revisar sus respuestas.</p>
      </header>

      {porRevisar.length > 0 && (
        <section style={{ marginBottom: 'var(--space-8)' }} aria-labelledby="para-revisar">
          <h2 id="para-revisar" style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-3)' }}>
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

      {error && <div className="error-box">{error}</div>}

      {cursos === null && !error && <Cargando variante="cuadricula" />}

      {cursos && (
        <div className="cursos-grid">
          {cursos.map((curso) => {
            const pendientes = porRevisarDelCurso.get(curso.id) ?? 0;
            return (
              <Link key={curso.id} href={`/cursos/${curso.id}`} className="curso-card">
                <span className="curso-card-sigla" aria-hidden="true">
                  {siglaDe(curso.nombre)}
                </span>
                <span className="curso-card-cuerpo">
                  <span className="curso-card-nombre">{curso.nombre}</span>
                  <span className="curso-card-meta">
                    {curso.materia ? `${curso.materia} · ` : ''}
                    {plural(curso._count?.examenes ?? 0, 'examen', 'exámenes')} · {plural(curso._count?.comisiones ?? 0, 'comisión', 'comisiones')}
                    {(curso._count?.equipo ?? 1) > 1 && ` · ${curso._count?.equipo} docentes`}
                  </span>
                </span>
                {pendientes > 0 && <span className="curso-card-aviso">{plural(pendientes, 'para revisar', 'para revisar')}</span>}
              </Link>
            );
          })}
          <Link href="/cursos/nuevo" className="curso-card curso-card-nuevo">
            <span className="curso-card-mas" aria-hidden="true">
              +
            </span>
            <span className="curso-card-nombre">Nuevo curso</span>
            <span className="curso-card-meta">{cursos.length === 0 ? 'Empezá creando tu primer curso' : 'Sumá otra materia o comisión'}</span>
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * Las iniciales del curso para el recuadro de la card: si el nombre arranca con una sigla («TI - Prueba…», «QA-Redes») esa sigla; si no, la
 * inicial de las dos primeras palabras que importan («Redes de Datos» → «RD»); con una sola palabra, sus dos primeras letras.
 */
function siglaDe(nombre: string): string {
  const limpio = nombre.trim();
  const sigla = /^([\p{Lu}\p{N}]{2,3})(?![\p{L}\p{N}])/u.exec(limpio);
  if (sigla) return sigla[1];
  const palabras = limpio.split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p) && p.length > 2);
  const letras = palabras.length >= 2 ? palabras[0][0] + palabras[1][0] : (palabras[0] ?? limpio).slice(0, 2);
  return letras.toUpperCase();
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

      <h2 style={{ fontSize: 22, marginBottom: 16 }}>
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
          <p style={{ marginBottom: 12 }}>
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
