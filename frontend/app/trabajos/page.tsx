'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TrabajoPractico, listTrabajosPracticos } from '@/lib/api';
import { useDocente } from '@/lib/auth';

export default function TrabajosPage() {
  const docente = useDocente();
  const [trabajos, setTrabajos] = useState<TrabajoPractico[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!docente) return;
    listTrabajosPracticos()
      .then(setTrabajos)
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
        <div className="eyebrow">Trabajos prácticos</div>
        <h1>Tus trabajos prácticos</h1>
        <p>Cada trabajo con su rúbrica, las entregas que recibió y el estado de corrección.</p>
      </header>

      <div style={{ marginBottom: 24, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link href="/trabajos/nuevo" className="btn btn-primary">
          + Nuevo trabajo práctico
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
