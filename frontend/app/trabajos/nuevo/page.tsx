'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, ModalidadLink, createTrabajoPractico } from '@/lib/api';
import { useDocente } from '@/lib/auth';
import { fechaLocalAIso } from '@/lib/fechas';

interface CriterioForm {
  nombre: string;
  descripcion: string;
  puntajeMaximo: string;
}

const CRITERIO_VACIO: CriterioForm = { nombre: '', descripcion: '', puntajeMaximo: '' };

// Máximo de una ventana de tiempo (lo mismo que valida el servidor): más largo es un plazo, o sea, horario fijo.
const MAX_DURACION_MINUTOS = 24 * 60;

/** Mensaje de validación que mandó el servidor (class-validator devuelve una lista), si lo hay. */
function mensajeDelServidor(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  try {
    const m = JSON.parse(err.body).message;
    return Array.isArray(m) ? m.join(' · ') : typeof m === 'string' ? m : null;
  } catch {
    return null; // cuerpo no JSON
  }
}

export default function NuevoTrabajoPracticoPage() {
  const router = useRouter();
  const docente = useDocente();
  const [titulo, setTitulo] = useState('');
  const [materia, setMateria] = useState('');
  const [consigna, setConsigna] = useState('');
  const [criterios, setCriterios] = useState<CriterioForm[]>([{ ...CRITERIO_VACIO }]);
  // Link para los alumnos: lo único que se elige (el link se genera siempre).
  const [modoSeguro, setModoSeguro] = useState(false);
  const [modalidad, setModalidad] = useState<ModalidadLink>('ventana_tiempo');
  const [duracionMinutos, setDuracionMinutos] = useState('60');
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function actualizarCriterio(index: number, campo: keyof CriterioForm, valor: string) {
    setCriterios((prev) => prev.map((c, i) => (i === index ? { ...c, [campo]: valor } : c)));
  }

  function agregarCriterio() {
    setCriterios((prev) => [...prev, { ...CRITERIO_VACIO }]);
  }

  function quitarCriterio(index: number) {
    setCriterios((prev) => prev.filter((_, i) => i !== index));
  }

  /** Qué le falta a la modalidad elegida (el servidor lo vuelve a validar). */
  function validarLink(): string | null {
    if (modalidad === 'ventana_tiempo') {
      const minutos = Number(duracionMinutos);
      if (!Number.isInteger(minutos) || minutos < 1 || minutos > MAX_DURACION_MINUTOS) {
        return `La ventana de tiempo tiene que ser de entre 1 y ${MAX_DURACION_MINUTOS} minutos. Para un plazo más largo, usá horario fijo.`;
      }
      return null;
    }
    const inicio = fechaLocalAIso(fechaInicio);
    const fin = fechaLocalAIso(fechaFin);
    if (!inicio || !fin) return 'El horario fijo necesita la fecha y hora de inicio y la de vencimiento.';
    if (new Date(fin) <= new Date(inicio)) return 'El vencimiento tiene que ser posterior al inicio.';
    if (new Date(fin) <= new Date()) return 'El vencimiento ya pasó.';
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!docente) return;
    const problema = validarLink();
    if (problema) {
      setError(problema);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const tp = await createTrabajoPractico({
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
        modoSeguro,
        modalidad,
        duracionMinutos: modalidad === 'ventana_tiempo' ? Number(duracionMinutos) : undefined,
        fechaInicio: modalidad === 'horario_fijo' ? fechaLocalAIso(fechaInicio) : undefined,
        fechaFin: modalidad === 'horario_fijo' ? fechaLocalAIso(fechaFin) : undefined,
      });
      router.push(`/trabajos/${tp.id}`);
    } catch (err) {
      setError(mensajeDelServidor(err) ?? 'No se pudo crear el trabajo práctico. Revisá los datos e intentá de nuevo.');
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
        <p>
          Se carga una sola vez por trabajo práctico. Al crearlo se genera un link para que los alumnos entreguen solos;
          también podés cargar entregas a mano.
        </p>
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

        <div className="card" style={{ marginTop: 28 }}>
          <div className="card-title" style={{ marginBottom: 6 }}>
            Link para los alumnos
          </div>
          <p className="muted" style={{ marginBottom: 14 }}>
            Se genera al crear el trabajo. Elegí cómo lo entregan; el alumno solo necesita su nombre y su email.
          </p>

          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
            <input type="checkbox" checked={modoSeguro} onChange={(e) => setModoSeguro(e.target.checked)} />
            Modo seguro
          </label>
          <p className="muted" style={{ margin: '6px 0 18px' }}>
            Registra si el alumno sale de pantalla completa, cambia de pestaña o pega texto. No bloquea nada ni baja la nota: lo
            ves junto a cada entrega y decidís. Antes de empezar, el alumno ve qué se monitorea y tiene que aceptarlo.
          </p>

          <div style={{ fontWeight: 600, marginBottom: 8 }}>Cómo se entrega</div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
            <input type="radio" name="modalidad" checked={modalidad === 'ventana_tiempo'} onChange={() => setModalidad('ventana_tiempo')} />
            Ventana de tiempo
          </label>
          <p className="muted" style={{ margin: '0 0 8px 26px' }}>
            Cada alumno tiene un tiempo fijo desde que empieza. Si se termina, se entrega lo que alcanzó a escribir.
          </p>
          {modalidad === 'ventana_tiempo' && (
            <div className="field" style={{ width: 220, marginLeft: 26 }}>
              <label htmlFor="duracion">Minutos por alumno</label>
              <input id="duracion" type="number" min="1" max={MAX_DURACION_MINUTOS} step="1" value={duracionMinutos} onChange={(e) => setDuracionMinutos(e.target.value)} />
            </div>
          )}

          <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0 4px' }}>
            <input type="radio" name="modalidad" checked={modalidad === 'horario_fijo'} onChange={() => setModalidad('horario_fijo')} />
            Horario fijo
          </label>
          <p className="muted" style={{ margin: '0 0 8px 26px' }}>
            El link se abre y se cierra en las fechas que elijas; todos entregan hasta el vencimiento.
          </p>
          {modalidad === 'horario_fijo' && (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginLeft: 26 }}>
              <div className="field" style={{ width: 220 }}>
                <label htmlFor="fechaInicio">Se abre</label>
                <input id="fechaInicio" type="datetime-local" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
              </div>
              <div className="field" style={{ width: 220 }}>
                <label htmlFor="fechaFin">Vence</label>
                <input id="fechaFin" type="datetime-local" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        <div style={{ marginTop: 28 }}>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Creando…' : 'Crear trabajo práctico y generar link'}
          </button>
        </div>
      </form>
    </div>
  );
}
