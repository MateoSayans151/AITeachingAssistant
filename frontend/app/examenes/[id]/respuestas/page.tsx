'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { LiberarNotasButton } from '@/app/components/LiberarNotasButton';
import {
  Examen,
  RespuestaExamen,
  bulkAceptarRespuestas,
  corregirPendientes,
  getExamen,
  listRespuestasPorExamen,
} from '@/lib/api';

// Mientras haya respuestas sin corregir por la IA se refresca la lista sola, pero no para siempre: si a los 3 minutos
// siguen trabadas se frena y se avisa (probablemente falló la IA y hay que reintentar a mano).
const INTERVALO_SONDEO_MS = 8_000;
const TOPE_SONDEO_MS = 3 * 60_000;

type Categoria = 'sin_corregir' | 'para_revisar' | 'aceptada' | 'editada';

/** En qué punto del circuito está una respuesta: la IA todavía no corrigió, espera al docente o el docente ya la revisó. */
function categoriaDe(r: RespuestaExamen): Categoria {
  if (r.estado === 'pendiente_correccion') return 'sin_corregir';
  if (r.estadoRevision === 'aceptada') return 'aceptada';
  if (r.estadoRevision === 'editada') return 'editada';
  return 'para_revisar';
}

/** La IA ya sugirió nota y el docente todavía no la revisó: lo único que se puede aceptar en bloque. */
function esAceptableEnBloque(r: RespuestaExamen): boolean {
  return r.estado === 'corregido' && r.estadoRevision === 'pendiente';
}

const ESTADO_UI: Record<Categoria, { label: string; className: string; style?: CSSProperties; title: string }> = {
  sin_corregir: {
    label: 'IA sin corregir',
    className: 'badge',
    style: { background: 'var(--color-error-soft)', color: 'var(--color-error)' },
    title: 'La IA todavía no corrigió esta respuesta: no hay nota sugerida.',
  },
  para_revisar: {
    label: 'Para revisar',
    className: 'badge badge-pendiente',
    title: 'La IA ya sugirió una nota y falta tu revisión.',
  },
  aceptada: { label: 'Aceptada', className: 'badge badge-revisado', title: 'Aceptaste la sugerencia de la IA.' },
  editada: { label: 'Editada', className: 'badge badge-corregido', title: 'Editaste la corrección de la IA.' },
};

