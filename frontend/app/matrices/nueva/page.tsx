'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NivelDescripcion, createMatrizRubrica } from '@/lib/api';
import { useDocente } from '@/lib/auth';
import AutoTextarea from '@/app/components/AutoTextarea';

const NIVELES_DEFAULT = [
  {
    nombre: 'Insuficiente',
    descripcion: 'No logra cumplir con el criterio: la respuesta es incorrecta, incompleta o no guarda relación con lo pedido.',
  },
  {
    nombre: 'Básico',
    descripcion: 'Cumple parcialmente con el criterio: muestra una comprensión elemental, con errores u omisiones importantes.',
  },
  {
    nombre: 'Intermedio',
    descripcion: 'Cumple con el criterio de forma aceptable: la respuesta es correcta en lo esencial, aunque con imprecisiones o poca profundidad.',
  },
  {
    nombre: 'Avanzado',
    descripcion: 'Cumple con el criterio de forma sólida: la respuesta es correcta, clara y fundamentada, con detalles menores por mejorar.',
  },
  {
    nombre: 'Excelente',
    descripcion: 'Cumple con el criterio de forma sobresaliente: la respuesta es completa, precisa, bien fundamentada y demuestra dominio del tema.',
  },
];

function nivelesIniciales(): NivelDescripcion[] {
  return NIVELES_DEFAULT.map((nivel, i) => ({ orden: i + 1, ...nivel }));
}

function nivelesSonSugeridos(niveles: NivelDescripcion[]): boolean {
  return niveles.every((n, i) => n.descripcion === NIVELES_DEFAULT[i].descripcion);
}

interface CriterioForm {
  nombre: string;
  descripcion: string;
  puntajeMaximo: string;
  niveles: NivelDescripcion[];
  /** Si el detalle de los 5 niveles está desplegado. */
  abierto: boolean;
}

function criterioInicial(): CriterioForm {
  return { nombre: '', descripcion: '', puntajeMaximo: '', niveles: nivelesIniciales(), abierto: false };
}

function puntajeValido(valor: string): boolean {
  const n = Number(valor);
  return valor.trim() !== '' && Number.isFinite(n) && n > 0;
}

/** Qué campos de un criterio están incompletos (el backend exige todos). */
function erroresCriterio(c: CriterioForm) {
  const niveles = c.niveles.map((n) => !n.descripcion.trim());
  const nombre = !c.nombre.trim();
  const descripcion = !c.descripcion.trim();
  const puntaje = !puntajeValido(c.puntajeMaximo);
  return { nombre, descripcion, puntaje, niveles, alguno: nombre || descripcion || puntaje || niveles.some(Boolean) };
}

function resumenNiveles(niveles: NivelDescripcion[]): string {
  const completos = niveles.filter((n) => n.descripcion.trim()).length;
  if (completos < niveles.length) return `${completos} de ${niveles.length} niveles completos`;
  return nivelesSonSugeridos(niveles) ? '5 niveles con descripción sugerida' : '5 niveles completos (editados)';
}

const formatoPuntos = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

/** Gris → ámbar según el nivel (1 a 5), para leer la escala de un vistazo. */
function colorNivel(orden: number): string {
  const acento = 20 + (orden - 1) * 20;
  return `color-mix(in srgb, var(--color-accent) ${acento}%, var(--color-neutral-700))`;
}

function NivelMeter({ orden }: { orden: number }) {
  return (
    <span className="nivel-meter" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} style={i <= orden ? { background: colorNivel(orden) } : undefined} />
      ))}
    </span>
  );
}

