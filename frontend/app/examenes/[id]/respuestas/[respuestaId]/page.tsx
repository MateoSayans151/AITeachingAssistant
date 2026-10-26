'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useConfirmar } from '@/app/components/Confirmar';
import {
  ApiError,
  ExplicacionVara,
  Pregunta,
  RespuestaExamen,
  explicarVaraRespuesta,
  getRespuestaExamen,
  listRespuestasPorExamen,
  recorregirRespuestaExamen,
  revisarRespuestaExamen,
} from '@/lib/api';
import { RespuestaDelAlumno } from '@/app/components/RespuestaDelAlumno';
import { navegacion } from '@/lib/navegacion-respuestas';
import { formatearNota, plural } from '@/lib/texto';

const TIPO_EVENTO_LABEL: Record<string, string> = {
  salida_pantalla_completa: 'Salió de pantalla completa',
  cambio_pestana: 'Cambió de pestaña o ventana',
  pegado: 'Pegó texto',
};

/** De la nota sugerida a la final: qué regla de vara se aplicó y qué decidió el docente. */
function VaraCard({ explicacion }: { explicacion: ExplicacionVara }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title" style={{ marginBottom: 8 }}>
        ¿Por qué esta nota?
      </div>
      <p>{explicacion.explicacion}</p>
      {explicacion.historial.length > 0 && (
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          {explicacion.historial.map((h) => (
            <li key={h.ajusteId} className="muted">
              {new Date(h.creadoEn).toLocaleString('es-AR')} — {h.descripcion}: {h.notaBase} → {h.notaDespues}
              {h.estado !== 'activo' && ` (${h.estado})`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Señales de integridad del intento: información para el criterio del docente, no afectan la nota. */
function IntegridadCard({ integridad }: { integridad: NonNullable<RespuestaExamen['integridad']> }) {
  const hora = (iso: string) => new Date(iso).toLocaleString('es-AR');
  const duracionMin =
    integridad.entregadoEn ? Math.round((new Date(integridad.entregadoEn).getTime() - new Date(integridad.inicioEn).getTime()) / 60000) : null;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title" style={{ marginBottom: 8 }}>
        Señales durante el examen
      </div>
      <p className="muted" style={{ marginBottom: 8 }}>
        Empezó {hora(integridad.inicioEn)}
        {duracionMin !== null && ` · duró ${duracionMin} min`}
        {integridad.estado === 'vencido' && ' · se terminó el tiempo: se entregó lo último autoguardado'}
      </p>
      {integridad.eventos.length === 0 ? (
        <p className="muted">
          {integridad.consentimientoEn ? 'Sin señales registradas.' : 'Este examen se rindió sin monitoreo.'}
        </p>
      ) : (
        <ul style={{ paddingLeft: 20 }}>
          {integridad.eventos.map((e, i) => (
            <li key={i}>
              {hora(e.ocurridoEn)} — {TIPO_EVENTO_LABEL[e.tipo] ?? e.tipo}
              {e.detalle ? ` (${e.detalle})` : ''}
            </li>
          ))}
        </ul>
      )}
      <p className="muted" style={{ marginTop: 8 }}>
        Son señales de comportamiento, no una prueba: no detectan, por ejemplo, el uso de un segundo dispositivo. No modifican la nota.
      </p>
    </div>
  );
}

/** Puntaje máximo de la pregunta como número (viene como string de Prisma Decimal); null si no se pudo leer. */
function puntajeMaximoDe(pregunta?: Pregunta): number | null {
  const max = pregunta ? Number(pregunta.puntajeMaximo) : NaN;
  return Number.isFinite(max) ? max : null;
}

export default function DetalleRespuestaExamenPage() {
  const params = useParams<{ id: string; respuestaId: string }>();
  const router = useRouter();
  const confirmar = useConfirmar();

  const [respuesta, setRespuesta] = useState<RespuestaExamen | null>(null);
  // Las demás respuestas del examen: para "Anterior / Siguiente" y para pasar a la próxima por revisar.
  const [lista, setLista] = useState<RespuestaExamen[]>([]);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [explicacionVara, setExplicacionVara] = useState<ExplicacionVara | null>(null);
  const [notasFinales, setNotasFinales] = useState<Record<string, string>>({});
  const [notasInvalidas, setNotasInvalidas] = useState<Record<string, boolean>>({});
  const [feedbackFinal, setFeedbackFinal] = useState('');
  const [loading, setLoading] = useState(false);
  const [recorrigiendo, setRecorrigiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setErrorCarga(null);
    getRespuestaExamen(params.id, params.respuestaId)
      .then((r) => {
        if (cancelado) return;
        setRespuesta(r);
        setFeedbackFinal(r.feedbackGeneralFinal ?? r.feedbackGeneralSugerido ?? '');
        setNotasFinales(
          Object.fromEntries(
            r.respuestasPorPregunta.map((rp) => [rp.preguntaId, String(rp.notaFinal ?? rp.notaSugerida)]),
          ),
        );
      })
      .catch((err) => {
        if (cancelado) return;
        setErrorCarga(
          err instanceof ApiError && err.status === 404
            ? 'No encontramos esta respuesta. Puede que ya no exista.'
            : 'No se pudo cargar la respuesta. Probá de nuevo en un rato.',
        );
      });
    explicarVaraRespuesta(params.id, params.respuestaId).then(setExplicacionVara).catch(() => setExplicacionVara(null));
    // Si la lista no carga, la pantalla anda igual: solo faltan los atajos para pasar a la siguiente.
    listRespuestasPorExamen(params.id)
      .then((l) => !cancelado && setLista(l))
      .catch(() => !cancelado && setLista([]));
    return () => {
      cancelado = true;
    };
  }, [params.id, params.respuestaId]);

  if (errorCarga) {
    return (
      <div className="page">
        <div className="error-box">{errorCarga}</div>
        <Link href={`/examenes/${params.id}/respuestas`} className="btn btn-secondary">
          Volver a las respuestas
        </Link>
      </div>
    );
  }

  if (!respuesta) {
    return (
      <div className="page">
        <p className="muted">Cargando…</p>
      </div>
    );
  }

  const actual = respuesta;
  const preguntasPorId = new Map((respuesta.examen?.preguntas ?? []).map((p) => [p.id, p]));
  // Cantidad de niveles de la escala de ESTE examen (de 3 a 7): si el detalle no trajera la escala, se muestra solo "nivel X".
  const cantidadNiveles = Array.isArray(respuesta.examen?.niveles) ? respuesta.examen.niveles.length : 0;
  // La IA todavía no corrigió: no hay nota ni feedback sugeridos para aceptar.
  const sinCorregir = respuesta.estado === 'pendiente_correccion';
  const nav = navegacion(lista, params.respuestaId);
  const urlLista = `/examenes/${params.id}/respuestas`;
  const urlDe = (id: string) => `${urlLista}/${id}`;
  /** Al terminar una revisión se sigue con la próxima que espera; si no queda ninguna, se vuelve al listado. */
  const seguir = () => router.push(nav.siguienteParaRevisarId ? urlDe(nav.siguienteParaRevisarId) : urlLista);
  const escalaMax = respuesta.examen?.escalaMax;
  const estadoTexto = sinCorregir
    ? 'La IA todavía no la corrigió'
    : respuesta.estadoRevision === 'aceptada'
      ? 'Aceptada'
      : respuesta.estadoRevision === 'editada'
        ? 'Editada por vos'
        : 'Para revisar';

  async function handleAceptar() {
    setLoading(true);
    setError(null);
    try {
      await revisarRespuestaExamen(params.id, params.respuestaId, { estadoRevision: 'aceptada' });
      seguir();
    } catch (err) {
      setError('No se pudo confirmar la corrección.');
    } finally {
      setLoading(false);
    }
  }

  async function handleGuardarEdicion() {
    // Antes de mandar nada: cada nota tiene que ser un número entre 0 y el puntaje máximo de su pregunta.
    const problemas: string[] = [];
    const invalidas: Record<string, boolean> = {};
    const overridesPorPregunta: { preguntaId: string; notaFinal: number }[] = [];
    actual.respuestasPorPregunta.forEach((rp, i) => {
      const crudo = (notasFinales[rp.preguntaId] ?? '').trim();
      const nota = crudo === '' ? NaN : Number(crudo);
      const max = puntajeMaximoDe(preguntasPorId.get(rp.preguntaId));
      if (!Number.isFinite(nota)) {
        problemas.push(`la pregunta ${i + 1} necesita un número`);
        invalidas[rp.preguntaId] = true;
      } else if (nota < 0 || (max !== null && nota > max)) {
        problemas.push(max !== null ? `la pregunta ${i + 1} tiene que estar entre 0 y ${max}` : `la pregunta ${i + 1} no puede ser negativa`);
        invalidas[rp.preguntaId] = true;
      } else {
        overridesPorPregunta.push({ preguntaId: rp.preguntaId, notaFinal: nota });
      }
    });
    setNotasInvalidas(invalidas);
    if (problemas.length > 0) {
      setError(`No se guardó. Revisá las notas finales: ${problemas.join('; ')}.`);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Redondeo a 2 decimales para que la suma de notas con decimales no arrastre ruido (0.1 + 0.2).
      const notaTotalFinal = Math.round(overridesPorPregunta.reduce((sum, o) => sum + o.notaFinal, 0) * 100) / 100;
      await revisarRespuestaExamen(params.id, params.respuestaId, {
        estadoRevision: 'editada',
        notaTotalFinal,
        feedbackGeneralFinal: feedbackFinal,
        overridesPorPregunta,
      });
      seguir();
    } catch (err) {
      setError('No se pudo guardar la edición.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRecorregir() {
    // Si el docente ya la revisó, correr la IA de nuevo pisa su revisión: hay que avisarle antes.
    if (actual.estadoRevision !== 'pendiente') {
      const confirmado = await confirmar({
        titulo: '¿Volver a correr la IA?',
        mensaje: `Esta respuesta ya está ${actual.estadoRevision === 'aceptada' ? 'aceptada' : 'editada'}. Si volvés a correr la IA se pierde tu revisión: la nota final y el feedback que tenías se reemplazan por una nueva sugerencia de la IA y la respuesta vuelve a quedar para revisar.`,
        textoConfirmar: 'Volver a correrla',
        peligrosa: true,
      });
      if (!confirmado) return;
    }
    setRecorrigiendo(true);
    setError(null);
    try {
      const actualizada = await recorregirRespuestaExamen(params.id, params.respuestaId);
      setRespuesta((prev) => (prev ? { ...prev, ...actualizada, examen: prev.examen } : prev));
      setFeedbackFinal(actualizada.feedbackGeneralSugerido ?? '');
      setNotasFinales(
        Object.fromEntries(actualizada.respuestasPorPregunta.map((rp) => [rp.preguntaId, String(rp.notaSugerida)])),
      );
      setNotasInvalidas({});
      explicarVaraRespuesta(params.id, params.respuestaId).then(setExplicacionVara).catch(() => setExplicacionVara(null));
    } catch (err) {
      setError('La IA no pudo corregir esta respuesta. Probá de nuevo en un rato.');
    } finally {
      setRecorrigiendo(false);
    }
  }

  return (
    <div className="page">
      <nav className="nav-respuestas" aria-label="Moverte entre las respuestas del examen">
        <Link href={urlLista} className="btn btn-ghost">
          ← Todas las respuestas
        </Link>
        <span className="nav-respuestas-pasos">
          {nav.anteriorId ? (
            <Link href={urlDe(nav.anteriorId)} className="btn btn-secondary">
              ← Anterior
            </Link>
          ) : (
            <span className="btn btn-secondary" aria-disabled="true" style={{ opacity: 0.45 }}>
              ← Anterior
            </span>
          )}
          {nav.siguienteId ? (
            <Link href={urlDe(nav.siguienteId)} className="btn btn-secondary">
              Siguiente →
            </Link>
          ) : (
            <span className="btn btn-secondary" aria-disabled="true" style={{ opacity: 0.45 }}>
              Siguiente →
            </span>
          )}
        </span>
      </nav>

      <header className="page-header">
        <div className="eyebrow">{nav.posicion ? `Respuesta ${nav.posicion} de ${nav.total}` : 'Respuesta del alumno'}</div>
        <h1>{respuesta.alumno?.nombre ?? 'Alumno'}</h1>
        <p className="muted">
          {estadoTexto}
          {!sinCorregir && respuesta.notaTotalSugerida !== null && (
            <>
              {' · '}
              La IA sugiere <strong>{formatearNota(respuesta.notaTotalSugerida)}</strong>
              {escalaMax ? ` de ${formatearNota(escalaMax)}` : ''}
            </>
          )}
          {nav.restantesParaRevisar > 0 && ` · ${plural(nav.restantesParaRevisar, 'más por revisar', 'más por revisar')}`}
        </p>
      </header>

      {sinCorregir && (
        <div className="error-box" role="status">
          <strong>La IA todavía no corrigió esta respuesta.</strong> Todavía no hay nota ni feedback sugeridos: usá “Corregir con IA” para
          pedirla de nuevo.
        </div>
      )}

      {explicacionVara && explicacionVara.historial.length > 0 && <VaraCard explicacion={explicacionVara} />}

      {/* Sin monitoreo y sin señales no hay nada que contarle al docente: se muestra solo si el examen las registraba. */}
      {respuesta.integridad && (respuesta.integridad.eventos.length > 0 || respuesta.integridad.consentimientoEn) && (
        <IntegridadCard integridad={respuesta.integridad} />
      )}

      {respuesta.respuestasPorPregunta.map((rp, i) => {
        const pregunta = preguntasPorId.get(rp.preguntaId);
        const puntajeMaximo = puntajeMaximoDe(pregunta);
        return (
          <div key={rp.preguntaId} className="card" style={{ marginBottom: 16 }}>
            <div className="card-title" style={{ marginBottom: 12, whiteSpace: 'pre-wrap' }}>
              {i + 1}. {pregunta?.enunciado ?? rp.preguntaId}
            </div>

            <RespuestaDelAlumno pregunta={pregunta} contenido={rp.contenidoRespuesta} correcta={rp.correcta} />

            {rp.notaPorCriterio && rp.notaPorCriterio.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                {rp.notaPorCriterio.map((c) => (
                  <div key={c.criterioId} style={{ marginBottom: 8 }}>
                    <strong>
                      {c.nombre}: nivel {c.nivelSugerido}{cantidadNiveles > 0 ? `/${cantidadNiveles}` : ''} — {formatearNota(c.notaSugerida)} pts
                    </strong>
                    <div className="muted" style={{ fontSize: 14 }}>
                      {c.comentario}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="field" style={{ maxWidth: 220, marginBottom: 0 }}>
              <label htmlFor={`nota-${rp.preguntaId}`}>
                Nota final (editable{puntajeMaximo !== null ? `, de 0 a ${puntajeMaximo}` : ''})
              </label>
              <input
                id={`nota-${rp.preguntaId}`}
                type="number"
                step="0.1"
                min={0}
                max={puntajeMaximo ?? undefined}
                value={notasFinales[rp.preguntaId] ?? ''}
                aria-invalid={notasInvalidas[rp.preguntaId] ? true : undefined}
                onChange={(e) => {
                  setNotasFinales((prev) => ({ ...prev, [rp.preguntaId]: e.target.value }));
                  setNotasInvalidas((prev) => ({ ...prev, [rp.preguntaId]: false }));
                }}
              />
            </div>
          </div>
        );
      })}

      <div className="field">
        <label htmlFor="feedback">Feedback general para el alumno (editable)</label>
        <textarea id="feedback" value={feedbackFinal} onChange={(e) => setFeedbackFinal(e.target.value)} style={{ minHeight: 160 }} />
      </div>

      {respuesta.notaConVara !== null && respuesta.estadoRevision === 'pendiente' && (
        <p className="muted" style={{ marginBottom: 12 }}>
          Esta respuesta tiene nota con vara ({respuesta.notaConVara}). Aceptar la sugerencia la confirma; guardar tu edición define la nota a
          partir de los puntajes por pregunta de arriba y deja de lado la vara.
        </p>
      )}

      {/* Los errores de las acciones van pegados a los botones: es donde el docente está mirando cuando hace clic. */}
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}

      <div className="barra-acciones">
        <button
          className="btn btn-primary"
          onClick={handleAceptar}
          disabled={loading || recorrigiendo || sinCorregir}
          title={sinCorregir ? 'La IA todavía no corrigió esta respuesta: no hay sugerencia para aceptar.' : undefined}
        >
          {loading ? 'Guardando…' : nav.siguienteParaRevisarId ? 'Aceptar y pasar a la siguiente' : 'Aceptar sugerencia de la IA'}
        </button>
        <button className="btn btn-secondary" onClick={handleGuardarEdicion} disabled={loading || recorrigiendo}>
          {nav.siguienteParaRevisarId ? 'Guardar mis cambios y seguir' : 'Guardar mis cambios'}
        </button>
        <button className="btn btn-ghost" onClick={handleRecorregir} disabled={loading || recorrigiendo}>
          {recorrigiendo ? (sinCorregir ? 'Corrigiendo…' : 'Re-corrigiendo…') : sinCorregir ? 'Corregir con IA' : 'Volver a correr la IA'}
        </button>
      </div>
      {respuesta.modeloIa && (
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Sugerencia generada por la IA ({respuesta.modeloIa}).
        </p>
      )}
    </div>
  );
}
