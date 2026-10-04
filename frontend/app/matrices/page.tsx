'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MatrizRubrica, listMatricesRubrica } from '@/lib/api';
import { useDocente } from '@/lib/auth';

export default function MatricesPage() {
  const docente = useDocente();
  const [matrices, setMatrices] = useState<MatrizRubrica[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!docente) return;
    listMatricesRubrica()
      .then(setMatrices)
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
        <h1>Matrices de rúbrica</h1>
        <p>Librería reutilizable: al crear una pregunta abierta en un examen podés partir de una de estas matrices.</p>
      </header>

      <div style={{ marginBottom: 24 }}>
        <Link href="/matrices/nueva" className="btn btn-primary">
          + Nueva matriz
        </Link>
      </div>

      {error && <div className="error-box">{error}</div>}
      {matrices === null && !error && <p className="muted">Cargando…</p>}
      {matrices?.length === 0 && <div className="empty-state">Todavía no cargaste ninguna matriz.</div>}

      {matrices?.map((m) => (
        <div key={m.id} className="card">
          <div className="card-title">{m.nombre}</div>
          <div className="card-meta">{m.criterios.length} criterios</div>
        </div>
      ))}
    </div>
  );
}
