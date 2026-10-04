import type { ReactNode } from 'react';
import type { Pregunta, TipoPregunta } from '@/lib/api';

/**
 * Muestra lo que respondió el alumno, legible para el docente, según el tipo de pregunta.
 *
 * `pregunta.opciones` viene con la clave (es el payload del docente), así que acá se puede mostrar qué era lo
 * correcto. El formato que guarda cada tipo es el de `backend/src/respuestas-examen/correccion-cerradas.util.ts`:
 *  - opcion_multiple: id de la opción elegida; casillas: array de ids.
 *  - verdadero_falso: boolean; numerica: número.
 *  - relacionar_pares: array de pares [izquierda, derecha] (los textos mismos, no ids).
 * Si algo no se puede interpretar (opción borrada, formato raro) no se rompe: se muestra el valor crudo.
 */

const TIPOS_ABIERTOS: TipoPregunta[] = ['desarrollo', 'resolucion_problema', 'demostracion', 'analisis_caso', 'respuesta_corta'];

type OpcionElegible = { id: string; texto: string; correcta?: boolean };

function esOpcionElegible(o: unknown): o is OpcionElegible {
  return typeof o === 'object' && o !== null && typeof (o as OpcionElegible).id === 'string' && typeof (o as OpcionElegible).texto === 'string';
}

function esPar(p: unknown): p is [unknown, unknown] {
  return Array.isArray(p) && p.length === 2;
}

function estaVacio(valor: unknown): boolean {
  return valor === null || valor === undefined || (typeof valor === 'string' && valor.trim() === '');
}

/** Valor tal cual, como texto: strings sin comillas ni `\n` escapados, el resto como JSON indentado. */
function comoTexto(valor: unknown): string {
  if (typeof valor === 'string') return valor;
  if (valor === null || valor === undefined) return '';
  try {
    return JSON.stringify(valor, null, 2);
  } catch {
    return String(valor);
  }
}

function comoLista(valor: unknown): string[] {
  if (estaVacio(valor)) return [];
  if (Array.isArray(valor)) return valor.map(String);
  return [String(valor)];
}

function etiquetaVerdaderoFalso(valor: unknown): string {
  if (valor === true) return 'Verdadero';
  if (valor === false) return 'Falso';
  if (estaVacio(valor)) return '(sin respuesta)';
  return String(valor);
}

function etiquetaNumero(valor: unknown): string {
  if (estaVacio(valor)) return '(sin respuesta)';
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(n)) return String(valor);
  return n.toLocaleString('es-AR', { maximumFractionDigits: 10 });
}

function SinRespuesta() {
  return (
    <p className="muted" style={{ fontStyle: 'italic' }}>
      (sin respuesta)
    </p>
  );
}

function Veredicto({ correcta }: { correcta: boolean }) {
  return (
    <>
      {correcta ? (
        <span className="badge badge-revisado">Correcta</span>
      ) : (
        <span className="badge" style={{ background: 'var(--color-error-soft)', color: 'var(--color-error)' }}>
          Incorrecta
        </span>
      )}
      <span className="muted" style={{ fontSize: 13 }}>
        (corrección automática)
      </span>
    </>
  );
}

function Marca({ ok }: { ok: boolean }) {
  return (
    <span
      role="img"
      aria-label={ok ? 'Coincide' : 'No coincide'}
      title={ok ? 'Coincide' : 'No coincide'}
      style={{ fontWeight: 700, color: ok ? 'var(--color-success)' : 'var(--color-error)' }}
    >
      {ok ? '✓' : '✗'}
    </span>
  );
}

/** Texto libre del alumno: completo, con sus saltos de línea y a tamaño normal de lectura. */
function TextoDelAlumno({ valor }: { valor: unknown }) {
  const texto = comoTexto(valor);
  if (texto.trim() === '') return <SinRespuesta />;
  return (
    <div
      style={{
        background: 'var(--color-neutral-100)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 16px',
        fontSize: 15,
        lineHeight: 1.55,
        color: 'var(--color-text)',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
      }}
    >
      {texto}
    </div>
  );
}

function OpcionesElegidas({ opciones, contenido, multiple }: { opciones: OpcionElegible[]; contenido: unknown; multiple: boolean }) {
  const elegidas = new Set(comoLista(contenido));
  const idsConocidos = new Set(opciones.map((o) => o.id));
  const desconocidas = [...elegidas].filter((id) => !idsConocidos.has(id));

  return (
    <>
      <ul style={{ listStyle: 'none', display: 'grid', gap: 6 }}>
        {opciones.map((o) => {
          const elegida = elegidas.has(o.id);
          const esCorrecta = o.correcta === true;
          return (
            <li
              key={o.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                background: esCorrecta ? 'var(--color-success-soft)' : elegida ? 'var(--color-error-soft)' : '#fff',
              }}
            >
              <span aria-hidden="true">{multiple ? (elegida ? '☑' : '☐') : elegida ? '◉' : '○'}</span>
              <span style={{ flex: 1, fontSize: 15, overflowWrap: 'anywhere' }}>{o.texto}</span>
              {elegida && <span className="tag tag-neutral">Eligió el alumno</span>}
              {esCorrecta && <span className="badge badge-revisado">Correcta</span>}
            </li>
          );
        })}
      </ul>
      {elegidas.size === 0 && (
        <p className="muted" style={{ marginTop: 8, fontStyle: 'italic' }}>
          El alumno no {multiple ? 'marcó ninguna opción' : 'eligió ninguna opción'}.
        </p>
      )}
      {desconocidas.length > 0 && (
        <p className="muted" style={{ marginTop: 8 }}>
          Valor guardado que no coincide con ninguna opción actual: {desconocidas.join(', ')}
        </p>
      )}
    </>
  );
}

