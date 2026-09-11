'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createComision } from '@/lib/api';

interface AlumnoForm {
  nombre: string;
  email: string;
}

const ALUMNO_VACIO: AlumnoForm = { nombre: '', email: '' };

export default function NuevaComisionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [nombre, setNombre] = useState('');
  const [alumnos, setAlumnos] = useState<AlumnoForm[]>([{ ...ALUMNO_VACIO }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function actualizarAlumno(index: number, campo: keyof AlumnoForm, valor: string) {
    setAlumnos((prev) => prev.map((a, i) => (i === index ? { ...a, [campo]: valor } : a)));
  }

  function agregarAlumno() {
    setAlumnos((prev) => [...prev, { ...ALUMNO_VACIO }]);
  }

  function quitarAlumno(index: number) {
    setAlumnos((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const alumnosValidos = alumnos.filter((a) => a.nombre && a.email);
      await createComision(params.id, {
        nombre,
        alumnos: alumnosValidos.length > 0 ? alumnosValidos : undefined,
      });
      router.push(`/cursos/${params.id}`);
    } catch (err) {
      setError('No se pudo crear la comisión. Revisá que los emails no estén repetidos.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">Nueva comisión</div>
        <h1>Datos y roster</h1>
        <p>Podés cargar el listado de alumnos ahora o agregarlos uno por uno más adelante.</p>
      </header>

      {error && <div className="error-box">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="nombre">Nombre de la comisión</label>
          <input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        </div>

        <div className="field">
          <label>Alumnos</label>
          <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Cada alumno se identifica por su email cuando entra a rendir un examen por link.
          </div>

          {alumnos.map((a, i) => (
            <div
              key={i}
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, marginBottom: 10 }}
            >
              <input
                placeholder="Nombre"
                value={a.nombre}
                onChange={(e) => actualizarAlumno(i, 'nombre', e.target.value)}
              />
              <input
                type="email"
                placeholder="Email"
                value={a.email}
                onChange={(e) => actualizarAlumno(i, 'email', e.target.value)}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => quitarAlumno(i)}
                disabled={alumnos.length === 1}
              >
                Quitar
              </button>
            </div>
          ))}

          <button type="button" className="btn btn-secondary" onClick={agregarAlumno}>
            + Agregar alumno
          </button>
        </div>

        <div style={{ marginTop: 28 }}>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Creando…' : 'Crear comisión'}
          </button>
        </div>
      </form>
    </div>
  );
}
