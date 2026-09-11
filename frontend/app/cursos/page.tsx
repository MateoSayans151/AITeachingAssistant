'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Curso, Docente, listCursos } from '@/lib/api';

export default function CursosPage() {
  const [docente, setDocente] = useState<Docente | null>(null);
  const [cursos, setCursos] = useState<Curso[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = window.localStorage.getItem('ata_docente');
    if (raw) setDocente(JSON.parse(raw));
  }, []);

  useEffect(() => {
    if (!docente) return;
    listCursos()
      .then(setCursos)
      .catch((e) => setError(e.message));
  }, [docente]);

  if (!docente) {
    return (
      <div className="page">
        <p className="muted">Identificate primero desde el inicio.</p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">Cátedra</div>
        <h1>Tus cursos</h1>
        <p>Cursos con sus comisiones y exámenes. Cada examen se publica a una o más comisiones.</p>
      </header>

      <div style={{ marginBottom: 24 }}>
        <Link href="/cursos/nuevo" className="btn btn-primary">
          + Nuevo curso
        </Link>
      </div>

      {error && <div className="error-box">{error}</div>}

      {cursos === null && !error && <p className="muted">Cargando…</p>}

      {cursos?.length === 0 && (
        <div className="empty-state">Todavía no cargaste ningún curso.</div>
      )}

      {cursos?.map((curso) => (
        <Link key={curso.id} href={`/cursos/${curso.id}`} className="card card-link">
          <div className="card-title">{curso.nombre}</div>
          <div className="card-meta">
            {curso.materia ? `${curso.materia} · ` : ''}
            {curso._count?.comisiones ?? 0} comisiones · {curso._count?.examenes ?? 0} exámenes
          </div>
        </Link>
      ))}
    </div>
  );
}
