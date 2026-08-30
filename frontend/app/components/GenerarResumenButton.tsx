'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { generarResumenCurso } from '@/lib/api';

export function GenerarResumenButton({ trabajoPracticoId }: { trabajoPracticoId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      await generarResumenCurso(trabajoPracticoId);
      router.push(`/trabajos/${trabajoPracticoId}/resumen`);
    } catch (err) {
      setError('No se pudo generar el resumen. ¿Hay al menos una entrega corregida?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button className="btn btn-secondary" onClick={handleClick} disabled={loading}>
        {loading ? 'Analizando el curso…' : 'Generar resumen del curso'}
      </button>
      {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}
    </div>
  );
}
