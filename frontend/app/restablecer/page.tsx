'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { terminarRecuperacion, useSesion } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

// Destino del enlace del email de "olvidé mi contraseña". Supabase arma una sesión temporal con el enlace
// (evento PASSWORD_RECOVERY); con esa sesión el docente elige la contraseña nueva.
export default function RestablecerPasswordPage() {
  const { recuperando } = useSesion();
  const [esperando, setEsperando] = useState(true);
  const [password, setPassword] = useState('');
  const [repetida, setRepetida] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState(false);

  // Dar un momento a que supabase-js procese el enlace antes de decir que no sirve.
  useEffect(() => {
    const t = setTimeout(() => setEsperando(false), 3000);
    return () => clearTimeout(t);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== repetida) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) {
        setError(err.message.toLowerCase().includes('same') ? 'La contraseña nueva tiene que ser distinta de la anterior.' : err.message);
        return;
      }
      setHecho(true);
      await terminarRecuperacion();
    } catch {
      setError('No se pudo conectar con el servicio de cuentas. Probá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 480 }}>
      <header className="page-header">
        <div className="eyebrow">AI Teaching Assistant</div>
        <h1>Nueva contraseña</h1>
      </header>

      {hecho ? (
        <div className="card">
          <p>Listo, tu contraseña se actualizó.</p>
          <p style={{ marginTop: 12 }}>
            <Link href="/" className="btn btn-primary">
              Ir al inicio
            </Link>
          </p>
        </div>
      ) : recuperando ? (
        <form onSubmit={handleSubmit}>
          {error && <div className="error-box">{error}</div>}
          <div className="field">
            <label htmlFor="password">Contraseña nueva</label>
            <input id="password" type="password" minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="repetida">Repetila</label>
            <input id="repetida" type="password" minLength={8} autoComplete="new-password" value={repetida} onChange={(e) => setRepetida(e.target.value)} required />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Guardando…' : 'Guardar contraseña'}
          </button>
        </form>
      ) : esperando ? (
        <p className="muted">Verificando el enlace…</p>
      ) : (
        <div className="card">
          <p>Este enlace venció o ya se usó. Pedí uno nuevo desde “Olvidé mi contraseña”.</p>
          <p style={{ marginTop: 12 }}>
            <Link href="/" className="btn btn-secondary">
              Volver al inicio
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
