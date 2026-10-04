'use client';

// RubricaEditor: los criterios de UNA pregunta abierta (desarrollo, resolución de problema, demostración, análisis de caso y
// respuesta corta). Incluye el selector "Partir de una matriz existente…", una fila por criterio y el detalle opcional de
// cada uno de los niveles de desempeño. No tiene estado propio: edita la pregunta que le pasan.
//
// Contrato:
//   RubricaEditor({ pregunta, onChange, niveles, matrices })
//     pregunta   PreguntaForm (abierta). Los puntos de la pregunta están en `pregunta.puntajeMaximo` y se reparten entre los
//                criterios según su `peso` (`puntosPorCriterio`): acá solo se MUESTRA lo que le toca a cada uno.
//     onChange   se llama con la pregunta completa ya modificada (criterios nuevos, quitados, editados, matriz aplicada).
//     niveles    escala de niveles del examen (`datos.niveles`): se usa para armar un criterio nuevo.
//     matrices   matrices de rúbrica del docente (puede ser []: sin matrices no se muestra el selector).

import type { MatrizRubrica } from '@/lib/api';
import { aplicarMatriz, criterioVacio, formatearPuntos, puntajeEfectivoDe, puntosPorCriterio } from '@/lib/examen-form';
import type { CriterioForm, NivelForm, PreguntaForm } from '@/lib/examen-form';

export interface RubricaEditorProps {
  pregunta: PreguntaForm;
  onChange: (p: PreguntaForm) => void;
  niveles: NivelForm[];
  matrices: MatrizRubrica[];
}

export function RubricaEditor({ pregunta: p, onChange, niveles, matrices }: RubricaEditorProps) {
  const puntos = puntosPorCriterio(p);
  const hayPuntos = puntajeEfectivoDe(p) > 0;

  function cambiarCriterio(ci: number, cambio: (c: CriterioForm) => CriterioForm) {
    onChange({ ...p, criterios: p.criterios.map((c, i) => (i === ci ? cambio(c) : c)) });
  }

  function actualizarCriterio(ci: number, campo: 'nombre' | 'descripcion' | 'peso', valor: string) {
    cambiarCriterio(ci, (c) => ({ ...c, [campo]: valor }));
  }

  function alternarDetalleNiveles(ci: number) {
    cambiarCriterio(ci, (c) => ({ ...c, detallar: !c.detallar }));
  }

  function actualizarNivelCriterio(ci: number, ni: number, descripcion: string) {
    cambiarCriterio(ci, (c) => ({ ...c, niveles: c.niveles.map((n, nIdx) => (nIdx === ni ? { ...n, descripcion } : n)) }));
  }

  function agregarCriterio() {
    onChange({ ...p, criterios: [...p.criterios, criterioVacio(niveles)] });
  }

  function quitarCriterio(ci: number) {
    onChange({ ...p, criterios: p.criterios.filter((_, i) => i !== ci) });
  }

  function usarMatriz(matrizId: string) {
    const matriz = matrices.find((m) => m.id === matrizId);
    if (matriz) onChange(aplicarMatriz(p, matriz));
  }

  return (
    <div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
        Rúbrica: un criterio por fila, con su peso. La IA evalúa la respuesta contra estos criterios y los puntos de la pregunta se
        reparten entre ellos según el peso de cada uno.
      </div>
      {matrices.length > 0 && (
        <select defaultValue="" onChange={(e) => e.target.value && usarMatriz(e.target.value)} style={{ marginBottom: 14 }}>
          <option value="">Partir de una matriz existente…</option>
          {matrices.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre}
            </option>
          ))}
        </select>
      )}

      {p.criterios.map((c, ci) => (
        <div key={ci} style={{ marginBottom: 12 }}>
          <div className="criterio-row" style={{ gridTemplateColumns: '2fr 3fr 90px auto auto', alignItems: 'center' }}>
            <input placeholder="Criterio (ej: Claridad del argumento)" value={c.nombre} onChange={(e) => actualizarCriterio(ci, 'nombre', e.target.value)} />
            <input placeholder="Qué se espera para cumplirlo" value={c.descripcion} onChange={(e) => actualizarCriterio(ci, 'descripcion', e.target.value)} />
            <input
              type="number"
              min="0"
              step="any"
              placeholder="Peso"
              aria-label={`Peso del criterio ${ci + 1}`}
              value={c.peso}
              onChange={(e) => actualizarCriterio(ci, 'peso', e.target.value)}
            />
            <span className="muted" style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              = {hayPuntos && puntos[ci] > 0 ? formatearPuntos(puntos[ci]) : '—'} pts
            </span>
            <button type="button" className="btn btn-secondary" onClick={() => quitarCriterio(ci)} disabled={p.criterios.length === 1}>
              Quitar
            </button>
          </div>
          <button
            type="button"
            onClick={() => alternarDetalleNiveles(ci)}
            style={{ background: 'none', border: 0, padding: '4px 0', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit', fontSize: 13 }}
          >
            {c.detallar ? 'Ocultar el detalle por nivel' : 'Detallar qué implica cada nivel (opcional)'}
          </button>
          {c.detallar &&
            c.niveles.map((n, ni) => (
              <div key={ni} className="nivel-row" style={{ marginTop: 8, marginBottom: 0 }}>
                <div className="nivel-label">
                  {n.orden}. {n.nombre}
                </div>
                <input
                  placeholder={`Qué implica el nivel "${n.nombre}" acá`}
                  value={n.descripcion}
                  onChange={(e) => actualizarNivelCriterio(ci, ni, e.target.value)}
                />
              </div>
            ))}
        </div>
      ))}
      <button type="button" className="btn btn-secondary" onClick={agregarCriterio}>
        + Agregar criterio
      </button>
    </div>
  );
}
