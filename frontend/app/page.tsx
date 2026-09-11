'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Docente, TrabajoPractico, findOrCreateDocente, listTrabajosPracticos } from '@/lib/api';

const DOCENTE_STORAGE_KEY = 'ata_docente';

export default function HomePage() {
  const [docente, setDocente] = useState<Docente | null>(null);
  const [trabajos, setTrabajos] = useState<TrabajoPractico[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = window.localStorage.getItem(DOCENTE_STORAGE_KEY);
    if (raw) setDocente(JSON.parse(raw));
  }, []);

  useEffect(() => {
    if (!docente) return;
    listTrabajosPracticos()
      .then(setTrabajos)
      .catch((e) => setError(e.message));
  }, [docente]);

  if (!docente) {
    return <IdentificacionDocente onIdentificado={setDocente} />;
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

function IdentificacionDocente({ onIdentificado }: { onIdentificado: (d: Docente) => void }) {
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const docente = await findOrCreateDocente({ nombre, email });
      window.localStorage.setItem(DOCENTE_STORAGE_KEY, JSON.stringify(docente));
      onIdentificado(docente);
    } catch (err) {
      setError('No se pudo identificar al docente. ¿Está corriendo el backend?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 480 }}>
      <header className="page-header">
        <div className="eyebrow">AI Teaching Assistant</div>
        <h1>Identificate</h1>
        <p>
          MVP sin login real todavía — con tu nombre y email alcanza para asociar tus trabajos prácticos.
        </p>
      </header>

      {error && <div className="error-box">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="nombre">Nombre</label>
          <input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