function exportarCsv(examen: Examen, respuestas: RespuestaExamen[]) {
  const filas = [
    ['Alumno', 'Email', 'Nota sugerida', 'Nota con vara', 'Nota final', 'Estado', 'Cierre del intento', 'Señales de integridad'],
    ...respuestas.map((r) => [
      r.alumno?.nombre ?? '',
      r.alumno?.email ?? '',
      r.notaTotalSugerida ?? '',
      r.notaConVara ?? '',
      r.notaTotalFinal ?? '',
      ESTADO_UI[categoriaDe(r)].label,
      r.intento ? (r.intento.estado === 'vencido' ? 'Por vencimiento' : 'Entregado') : '',
      r.intento?.eventos ?? '',
    ]),
  ];
  const csv = filas.map((fila) => fila.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${examen.titulo.replace(/\s+/g, '_')}_respuestas.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function RespuestasExamenPage() {
  const params = useParams<{ id: string }>();
  const [examen, setExamen] = useState<Examen | null>(null);
  const [respuestas, setRespuestas] = useState<RespuestaExamen[] | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aceptando, setAceptando] = useState(false);
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [sondeoAgotado, setSondeoAgotado] = useState(false);
  // Se incrementa al pedir otra corrección para que el sondeo arranque con su ventana de 3 minutos de nuevo.
  const [sondeoVuelta, setSondeoVuelta] = useState(0);

  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelado = false;
    Promise.all([getExamen(params.id), listRespuestasPorExamen(params.id)])
      .then(([e, r]) => {
        if (cancelado) return;
        setExamen(e);
        setRespuestas(r);
      })
      .catch(() => {
        if (!cancelado) setErrorCarga('No se pudieron cargar las respuestas del examen. Probá de nuevo en un rato.');
      });
    return () => {
      cancelado = true;
    };
  }, [params.id]);

  async function refrescar() {
    const r = await listRespuestasPorExamen(params.id);
    if (montado.current) setRespuestas(r);
  }

  const hayPorCorregir = respuestas?.some((r) => r.estado === 'pendiente_correccion') ?? false;

  // Sondeo: mientras haya respuestas sin corregir, refresca la lista cada ~8 s y se corta a los ~3 min.
  useEffect(() => {
    if (!hayPorCorregir || sondeoAgotado) return;
    let enCurso = false;
    const intervalo = setInterval(() => {
      if (enCurso) return;
      enCurso = true;
      refrescar()
        .catch(() => {
          // Falla transitoria: se conserva la lista que ya se ve y se reintenta en el próximo ciclo.
        })
        .finally(() => {
          enCurso = false;
        });
    }, INTERVALO_SONDEO_MS);
    const tope = setTimeout(() => setSondeoAgotado(true), TOPE_SONDEO_MS);
    return () => {
      clearInterval(intervalo);
      clearTimeout(tope);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refrescar solo depende de params.id
  }, [hayPorCorregir, sondeoAgotado, sondeoVuelta, params.id]);

  // Cuando ya no queda nada por corregir se limpian el aviso y el estado del sondeo.
  useEffect(() => {
    if (!hayPorCorregir) {
      setSondeoAgotado(false);
      setAviso(null);
    }
  }, [hayPorCorregir]);

  async function handleBulkAceptar() {
    if (!respuestas) return;
    const aceptables = respuestas.filter(esAceptableEnBloque);
    if (aceptables.length === 0) return;
    const conSenales = aceptables.filter((r) => (r.intento?.eventos ?? 0) > 0).length;

    const sugerencias = aceptables.length === 1 ? '1 sugerencia' : `${aceptables.length} sugerencias`;
    let mensaje = `Vas a aceptar ${sugerencias} de la IA tal cual: la nota sugerida pasa a ser la nota final, sin que las revises una por una.`;
    mensaje +=
      conSenales > 0
        ? `\n\n${conSenales === 1 ? '1 de esas respuestas tiene' : `${conSenales} de esas respuestas tienen`} señales de integridad (salida de pantalla completa, cambio de pestaña o pegado de texto). Si cancelás, podés revisarlas una por una desde cada detalle.\n\n¿Las aceptás igual?`
        : '\n\nNinguna tiene señales de integridad.\n\n¿Querés aceptarlas?';
    if (!window.confirm(mensaje)) return;

    setAceptando(true);
    setErrorAccion(null);
    setAviso(null);
    try {
      await bulkAceptarRespuestas(params.id);
    } catch {
      setErrorAccion('No se pudo aceptar en bloque. Intentá de nuevo.');
      setAceptando(false);
      return;
    }
    try {
      await refrescar();
    } catch {
      setErrorAccion('Se aceptaron las sugerencias, pero no pudimos actualizar la lista. Recargá la página para verlas.');
    } finally {
      if (montado.current) setAceptando(false);
    }
  }

  async function handleCorregirPendientes() {
    setCorrigiendo(true);
    setErrorAccion(null);
    setAviso(null);
    try {
      const pendientes = (await corregirPendientes(params.id))?.pendientes;
      if (!montado.current) return;
      if (typeof pendientes === 'number' && pendientes > 0) {
        setAviso(`Mandamos ${pendientes === 1 ? '1 respuesta' : `${pendientes} respuestas`} a corregir con la IA. Puede tardar unos minutos.`);
      }
      // Nueva ventana de sondeo para ver cómo van pasando a "Para revisar".
      setSondeoAgotado(false);
      setSondeoVuelta((v) => v + 1);
      await refrescar();
    } catch {
      setErrorAccion('No se pudo iniciar la corrección con la IA. Intentá de nuevo.');
    } finally {
      if (montado.current) setCorrigiendo(false);
    }
  }

  if (errorCarga) {
    return (
      <div className="page">
        <div className="error-box">{errorCarga}</div>
        <Link href={`/examenes/${params.id}`} className="btn btn-secondary">
          Volver al examen
        </Link>
      </div>
    );
  }

  if (!examen || !respuestas) {
    return (
      <div className="page">
        <p className="muted">Cargando…</p>
      </div>
    );
  }

  const sinCorregir = respuestas.filter((r) => categoriaDe(r) === 'sin_corregir').length;
  const paraRevisar = respuestas.filter((r) => categoriaDe(r) === 'para_revisar').length;
  const revisadas = respuestas.length - sinCorregir - paraRevisar;
  const aceptables = respuestas.filter(esAceptableEnBloque).length;
  const ocupado = aceptando || corrigiendo;

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">{examen.titulo}</div>
        <h1>Respuestas ({respuestas.length})</h1>
      </header>

      {respuestas.length > 0 && (
        <p style={{ marginBottom: 16 }}>
          <strong>{sinCorregir}</strong> sin corregir por la IA · <strong>{paraRevisar}</strong> para revisar · <strong>{revisadas}</strong>{' '}
          {revisadas === 1 ? 'revisada' : 'revisadas'}
        </p>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          onClick={handleBulkAceptar}
          disabled={ocupado || aceptables === 0}
          title={aceptables === 0 ? 'No hay sugerencias de la IA esperando tu revisión.' : undefined}
        >
          {aceptando ? 'Aceptando…' : `Aceptar ${aceptables === 1 ? '1 sugerencia' : `${aceptables} sugerencias`} de la IA`}
        </button>
        {sinCorregir > 0 && (
          <button className="btn btn-secondary" onClick={handleCorregirPendientes} disabled={ocupado}>
            {corrigiendo ? 'Enviando…' : 'Corregir pendientes con IA'}
          </button>
        )}
        <button className="btn btn-secondary" onClick={() => exportarCsv(examen, respuestas)} disabled={respuestas.length === 0}>
          Exportar CSV
        </button>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-title" style={{ marginBottom: 8 }}>
          Notas para los alumnos
        </div>
        <LiberarNotasButton
          examenId={examen.id}
          feedbackModo={examen.feedbackModo}
          liberadoEn={examen.feedbackLiberadoEn}
          onChange={(actualizado) => setExamen((prev) => (prev ? { ...prev, feedbackLiberadoEn: actualizado.feedbackLiberadoEn } : prev))}
        />
      </div>

      {errorAccion && (
        <div className="error-box" role="alert">
          {errorAccion}
        </div>
      )}

      {hayPorCorregir &&
        (sondeoAgotado ? (
          <div className="error-box">
            Algunas respuestas siguen sin corregir y dejamos de actualizar la lista solas. Probá de nuevo con “Corregir pendientes con IA” o
            volvé a entrar más tarde.
          </div>
        ) : (
          <p className="muted" style={{ marginBottom: 16 }}>
            {aviso ?? 'Hay respuestas esperando la corrección de la IA.'} La lista se actualiza sola.
          </p>
        ))}

      {respuestas.length === 0 && <div className="empty-state">Todavía no hay respuestas para este examen.</div>}

      {respuestas.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Alumno</th>
                <th>Nota sugerida</th>
                <th>Con vara</th>
                <th>Nota final</th>
                <th>Estado</th>
                <th>Integridad</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {respuestas.map((r) => {
                const categoria = categoriaDe(r);
                const estado = ESTADO_UI[categoria];
                return (
                  <tr key={r.id}>
                    <td>{r.alumno?.nombre}</td>
                    <td title={categoria === 'sin_corregir' ? 'La IA todavía no corrigió esta respuesta, así que no hay nota sugerida.' : undefined}>
                      {categoria === 'sin_corregir' ? '—' : (r.notaTotalSugerida ?? '—')}
                    </td>
                    <td>{r.notaConVara ?? '—'}</td>
                    <td>{r.notaTotalFinal ?? '—'}</td>
                    <td>
                      <span className={estado.className} style={estado.style} title={estado.title}>
                        {estado.label}
                      </span>
                    </td>
                    <td>
                      {r.intento?.estado === 'vencido' && <span className="badge badge-pendiente" title="Se terminó el tiempo: se entregó lo último autoguardado">Por vencimiento</span>}{' '}
                      {r.intento && r.intento.eventos > 0 ? `${r.intento.eventos} señal${r.intento.eventos === 1 ? '' : 'es'}` : r.intento ? 'Sin señales' : '—'}
                    </td>
                    <td>
                      <Link href={`/examenes/${examen.id}/respuestas/${r.id}`} className="btn btn-secondary">
                        Ver detalle
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
