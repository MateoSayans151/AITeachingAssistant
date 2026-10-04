'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MatrizRubrica, listMatricesRubrica } from '@/lib/api';
import { useDocente } from '@/lib/auth';
import { pesosEnPorcentaje } from '@/lib/examen-form';

const formatoPorcentaje = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

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
        <div className="eyebrow">Matrices</div>
        <h1>Matrices de rúbrica</h1>
        <p>
          Librería reutilizable: al crear una pregunta abierta en un examen podés partir de una de estas matrices. El peso de cada
          criterio define cómo se reparten los puntos de la pregunta.
        </p>
      </header>

      <div style={{ marginBottom: 24 }}>
        <Link href="/matrices/nueva" className="btn btn-primary">
          + Nueva matriz
        </Link>
      </div>

      {error && <div className="error-box">{error}</div>}
      {matrices === null && !error && <p className="muted">Cargando…</p>}
      {matrices?.length === 0 && <div className="empty-state">Todavía no cargaste ninguna matriz.</div>}

      {matrices?.map((m) => {
        const porcentajes = pesosEnPorcentaje(m.criterios.map((c) => c.puntajeMaximo)); // en la matriz, `puntajeMaximo` es el peso
        return (
          <div key={m.id} className="card">
            <div className="card-title">{m.nombre}</div>
            <div className="card-meta">{m.criterios.length} {m.criterios.length === 1 ? 'criterio' : 'criterios'}</div>
            <ul style={{ listStyle: 'none', marginTop: 10, display: 'grid', gap: 4, fontSize: 14 }} aria-label={`Criterios de ${m.nombre}`}>
              {m.criterios.map((c, i) => (
                <li key={c.id}>
                  {c.nombre} <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>· {formatoPorcentaje.format(porcentajes[i])} %</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
