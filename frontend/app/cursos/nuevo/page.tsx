'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Docente, createCurso } from '@/lib/api';

export default function NuevoCursoPage() {
  const router = useRouter();
  const [docente, setDocente] = useState<Docente | null>(null);
  const [nombre, setNombre] = useState('');
  const [materia, setMateria] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = window.localStorage.getItem('ata_docente');
    if (raw) setDocente(JSON.parse(raw));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!docente) return;
    setLoading(true);
    setError(null);
    try {
      const curso = await createCurso({ docenteId: docente.id, nombre, materia: materia || undefined });
      router.push(`/cursos/${curso.id}`);
    } catch (err) {
      setError('No se pudo crear el curso. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  if (!docente) {
    return (
      <div className="page">
        <p className="muted">Identificate primero desde el inicio.</p>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <header className="page-header">
        <div className="eyebrow">Nuevo curso</div>
        <h1>Datos del curso</h1>
        <p>Dentro de un curso vas a poder cargar comisiones (con su roster de alumnos) y exámenes.</p>
      </header>

      {error && <div className="error-box">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="nombre">Nombre del curso</label>
          <input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        </div>

        <div className="field">
          <label htmlFor="materia">Materia (opcional)</label>
          <input id="materia" value={materia} onChange={(e) => setMateria(e.target.value)} />
        </div>

        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? 'Creando…' : 'Crear curso'}
        </button>
      </form>
    </div>
  );
}
