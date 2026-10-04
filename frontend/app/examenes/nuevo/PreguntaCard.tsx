'use client';

// PreguntaCard: UNA pregunta del examen. Selector de tipo, enunciado, puntos de la pregunta (para todos los tipos), y el
// cuerpo según el tipo: opciones (opción múltiple / casillas), verdadero o falso, numérica, relacionar pares y, para las
// abiertas, la rúbrica (<RubricaEditor/>). No tiene estado propio: edita la pregunta que le pasan.
//
// Contrato:
//   PreguntaCard({ indice, pregunta, onChange, onQuitar, cantidadPreguntas, niveles, matrices })
//     indice             posición de la pregunta, base 0 (se muestra como "indice + 1." y nombra el grupo de radios).
//     pregunta           PreguntaForm.
//     onChange(p)        se llama con la pregunta completa ya modificada (el padre la reemplaza en su lista).
//     onQuitar()         el docente apretó "Quitar pregunta".
//     cantidadPreguntas  cuántas preguntas hay en total: con una sola, "Quitar pregunta" queda deshabilitado.
//     niveles            escala de niveles del examen (`datos.niveles`): la usan las preguntas abiertas para sus criterios.
//     matrices           matrices de rúbrica del docente (se pasan a <RubricaEditor/>).

import type { MatrizRubrica, TipoPregunta } from '@/lib/api';
import { TIPOS_AUTOCORREGIBLES } from '@/lib/api';
import { preguntaVacia } from '@/lib/examen-form';
import type { NivelForm, PreguntaForm } from '@/lib/examen-form';
import { RubricaEditor } from './RubricaEditor';

export const TIPOS_LABEL: Record<TipoPregunta, string> = {
  desarrollo: 'Desarrollo',
  resolucion_problema: 'Resolución de problema / cálculo',
  demostracion: 'Demostración',
  analisis_caso: 'Análisis de caso',
  respuesta_corta: 'Respuesta corta',
  numerica: 'Numérica',
  relacionar_pares: 'Relacionar pares',
  opcion_multiple: 'Opción múltiple',
  casillas: 'Casillas (varias correctas)',
  verdadero_falso: 'Verdadero / Falso',
};

export interface PreguntaCardProps {
  indice: number;
  pregunta: PreguntaForm;
  onChange: (p: PreguntaForm) => void;
  onQuitar: () => void;
  cantidadPreguntas: number;
  niveles: NivelForm[];
  matrices: MatrizRubrica[];
}

export function PreguntaCard({ indice, pregunta: p, onChange, onQuitar, cantidadPreguntas, niveles, matrices }: PreguntaCardProps) {
  const cerrada = TIPOS_AUTOCORREGIBLES.includes(p.tipo);

  function actualizar<K extends keyof PreguntaForm>(campo: K, valor: PreguntaForm[K]) {
    onChange({ ...p, [campo]: valor });
  }

  function cambiarTipo(tipo: TipoPregunta) {
    // Al cambiar de tipo se parte de una pregunta vacía y se conserva solo lo común: enunciado y puntos (y si está plegada).
    onChange({ ...preguntaVacia(niveles), tipo, enunciado: p.enunciado, puntajeMaximo: p.puntajeMaximo, plegada: p.plegada });
  }

  function actualizarChoice(oi: number, campo: 'texto' | 'correcta', valor: string | boolean) {
    onChange({
      ...p,
      opcionesChoice: p.opcionesChoice.map((o, oIdx) => {
        if (oIdx !== oi) {
          // opción múltiple: una sola correcta a la vez
          return campo === 'correcta' && valor === true && p.tipo === 'opcion_multiple' ? { ...o, correcta: false } : o;
        }
        return { ...o, [campo]: valor };
      }),
    });
  }

  function agregarChoice() {
    onChange({ ...p, opcionesChoice: [...p.opcionesChoice, { id: String.fromCharCode(97 + p.opcionesChoice.length), texto: '', correcta: false }] });
  }

  function actualizarPar(lado: 'paresIzquierda' | 'paresDerecha', i: number, valor: string) {
    onChange({ ...p, [lado]: p[lado].map((v, vi) => (vi === i ? valor : v)) });
  }

  function agregarPar() {
    onChange({ ...p, paresIzquierda: [...p.paresIzquierda, ''], paresDerecha: [...p.paresDerecha, ''] });
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <strong style={{ alignSelf: 'center' }}>{indice + 1}.</strong>
        <select value={p.tipo} onChange={(e) => cambiarTipo(e.target.value as TipoPregunta)} style={{ flex: 1 }}>
          {Object.entries(TIPOS_LABEL).map(([tipo, label]) => (
            <option key={tipo} value={tipo}>
              {label}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-secondary" onClick={onQuitar} disabled={cantidadPreguntas === 1}>
          Quitar pregunta
        </button>
      </div>

      <div className="field">
        <label>Enunciado</label>
        <textarea value={p.enunciado} onChange={(e) => actualizar('enunciado', e.target.value)} />
      </div>

      <div className="field" style={{ maxWidth: 160 }}>
        <label>Puntaje máximo</label>
        <input type="number" min="0.5" step="0.5" value={p.puntajeMaximo} onChange={(e) => actualizar('puntajeMaximo', e.target.value)} />
      </div>

      {!cerrada && <RubricaEditor pregunta={p} onChange={onChange} niveles={niveles} matrices={matrices} />}

      {(p.tipo === 'opcion_multiple' || p.tipo === 'casillas') && (
        <div>
          {p.opcionesChoice.map((o, oi) => (
            <div key={oi} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
              <input
                type={p.tipo === 'opcion_multiple' ? 'radio' : 'checkbox'}
                name={`correcta-${indice}`}
                checked={o.correcta}
                onChange={(e) => actualizarChoice(oi, 'correcta', e.target.checked)}
              />
              <input placeholder={`Opción ${o.id}`} value={o.texto} onChange={(e) => actualizarChoice(oi, 'texto', e.target.value)} />
            </div>
          ))}
          <button type="button" className="btn btn-secondary" onClick={agregarChoice}>
            + Agregar opción
          </button>
        </div>
      )}

      {p.tipo === 'verdadero_falso' && (
        <div className="field" style={{ maxWidth: 200 }}>
          <label>Respuesta correcta</label>
          <select value={p.vfCorrecta} onChange={(e) => actualizar('vfCorrecta', e.target.value as 'true' | 'false')}>
            <option value="true">Verdadero</option>
            <option value="false">Falso</option>
          </select>
        </div>
      )}

      {p.tipo === 'numerica' && (
        <div style={{ display: 'flex', gap: 16 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Respuesta correcta</label>
            <input type="number" value={p.numRespuestaCorrecta} onChange={(e) => actualizar('numRespuestaCorrecta', e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Tolerancia (+/-)</label>
            <input type="number" min="0" value={p.numTolerancia} onChange={(e) => actualizar('numTolerancia', e.target.value)} />
          </div>
        </div>
      )}

      {p.tipo === 'relacionar_pares' && (
        <div>
          {p.paresIzquierda.map((izq, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
              <input placeholder="Elemento A" value={izq} onChange={(e) => actualizarPar('paresIzquierda', i, e.target.value)} />
              <input placeholder="Corresponde con…" value={p.paresDerecha[i]} onChange={(e) => actualizarPar('paresDerecha', i, e.target.value)} />
            </div>
          ))}
          <button type="button" className="btn btn-secondary" onClick={agregarPar}>
            + Agregar par
          </button>
        </div>
      )}
    </div>
  );
}
