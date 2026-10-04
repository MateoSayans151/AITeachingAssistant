'use client';

// PasoPreguntas: el paso 2 del wizard. Recuadro con el total de puntos (pegado arriba mientras se scrollea, tiene que ser
// igual a la escala máxima), la lista de <PreguntaCard/> y "+ Agregar pregunta". No tiene estado propio.
//
// Contrato:
//   PasoPreguntas({ preguntas, onChange, niveles, matrices, escalaMin, escalaMax, onUsarComoEscala })
//     preguntas          PreguntaForm[] (el estado vive en el padre).
//     onChange(next)     se llama con la lista completa ya modificada (pregunta editada, agregada o quitada).
//     niveles            escala de niveles del examen (`datos.niveles`): para armar preguntas y criterios nuevos.
//     matrices           matrices de rúbrica del docente.
//     escalaMin/Max      `datos.escalaMin` / `datos.escalaMax` tal cual (strings del formulario): el total se compara con la máxima.
//     onUsarComoEscala(total)  el docente apretó "Usar X como escala máxima"; el padre pone `escalaMax = String(total)`.

import type { MatrizRubrica } from '@/lib/api';
import { esNumero, formatearPuntos, preguntaVacia, redondearPuntos, totalCoincideConEscala, totalDelExamen } from '@/lib/examen-form';
import type { NivelForm, PreguntaForm } from '@/lib/examen-form';
import { PreguntaCard } from './PreguntaCard';

export interface PasoPreguntasProps {
  preguntas: PreguntaForm[];
  onChange: (next: PreguntaForm[]) => void;
  niveles: NivelForm[];
  matrices: MatrizRubrica[];
  escalaMin: string;
  escalaMax: string;
  onUsarComoEscala: (total: number) => void;
}

export function PasoPreguntas({ preguntas, onChange, niveles, matrices, escalaMin, escalaMax, onUsarComoEscala }: PasoPreguntasProps) {
  // Total a la vista mientras se arman las preguntas: tiene que ser igual a la escala máxima.
  const total = totalDelExamen(preguntas);
  const max = esNumero(escalaMax) ? Number(escalaMax) : null;
  const coincide = max !== null && totalCoincideConEscala(total, max);
  const diferencia = max !== null ? redondearPuntos(max - total) : 0; // > 0: faltan puntos; < 0: sobran
  const puedeUsarComoEscala = max !== null && !coincide && (!esNumero(escalaMin) || total > Number(escalaMin));

  return (
    <div>
      <div
        className="card"
        role="status"
        style={{
          position: 'sticky',
          top: 60, // debajo de la barra superior (que también es sticky)
          zIndex: 25,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          marginBottom: 16,
          borderColor: coincide ? 'var(--color-success)' : 'var(--color-accent)',
          color: coincide ? 'var(--color-success)' : 'var(--color-accent-800)',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
            Total del examen: {formatearPuntos(total)}
            {max !== null && ` de ${formatearPuntos(max)}`} pts
          </strong>
          {max !== null && (
            <span className={`badge ${coincide ? 'badge-revisado' : 'badge-pendiente'}`}>
              {coincide ? 'OK' : diferencia > 0 ? `Faltan ${formatearPuntos(diferencia)} pts` : `Sobran ${formatearPuntos(-diferencia)} pts`}
            </span>
          )}
        </div>
        {puedeUsarComoEscala && (
          <button type="button" className="btn btn-secondary" onClick={() => onUsarComoEscala(redondearPuntos(total))}>
            Usar {formatearPuntos(total)} como escala máxima
          </button>
        )}
      </div>

      {preguntas.map((p, pi) => (
        <PreguntaCard
          key={pi}
          indice={pi}
          pregunta={p}
          onChange={(nueva) => onChange(preguntas.map((x, i) => (i === pi ? nueva : x)))}
          onQuitar={() => onChange(preguntas.filter((_, i) => i !== pi))}
          cantidadPreguntas={preguntas.length}
          niveles={niveles}
          matrices={matrices}
        />
      ))}
      <button type="button" className="btn btn-secondary" onClick={() => onChange([...preguntas, preguntaVacia(niveles)])}>
        + Agregar pregunta
      </button>
    </div>
  );
}
