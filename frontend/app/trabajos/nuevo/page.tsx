'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Docente, createTrabajoPractico } from '@/lib/api';

interface CriterioForm {
  nombre: string;
  descripcion: string;
  puntajeMaximo: string;
}

const CRITERIO_VACIO: CriterioForm = { nombre: '', descripcion: '', puntajeMaximo: '' };

export default function NuevoTrabajoPracticoPage() {
  const router = useRouter();
  const [docente, setDocente] = useState<Docente | null>(null);
  const [titulo, setTitulo] = useState('');
  const [materia, setMateria] = useState('');
  const [consigna, setConsigna] = useState('');
  const [criterios, setCriterios] = useState<CriterioForm[]>([{ ...CRITERIO_VACIO }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = window.localStorage.getItem('ata_docente');
    if (raw) setDocente(JSON.parse(raw));
  }, []);

  function actualizarCriterio(index: number, campo: keyof CriterioForm, valor: string) {
    setCriterios((prev) => prev.map((c, i) => (i === index ? { ...c, [campo]: valor } : c)));
  }

  function agregarCriterio() {
    setCriterios((prev) => [...prev, { ...CRITERIO_VACIO }]);
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
      const tp = await createTrabajoPractico({
        docenteId: docente.id,
        titulo,
        materia: materia || undefined,
        consigna,
        criterios: criterios
          .filter((c) => c.nombre && c.puntajeMaximo)
          .map((c) => ({
            nombre: c.nombre,
            descripcion: c.descripcion,
            puntajeMaximo: Number(c.puntajeMaximo),
          })),
      });
      router.push(`/trabajos/${tp.id}`);
    } catch (err) {
      setError('No se pudo crear el trabajo práctico. Revisá los datos e intentá de nuevo.');
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
        <div className="eyebrow">Nuevo trabajo práctico</div>
        <h1>Consigna y rúbrica</h1>
        <p>Se carga una sola vez por trabajo práctico. Después subís las entregas de los alumnos contra esto.</p>
      </header>

      {error && <div className="error-box">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="titulo">Título del trabajo práctico</label>
          <input id="titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} required />
        </div>

        <div className="field">
          <label htmlFor="materia">Materia (opcional)</label>
          <input id="materia" value={materia} onChange={(e) => setMateria(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="consigna">Consigna</label>
          <textarea
            id="consigna"
            value={consigna}
            onChange={(e) => setConsigna(e.target.value)}
            placeholder="Pegá el enunciado completo tal cual se lo diste a los alumnos."
            required
          />
        </div>

        <div className="field">
          <label>Rúbrica</label>
          <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Un criterio por fila, con su puntaje máximo. La IA va a evaluar cada entrega exclusivamente
            contra estos criterios.
          </div>

          {criterios.map((c, i) => (
            <div className="criterio-row" key={i}>
              <input
                placeholder="Criterio (ej: Claridad del argumento)"
                value={c.nombre}
                onChange={(e) => actualizarCriterio(i, 'nombre', e.target.value)}
              />
              <input
                placeholder="Qué se espera para cumplirlo"
                value={c.descripcion}
                onChange={(e) => actualizarCriterio(i, 'descripcion', e.target.value)}
              />
              <input
                type="number"
                min="0.5"
                step="0.5"
                placeholder="Pts"
                value={c.puntajeMaximo}
                onChange={(e) => actualizarCriterio(i, 'puntajeMaximo', e.target.value)}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => quitarCriterio(i)}
                disabled={criterios.length === 1}
              >
                Quitar
              </button>
            </div>
          ))}

          <button type="button" className="btn btn-secondary" onClick={agregarCriterio}>
            + Agregar criterio
          </button>
        </div>

        <div style={{ marginTop: 28 }}>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Creando…' : 'Crear trabajo práctico'}
          </button>
        </div>
      </form>
    </div>
  );
}
