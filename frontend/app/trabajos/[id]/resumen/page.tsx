import Link from 'next/link';
import { getTrabajoPractico, getUltimoResumenCurso } from '@/lib/api';

export default async function ResumenCursoPage({ params }: { params: { id: string } }) {
  const [tp, resumen] = await Promise.all([
    getTrabajoPractico(params.id),
    getUltimoResumenCurso(params.id).catch(() => null),
  ]);

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
