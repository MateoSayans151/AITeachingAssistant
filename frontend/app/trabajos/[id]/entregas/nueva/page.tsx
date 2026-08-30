'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createEntrega } from '@/lib/api';

export default function NuevaEntregaPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [alumnoNombre, setAlumnoNombre] = useState('');
  const [alumnoEmail, setAlumnoEmail] = useState('');
  const [textoTrabajo, setTextoTrabajo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const entrega = await createEntrega({
        trabajoPracticoId: params.id,
        alumnoNombre,
        alumnoEmail: alumnoEmail || undefined,
        textoTrabajo,
      });
      router.push(`/trabajos/${params.id}/revisar?entrega=${entrega.id}`);
    } catch (err) {
      setError('No se pudo cargar la entrega o falló la corrección automática. Podés reintentar.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">Nueva entrega</div>
        <h1>Cargar trabajo del alumno</h1>
        <p>Al guardar, el sistema corre la corrección con IA automáticamente contra la rúbrica de este TP.</p>
      </header>

      {error && <div className="error-box">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="alumnoNombre">Nombre del alumno</label>
          <input
            id="alumnoNombre"
            value={alumnoNombre}
            onChange={(e) => setAlumnoNombre(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="alumnoEmail">Email del alumno (opcional)</label>
          <input
            id="alumnoEmail"
            type="email"
            value={alumnoEmail}
            onChange={(e) => setAlumnoEmail(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="textoTrabajo">Texto del trabajo</label>
          <textarea
            id="textoTrabajo"
            value={textoTrabajo}
            onChange={(e) => setTextoTrabajo(e.target.value)}
            placeholder="Pegá acá el texto completo de la entrega (sin imágenes ni PDF escaneado en esta versión)."
            style={{ minHeight: 260 }}
            required
          />
        </div>

        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? 'Corrigiendo con IA…' : 'Guardar y corregir'}
        </button>
      </form>
    </div>
  );
}
