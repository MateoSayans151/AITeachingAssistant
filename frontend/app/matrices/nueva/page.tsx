'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Docente, NivelDescripcion, createMatrizRubrica } from '@/lib/api';

const NOMBRES_NIVELES = ['Insuficiente', 'Básico', 'Intermedio', 'Avanzado', 'Excelente'];

function nivelesVacios(): NivelDescripcion[] {
  return NOMBRES_NIVELES.map((nombre, i) => ({ orden: i + 1, nombre, descripcion: '' }));
}

interface CriterioForm {
  nombre: string;
  descripcion: string;
  puntajeMaximo: string;
  niveles: NivelDescripcion[];
}

function criterioVacio(): CriterioForm {
  return { nombre: '', descripcion: '', puntajeMaximo: '', niveles: nivelesVacios() };
}

export default function NuevaMatrizPage() {
  const router = useRouter();
  const [docente, setDocente] = useState<Docente | null>(null);
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [criterios, setCriterios] = useState<CriterioForm[]>([criterioVacio()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = window.localStorage.getItem('ata_docente');
    if (raw) setDocente(JSON.parse(raw));
  }, []);

  function actualizarCriterio(index: number, campo: 'nombre' | 'descripcion' | 'puntajeMaximo', valor: string) {
    setCriterios((prev) => prev.map((c, i) => (i === index ? { ...c, [campo]: valor } : c)));
  }

  function actualizarNivel(criterioIndex: number, nivelIndex: number, descripcion: string) {
    setCriterios((prev) =>
      prev.map((c, i) =>
        i === criterioIndex
          ? { ...c, niveles: c.niveles.map((n, j) => (j === nivelIndex ? { ...n, descripcion } : n)) }
          : c,
      ),
    );
  }

  function agregarCriterio() {
    setCriterios((prev) => [...prev, criterioVacio()]);
  }

  function quitarCriterio(index: number) {
    setCriterios((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!docente) return;
    setLoading(true);
    setError(null);
    try {
      await createMatrizRubrica({
        docenteId: docente.id,
        nombre,
        descripcion: descripcion || undefined,
        criterios: criterios
          .filter((c) => c.nombre && c.puntajeMaximo)
          .map((c) => ({
            nombre: c.nombre,
            descripcion: c.descripcion,
            puntajeMaximo: Number(c.puntajeMaximo),
            nivelesDescripcion: c.niveles,
          })),
      });
      router.push('/matrices');
    } catch (err) {
      setError('No se pudo crear la matriz. Completá la descripción de los 5 niveles en cada criterio.');
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
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">Nueva matriz de rúbrica</div>
        <h1>Criterios y niveles de desempeño</h1>
        <p>Cada criterio tiene 5 niveles fijos; describí qué implica cada uno para ese criterio puntual.</p>
      </header>

      {error && <div className="error-box">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="nombre">Nombre de la matriz</label>
          <input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        </div>

        <div className="field">
          <label htmlFor="descripcion">Descripción (opcional)</label>
          <input id="descripcion" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        </div>

        {criterios.map((c, ci) => (
          <div key={ci} className="card" style={{ marginBottom: 16 }}>
            <div className="criterio-row" style={{ gridTemplateColumns: '2fr 3fr 100px auto' }}>
              <input
                placeholder="Criterio (ej: Claridad del razonamiento)"
                value={c.nombre}
                onChange={(e) => actualizarCriterio(ci, 'nombre', e.target.value)}
              />
              <input
                placeholder="Qué evalúa este criterio"
                value={c.descripcion}
                onChange={(e) => actualizarCriterio(ci, 'descripcion', e.target.value)}
              />
              <input
                type="number"
                min="0.5"
                step="0.5"
                placeholder="Pts"
                value={c.puntajeMaximo}
                onChange={(e) => actualizarCriterio(ci, 'puntajeMaximo', e.target.value)}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => quitarCriterio(ci)}
                disabled={criterios.length === 1}
              >
                Quitar
              </button>
            </div>

            <div style={{ marginTop: 12 }}>
              {c.niveles.map((n, ni) => (
                <div key={ni} style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, marginBottom: 8 }}>
                  <div className="muted" style={{ fontSize: 13, fontWeight: 700, paddingTop: 10 }}>
                    {n.orden}. {n.nombre}
                  </div>
                  <input
                    placeholder={`Qué hace un alumno en nivel "${n.nombre}"`}
                    value={n.descripcion}
                    onChange={(e) => actualizarNivel(ci, ni, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}

        <button type="button" className="btn btn-secondary" onClick={agregarCriterio}>
          + Agregar criterio
        </button>

        <div style={{ marginTop: 28 }}>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Creando…' : 'Crear matriz'}
          </button>
        </div>
      </form>
    </div>
  );
}
