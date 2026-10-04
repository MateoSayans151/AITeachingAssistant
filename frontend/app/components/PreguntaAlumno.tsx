'use client';

// PreguntaAlumno: cómo se ve y se responde UNA pregunta de examen del lado del alumno. Es presentacional y NO tiene estado
// propio: muestra el `valor` que le pasan y avisa los cambios con `onChange`. Lo usan los dos lugares donde el alumno (o el
// docente, en la vista previa) ve una pregunta: el examen en curso (`/rendir/[slug]/ExamenEnCurso`) y la vista previa del
// wizard de "Nuevo examen" (`examenes/nuevo/VistaPreviaAlumno`), así que lo que el docente previsualiza es el mismo código
// que renderiza al alumno.
//
// Contrato:
//   PreguntaAlumno({ pregunta, valor, onChange, deshabilitado? })
//     pregunta       PreguntaRendir tal como la entrega el servidor: `opciones` ya viene SIN la clave de respuesta
//                    (opción múltiple / casillas: [{id, texto}]; relacionar pares: {izquierda, derecha}; el resto, null).
//     valor          respuesta actual (el estado lo lleva el padre): string en las abiertas, number | null en numérica,
//                    boolean en verdadero/falso, id (string) en opción múltiple, string[] de ids en casillas y
//                    [izquierda, derecha][] en relacionar pares.
//     onChange(v)    se llama con el valor nuevo completo (misma forma que `valor`; en numérica, null si se vacía el campo).
//     deshabilitado? bloquea todos los controles (se acabó el tiempo / se está entregando). Por defecto false.
//
//   TarjetaPreguntaAlumno({ pregunta, numero, valor, onChange, deshabilitado? })
//     La tarjeta completa de la pregunta: "N. enunciado (X pts)" + <PreguntaAlumno/>. `numero` es la posición base 1
//     (también va en `data-pregunta`, que el anti-cheat usa para decir en qué pregunta se pegó texto).
//
// Detección del pegado (anti-cheat): NO se engancha acá. ExamenEnCurso escucha `paste` en el `document` y resuelve la
// pregunta con `closest('[data-pregunta]')`, que es el atributo de <TarjetaPreguntaAlumno/>; por eso no hace falta una
// prop `onPegar` y el DOM de los campos no cambia.

import type { PreguntaRendir } from '@/lib/api';

export interface PreguntaAlumnoProps {
  pregunta: PreguntaRendir;
  valor: unknown;
  onChange: (v: unknown) => void;
  deshabilitado?: boolean;
}

export function PreguntaAlumno({ pregunta: p, valor, onChange, deshabilitado = false }: PreguntaAlumnoProps) {
  const abiertas = ['desarrollo', 'resolucion_problema', 'demostracion', 'analisis_caso', 'respuesta_corta'];

  if (abiertas.includes(p.tipo)) {
    // Con la clase `field` toma el estilo del resto de la app (borde, foco, ancho completo) y no el crudo del navegador. Las
    // respuestas largas (desarrollo, demostración…) necesitan lugar para escribir: una respuesta corta, bastante menos.
    return (
      <div className="field" style={{ marginBottom: 0 }}>
        <textarea
          aria-label={`Respuesta a: ${p.enunciado}`}
          value={typeof valor === 'string' ? valor : ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={deshabilitado}
          style={{ minHeight: p.tipo === 'respuesta_corta' ? 90 : 220 }}
        />
      </div>
    );
  }

  if (p.tipo === 'numerica') {
    return (
      <div className="field" style={{ marginBottom: 0, maxWidth: 240 }}>
        <input
          type="number"
          aria-label={`Respuesta a: ${p.enunciado}`}
          value={typeof valor === 'number' ? valor : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          disabled={deshabilitado}
        />
      </div>
    );
  }

  if (p.tipo === 'verdadero_falso') {
    return (
      <div style={{ display: 'flex', gap: 16 }}>
        {[
          { label: 'Verdadero', v: true },
          { label: 'Falso', v: false },
        ].map((o) => (
          <label key={o.label} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="radio" name={`vf-${p.id}`} checked={valor === o.v} onChange={() => onChange(o.v)} disabled={deshabilitado} />
            {o.label}
          </label>
        ))}
      </div>
    );
  }

  if (p.tipo === 'opcion_multiple') {
    return (
      <>
        {(p.opciones as Array<{ id: string; texto: string }>).map((o) => (
          <label key={o.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <input type="radio" name={`om-${p.id}`} checked={valor === o.id} onChange={() => onChange(o.id)} disabled={deshabilitado} />
            {o.texto}
          </label>
        ))}
      </>
    );
  }

  if (p.tipo === 'casillas') {
    const actuales = Array.isArray(valor) ? (valor as string[]) : [];
    return (
      <>
        {(p.opciones as Array<{ id: string; texto: string }>).map((o) => (
          <label key={o.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={actuales.includes(o.id)}
              onChange={(e) => onChange(e.target.checked ? [...actuales, o.id] : actuales.filter((id) => id !== o.id))}
              disabled={deshabilitado}
            />
            {o.texto}
          </label>
        ))}
      </>
    );
  }

  if (p.tipo === 'relacionar_pares') {
    const cfg = p.opciones as { izquierda: string[]; derecha: string[] };
    const pares = Array.isArray(valor) ? (valor as Array<[string, string]>) : [];
    return (
      <>
        {cfg.izquierda.map((izq, k) => (
          // La clave lleva la posición: en la vista previa el docente puede tener textos repetidos mientras escribe.
          <div key={`${k}-${izq}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
            <div style={{ paddingTop: 10 }}>{izq}</div>
            <div className="field" style={{ marginBottom: 0 }}>
              <select
                aria-label={`Elegí la pareja de ${izq}`}
                value={pares.find(([i]) => i === izq)?.[1] ?? ''}
                onChange={(e) => {
                  const resto = pares.filter(([i]) => i !== izq);
                  onChange(e.target.value ? [...resto, [izq, e.target.value]] : resto);
                }}
                disabled={deshabilitado}
              >
                <option value="">Elegí…</option>
                {cfg.derecha.map((der, j) => (
                  <option key={`${j}-${der}`} value={der}>
                    {der}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </>
    );
  }

  return null;
}

export interface TarjetaPreguntaAlumnoProps extends PreguntaAlumnoProps {
  /** Posición de la pregunta en el examen, base 1. */
  numero: number;
}

export function TarjetaPreguntaAlumno({ pregunta, numero, valor, onChange, deshabilitado }: TarjetaPreguntaAlumnoProps) {
  return (
    <div className="card" style={{ marginBottom: 16 }} data-pregunta={numero}>
      <div className="card-title" style={{ marginBottom: 12 }}>
        {numero}. {pregunta.enunciado} <span className="muted">({pregunta.puntajeMaximo} pts)</span>
      </div>
      <PreguntaAlumno pregunta={pregunta} valor={valor} onChange={onChange} deshabilitado={deshabilitado} />
    </div>
  );
}
