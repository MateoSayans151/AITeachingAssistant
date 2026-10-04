'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ResumenCurso, TrabajoPractico, getTrabajoPractico, getUltimoResumenCurso } from '@/lib/api';
import { useSesion } from '@/lib/auth';

// Componente de cliente: el pedido a la API necesita la sesión del navegador (en el servidor de Next no existe).
export default function ResumenCursoPage() {
  const params = useParams<{ id: string }>();
  const { docente, cargando } = useSesion();
  const [tp, setTp] = useState<TrabajoPractico | null>(null);
  const [resumen, setResumen] = useState<ResumenCurso | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!docente) return;
    Promise.all([getTrabajoPractico(params.id), getUltimoResumenCurso(params.id).catch(() => null)])
      .then(([t, r]) => {
        setTp(t);
        setResumen(r);
      })
      .catch((e) => setError(e.message));
  }, [docente, params.id]);

  if (cargando) return <div className="page"><p className="muted">Cargando…</p></div>;
  if (!docente) return <div className="page"><p className="muted">Identificate primero desde el inicio.</p></div>;
  if (error) return <div className="page"><div className="error-box">{error}</div></div>;
  if (!tp) return <div className="page"><p className="muted">Cargando…</p></div>;

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">{tp.titulo}</div>
        <h1>Resumen del curso</h1>
        <p>
          Qué criterios o conceptos generaron más dificultad entre los alumnos, según el análisis agregado
          de las correcciones ya confirmadas.
        </p>
      </header>

      {!resumen && (
        <div className="empty-state">
          Todavía no se generó ningún resumen para este trabajo práctico.{' '}
          <Link href={`/trabajos/${tp.id}`} className="btn btn-secondary" style={{ marginTop: 16 }}>
            Volver al trabajo práctico
          </Link>
        </div>
      )}

      {resumen && (
        <>
          <div className="card-meta" style={{ marginBottom: 20 }}>
            Generado el {new Date(resumen.generadoEn).toLocaleString('es-AR')} · basado en{' '}
            {resumen.cantidadEntregasAnalizadas} entregas · modelo: {resumen.modeloIa}
          </div>

          <div className="card" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
            {resumen.contenido}
          </div>

          <div style={{ marginTop: 24 }}>
            <Link href={`/trabajos/${tp.id}`} className="btn btn-secondary">
              Volver al trabajo práctico
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
