'use client';

// Página pública para que el alumno rinda un examen por link. Simulación consciente:
// no hay autenticación de alumnos en el proyecto (se identifica por email contra el
// roster de la comisión), y no hay timer ni anti-cheat de sesión — ver plan de
// implementación de Cátedra para el alcance exacto de esta simplificación.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ExamenParaRendir, getExamenPorSlug, registrarRespuesta } from '@/lib/api';

type Contenido = string | number | boolean | string[] | Array<[string, string]> | null;

export default function RendirExamenPage() {
  const params = useParams<{ slug: string }>();
  const [data, setData] = useState<ExamenParaRendir | null>(null);
  const [alumnoEmail, setAlumnoEmail] = useState('');
  const [respuestas, setRespuestas] = useState<Record<string, Contenido>>({});
  const [enviado, setEnviado] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getExamenPorSlug(params.slug)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [params.slug]);

  if (error) {
    return (
      <div className="page">
        <div className="error-box">{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <p className="muted">Cargando…</p>
      </div>
    );
  }

  if (enviado) {
    return (
      <div className="page">
        <div className="card">
          <div className="card-title" style={{ marginBottom: 8 }}>
            ¡Listo!
          </div>
          <p className="muted">Tu respuesta se envió correctamente. Tu docente te va a avisar cuando esté el feedback.</p>
        </div>
      </div>
    );
  }

  function setContenido(preguntaId: string, valor: Contenido) {
    setRespuestas((prev) => ({ ...prev, [preguntaId]: valor }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await registrarRespuesta(params.slug, {
        alumnoEmail,
        respuestas: data!.examen.preguntas.map((p) => ({ preguntaId: p.id, contenido: respuestas[p.id] ?? null })),
      });
      setEnviado(true);
    } catch (err) {
      setError('No se pudo enviar la respuesta. Verificá tu email y que no hayas rendido ya este examen.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">{data.comision.nombre}</div>
        <h1>{data.examen.titulo}</h1>
        <p>{data.examen.consigna}</p>
      </header>

      {error && <div className="error-box">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="email">Tu email (el mismo con el que estás en el listado de la comisión)</label>
          <input id="email" type="email" value={alumnoEmail} onChange={(e) => setAlumnoEmail(e.target.value)} required />
        </div>

        {data.examen.preguntas.map((p, i) => (
          <div key={p.id} className="card" style={{ marginBottom: 16 }}>
            <div className="card-title" style={{ marginBottom: 12 }}>
              {i + 1}. {p.enunciado} <span className="muted">({p.puntajeMaximo} pts)</span>
            </div>

            {['desarrollo', 'resolucion_problema', 'demostracion', 'analisis_caso', 'respuesta_corta'].includes(p.tipo) && (
              <textarea
                value={(respuestas[p.id] as string) ?? ''}
                onChange={(e) => setContenido(p.id, e.target.value)}
              />
            )}

            {p.tipo === 'numerica' && (
              <input
                type="number"
                value={(respuestas[p.id] as number) ?? ''}
                onChange={(e) => setContenido(p.id, Number(e.target.value))}
              />
            )}

            {p.tipo === 'verdadero_falso' && (
              <div style={{ display: 'flex', gap: 16 }}>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="radio" name={`vf-${p.id}`} onChange={() => setContenido(p.id, true)} />
                  Verdadero
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="radio" name={`vf-${p.id}`} onChange={() => setContenido(p.id, false)} />
                  Falso
                </label>
              </div>
            )}

            {p.tipo === 'opcion_multiple' &&
              (p.opciones as Array<{ id: string; texto: string }>).map((o) => (
                <label key={o.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <input type="radio" name={`om-${p.id}`} onChange={() => setContenido(p.id, o.id)} />
                  {o.texto}
                </label>
              ))}

            {p.tipo === 'casillas' &&
              (p.opciones as Array<{ id: string; texto: string }>).map((o) => (
                <label key={o.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    onChange={(e) => {
                      const actuales = (respuestas[p.id] as string[]) ?? [];
                      setContenido(p.id, e.target.checked ? [...actuales, o.id] : actuales.filter((id) => id !== o.id));
                    }}
                  />
                  {o.texto}
                </label>
              ))}

            {p.tipo === 'relacionar_pares' &&
              (() => {
                const cfg = p.opciones as { izquierda: string[]; derecha: string[] };
                return cfg.izquierda.map((izq, idx) => (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
                    <div style={{ paddingTop: 10 }}>{izq}</div>
                    <select
                      onChange={(e) => {
                        const actuales = ((respuestas[p.id] as Array<[string, string]>) ?? []).filter(
                          ([i]) => i !== izq,
                        );
                        setContenido(p.id, [...actuales, [izq, e.target.value]]);
                      }}
                    >
                      <option value="">Elegí…</option>
                      {cfg.derecha.map((der) => (
                        <option key={der} value={der}>
                          {der}
                        </option>
                      ))}
                    </select>
                  </div>
                ));
              })()}
          </div>
        ))}

        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? 'Enviando…' : 'Enviar respuesta'}
        </button>
      </form>
    </div>
  );
}
