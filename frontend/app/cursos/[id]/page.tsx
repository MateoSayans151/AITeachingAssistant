'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Curso, getCurso } from '@/lib/api';

const ESTADO_LABELS: Record<string, string> = {
  borrador: 'Borrador',
  publicado: 'Publicado',
  cerrado: 'Cerrado',
};

export default function CursoDetallePage() {
  const params = useParams<{ id: string }>();
  const [curso, setCurso] = useState<Curso | null>(null);
  const [tab, setTab] = useState<'examenes' | 'comisiones'>('examenes');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCurso(params.id)
      .then(setCurso)
      .catch((e) => setError(e.message));
  }, [params.id]);

  if (error) {
    return (
      <div className="page">
        <div className="error-box">{error}</div>
      </div>
    );
  }

  if (!curso) {
    return (
      <div className="page">
        <p className="muted">Cargando…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">{curso.materia ?? 'Curso'}</div>
        <h1>{curso.nombre}</h1>
      </header>

      <div className="tabs">
        <button className={`tab ${tab === 'examenes' ? 'tab-active' : ''}`} onClick={() => setTab('examenes')}>
          Exámenes ({curso.examenes?.length ?? 0})
        </button>
        <button className={`tab ${tab === 'comisiones' ? 'tab-active' : ''}`} onClick={() => setTab('comisiones')}>
          Comisiones ({curso.comisiones?.length ?? 0})
        </button>
      </div>

      {tab === 'examenes' && (
        <>
          <div style={{ marginBottom: 20 }}>
            <Link href={`/examenes/nuevo?cursoId=${curso.id}`} className="btn btn-primary">
              + Nuevo examen
            </Link>
          </div>

          {(curso.examenes?.length ?? 0) === 0 && (
            <div className="empty-state">Todavía no cargaste ningún examen para este curso.</div>
          )}

          {curso.examenes?.map((examen) => (
            <Link key={examen.id} href={`/examenes/${examen.id}`} className="card card-link">
              <div className="card-title">{examen.titulo}</div>
              <div className="card-meta">{ESTADO_LABELS[examen.estado] ?? examen.estado}</div>
            </Link>
          ))}
        </>
      )}

      {tab === 'comisiones' && (
        <>
          <div style={{ marginBottom: 20 }}>
            <Link href={`/cursos/${curso.id}/comisiones/nueva`} className="btn btn-primary">
              + Nueva comisión
            </Link>
          </div>

          {(curso.comisiones?.length ?? 0) === 0 && (
            <div className="empty-state">Todavía no cargaste ninguna comisión para este curso.</div>
          )}

          {curso.comisiones?.map((comision) => (
            <div key={comision.id} className="card">
              <div className="card-title">{comision.nombre}</div>
              <div className="card-meta">{comision._count?.alumnos ?? 0} alumnos</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