export default function NuevaMatrizPage() {
  const router = useRouter();
  const docente = useDocente();
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [criterios, setCriterios] = useState<CriterioForm[]>([criterioInicial()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intentoEnvio, setIntentoEnvio] = useState(false);
  const [fallos, setFallos] = useState(0);

  const errores = criterios.map(erroresCriterio);
  const cantidadInvalidos = errores.filter((e) => e.alguno).length;
  const mensajeValidacion =
    intentoEnvio && cantidadInvalidos > 0
      ? `Completá ${cantidadInvalidos === 1 ? 'el criterio marcado' : `los ${cantidadInvalidos} criterios marcados`} en rojo: nombre, qué evalúa, peso y los 5 niveles.`
      : null;
  const mensajeError = error ?? mensajeValidacion;
  // El "peso" viaja al servidor como `puntajeMaximo`; acá solo importa en proporción: al usar la matriz en una pregunta, los
  // puntos de ésta se reparten según el peso de cada criterio.
  const totalPesos = criterios.reduce((suma, c) => suma + (puntajeValido(c.puntajeMaximo) ? Number(c.puntajeMaximo) : 0), 0);

  // Tras un envío rechazado, lleva al primer campo marcado (los niveles incompletos ya se desplegaron).
  useEffect(() => {
    if (fallos === 0) return;
    const campo = document.querySelector<HTMLElement>('[aria-invalid="true"]');
    campo?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    campo?.focus({ preventScroll: true });
  }, [fallos]);

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

  function alternarNiveles(index: number) {
    setCriterios((prev) => prev.map((c, i) => (i === index ? { ...c, abierto: !c.abierto } : c)));
  }

  function restaurarNiveles(index: number) {
    setCriterios((prev) => prev.map((c, i) => (i === index ? { ...c, niveles: nivelesIniciales() } : c)));
  }

  function agregarCriterio() {
    setCriterios((prev) => [...prev, criterioInicial()]);
  }

  function quitarCriterio(index: number) {
    setCriterios((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!docente) return;
    setError(null);
    setIntentoEnvio(true);

    if (cantidadInvalidos > 0) {
      // Despliega los criterios con niveles incompletos para que el campo marcado sea visible.
      setCriterios((prev) =>
        prev.map((c) => (erroresCriterio(c).niveles.some(Boolean) ? { ...c, abierto: true } : c)),
      );
      setFallos((f) => f + 1);
      return;
    }

    setLoading(true);
    try {
      await createMatrizRubrica({
        nombre,
        descripcion: descripcion || undefined,
        criterios: criterios.map((c) => ({
          nombre: c.nombre.trim(),
          descripcion: c.descripcion.trim(),
          puntajeMaximo: Number(c.puntajeMaximo),
          nivelesDescripcion: c.niveles,
        })),
      });
      router.push('/matrices');
    } catch (err) {
      setError('No se pudo crear la matriz. Revisá los datos e intentá de nuevo.');
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
        <p>Cada criterio tiene 5 niveles fijos con una descripción sugerida; editala para ajustarla a ese criterio puntual.</p>
        <p id="ayuda-peso">
          Peso: importancia relativa del criterio. Al usar la matriz en una pregunta, los puntos se reparten según el peso.
        </p>
      </header>

      {mensajeError && (
        <div className="error-box" role="alert">
          {mensajeError}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="nombre">Nombre de la matriz</label>
          <input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        </div>

        <div className="field">
          <label htmlFor="descripcion">Descripción (opcional)</label>
          <input id="descripcion" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        </div>

        {criterios.map((c, ci) => {
          const err = errores[ci];
          const mostrar = intentoEnvio;
          const sugeridos = nivelesSonSugeridos(c.niveles);
          const nivelesIncompletos = err.niveles.some(Boolean);
          const idNiveles = `niveles-criterio-${ci}`;

          return (
            <div key={ci} className={`card${mostrar && err.alguno ? ' card-invalid' : ''}`}>
              <div className="card-head">
                <div className="card-kicker">Criterio {ci + 1}</div>
              </div>

              <div className="criterio-row criterio-row-labeled">
                <label className="mini-field">
                  <span>Criterio</span>
                  <input
                    placeholder="ej: Claridad del razonamiento"
                    value={c.nombre}
                    aria-invalid={mostrar && err.nombre}
                    onChange={(e) => actualizarCriterio(ci, 'nombre', e.target.value)}
                  />
                </label>
                <label className="mini-field">
                  <span>Qué evalúa</span>
                  <input
                    placeholder="ej: Si el argumento es claro y está bien fundamentado"
                    value={c.descripcion}
                    aria-invalid={mostrar && err.descripcion}
                    onChange={(e) => actualizarCriterio(ci, 'descripcion', e.target.value)}
                  />
                </label>
                <label className="mini-field">
                  <span>Peso</span>
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    inputMode="decimal"
                    placeholder="ej: 30"
                    title="Importancia relativa del criterio: al usar la matriz en una pregunta, los puntos se reparten según el peso"
                    aria-describedby="ayuda-peso"
                    value={c.puntajeMaximo}
                    aria-invalid={mostrar && err.puntaje}
                    onChange={(e) => actualizarCriterio(ci, 'puntajeMaximo', e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-secondary btn-icon"
                  onClick={() => quitarCriterio(ci)}
                  disabled={criterios.length === 1}
                  aria-label={`Quitar criterio ${ci + 1}`}
                  title={criterios.length === 1 ? 'Tiene que haber al menos un criterio' : 'Quitar criterio'}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4M6.5 7v4M9.5 7v4" />
                  </svg>
                </button>
              </div>

              <div className="accordion-bar">
                <button
                  type="button"
                  className="accordion-toggle"
                  onClick={() => alternarNiveles(ci)}
                  aria-expanded={c.abierto}
                  aria-controls={idNiveles}
                >
                  <svg className="chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 2l4 4-4 4" />
                  </svg>
                  Niveles de desempeño
                  <span className={nivelesIncompletos && mostrar ? 'accordion-summary-error' : 'accordion-summary'}>
                    · {resumenNiveles(c.niveles)}
                  </span>
                </button>
                {!sugeridos && (
                  <button type="button" className="btn btn-ghost" onClick={() => restaurarNiveles(ci)}>
                    Restaurar texto sugerido
                  </button>
                )}
              </div>

              {c.abierto && (
                <div id={idNiveles} style={{ marginTop: 8 }}>
                  {c.niveles.map((n, ni) => (
                    <div key={ni} className="nivel-row">
                      <div className="nivel-label">
                        <NivelMeter orden={n.orden} />
                        <span>
                          {n.orden}. {n.nombre}
                        </span>
                      </div>
                      <AutoTextarea
                        placeholder={`Qué hace un alumno en nivel "${n.nombre}"`}
                        value={n.descripcion}
                        aria-label={`Criterio ${ci + 1}, nivel ${n.nombre}`}
                        aria-invalid={mostrar && err.niveles[ni]}
                        onChange={(e) => actualizarNivel(ci, ni, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div style={{ marginTop: 14 }}>
          <button type="button" className="btn btn-secondary" onClick={agregarCriterio}>
            + Agregar criterio
          </button>
        </div>

        <div className="action-bar">
          <div className="action-bar-info">
            <span className="action-bar-total">
              {criterios.length} {criterios.length === 1 ? 'criterio' : 'criterios'} · Suma de pesos {formatoPuntos.format(totalPesos)}
            </span>
            {mensajeError && <span className="action-bar-error">{mensajeError}</span>}
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Creando…' : 'Crear matriz'}
          </button>
        </div>
      </form>
    </div>
  );
}