function VerdaderoFalso({ opciones, contenido }: { opciones: unknown; contenido: unknown }) {
  const esperada = (opciones as { correcta?: unknown } | null)?.correcta;
  return (
    <p style={{ fontSize: 15 }}>
      Eligió: <strong>{etiquetaVerdaderoFalso(contenido)}</strong>
      {typeof esperada === 'boolean' && (
        <>
          {' · '}Correcta: <strong>{etiquetaVerdaderoFalso(esperada)}</strong>
        </>
      )}
    </p>
  );
}

function Numerica({ opciones, contenido }: { opciones: unknown; contenido: unknown }) {
  const cfg = opciones as { respuestaCorrecta?: unknown; tolerancia?: unknown } | null;
  const tolerancia = Number(cfg?.tolerancia ?? 0);
  return (
    <p style={{ fontSize: 15 }}>
      Ingresó: <strong>{etiquetaNumero(contenido)}</strong>
      {cfg && !estaVacio(cfg.respuestaCorrecta) && (
        <>
          {' · '}Correcta: <strong>{etiquetaNumero(cfg.respuestaCorrecta)}</strong>
          {Number.isFinite(tolerancia) && tolerancia > 0 && <> ± {etiquetaNumero(tolerancia)}</>}
        </>
      )}
    </p>
  );
}

function ParesRelacionados({ opciones, contenido }: { opciones: unknown; contenido: unknown }) {
  const esperadosCrudos = (opciones as { paresCorrectos?: unknown } | null)?.paresCorrectos;
  const esperados = Array.isArray(esperadosCrudos) ? esperadosCrudos.filter(esPar).map(([a, b]) => [String(a), String(b)]) : [];
  const dados = Array.isArray(contenido) ? contenido.filter(esPar).map(([a, b]) => [String(a), String(b)]) : [];

  // Sin clave que comparar (o el valor guardado no es una lista de pares): lo que haya, crudo.
  if (esperados.length === 0 || (!Array.isArray(contenido) && !estaVacio(contenido))) {
    if (dados.length === 0) return <TextoDelAlumno valor={contenido} />;
    return (
      <ul style={{ paddingLeft: 20 }}>
        {dados.map(([izq, der], i) => (
          <li key={i}>
            {izq} → {der}
          </li>
        ))}
      </ul>
    );
  }

  const izquierdasEsperadas = new Set(esperados.map(([izq]) => izq));
  const sobrantes = dados.filter(([izq]) => !izquierdasEsperadas.has(izq));

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            <th>Elemento</th>
            <th>Lo que marcó el alumno</th>
            <th>Correcta</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {esperados.map(([izq, der], i) => {
            const marcado = dados.find(([d]) => d === izq)?.[1];
            return (
              <tr key={i}>
                <td>{izq}</td>
                <td>{marcado ?? <span className="muted">(sin elegir)</span>}</td>
                <td>{der}</td>
                <td>
                  <Marca ok={marcado === der} />
                </td>
              </tr>
            );
          })}
          {sobrantes.map(([izq, der], i) => (
            <tr key={`sobrante-${i}`}>
              <td>{izq}</td>
              <td>{der}</td>
              <td className="muted">—</td>
              <td>
                <Marca ok={false} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RespuestaDelAlumno({
  pregunta,
  contenido,
  correcta,
}: {
  pregunta?: Pregunta;
  /** `contenidoRespuesta` de la respuesta del alumno a esta pregunta. */
  contenido: unknown;
  /** `correcta` calculado por el backend; solo viene en las preguntas autocorregibles ya corregidas. */
  correcta?: boolean;
}) {
  const tipo = pregunta?.tipo;
  let cuerpo: ReactNode;

  if (!pregunta || !tipo || TIPOS_ABIERTOS.includes(tipo)) {
    cuerpo = <TextoDelAlumno valor={contenido} />;
  } else if (tipo === 'opcion_multiple' || tipo === 'casillas') {
    const opciones = Array.isArray(pregunta.opciones) ? pregunta.opciones.filter(esOpcionElegible) : [];
    cuerpo =
      opciones.length > 0 ? (
        <OpcionesElegidas opciones={opciones} contenido={contenido} multiple={tipo === 'casillas'} />
      ) : (
        <TextoDelAlumno valor={contenido} />
      );
  } else if (tipo === 'verdadero_falso') {
    cuerpo = <VerdaderoFalso opciones={pregunta.opciones} contenido={contenido} />;
  } else if (tipo === 'numerica') {
    cuerpo = <Numerica opciones={pregunta.opciones} contenido={contenido} />;
  } else if (tipo === 'relacionar_pares') {
    cuerpo = <ParesRelacionados opciones={pregunta.opciones} contenido={contenido} />;
  } else {
    cuerpo = <TextoDelAlumno valor={contenido} />;
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span className="eyebrow">Respuesta del alumno</span>
        {correcta !== undefined && <Veredicto correcta={correcta} />}
      </div>
      {cuerpo}
    </div>
  );
}
