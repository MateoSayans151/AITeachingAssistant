'use client';

import { TabsExamen } from '@/app/components/TabsExamen';
import { Cargando } from '@/app/components/Cargando';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AvisoModal, CierreProgramadoModal, DuracionModal, TiempoExtraModal } from '@/app/components/ControlTiempo';
import { useConfirmar } from '@/app/components/Confirmar';
import { EnVivo, entregarIntentoAlumno, getEnVivo } from '@/lib/api';
import { mensajeDeError } from '@/lib/errores';
import { haceCuanto, porcentajeAvance, resumenSenales, tiempoRestante, tiempoTranscurrido } from '@/lib/en-vivo';
import { plural } from '@/lib/texto';

// Se consulta al servidor cada pocos segundos mientras la pestaña está a la vista; en segundo plano se frena (no tiene sentido gastar pedidos).
const INTERVALO_MS = 10_000;

export default function EnVivoPage() {
  const params = useParams<{ id: string }>();
  const [datos, setDatos] = useState<EnVivo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actualizando, setActualizando] = useState(false);
  const [ultimaVez, setUltimaVez] = useState<Date | null>(null);
  const [auto, setAuto] = useState(true);
  const montado = useRef(true);
  const confirmar = useConfirmar();
  // Qué diálogo está abierto, y el aviso de lo último que se hizo.
  const [dialogo, setDialogo] = useState<'aviso' | 'cierre' | 'duracion' | null>(null);
  const [extraDe, setExtraDe] = useState<{ intentoId: string; nombre: string } | null>(null);
  const [entregando, setEntregando] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setActualizando(true);
    try {
      const r = await getEnVivo(params.id);
      if (!montado.current) return;
      setDatos(r);
      setUltimaVez(new Date());
      setError(null);
    } catch {
      if (montado.current) setError('No se pudo actualizar el panel. Se reintenta solo.');
    } finally {
      if (montado.current) setActualizando(false);
    }
  }, [params.id]);

  useEffect(() => {
    montado.current = true;
    void cargar();
    return () => {
      montado.current = false;
    };
  }, [cargar]);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void cargar();
    }, INTERVALO_MS);
    const alVolver = () => document.visibilityState === 'visible' && void cargar();
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [auto, cargar]);

  function listo(mensaje: string) {
    setDialogo(null);
    setExtraDe(null);
    setResultado(mensaje);
    void cargar();
  }

  async function entregarAlumno(a: { intentoId: string; nombre: string }) {
    const ok = await confirmar({
      titulo: `¿Entregar el examen de ${a.nombre}?`,
      mensaje: 'Se cierra su examen ahora: se entrega lo último que tenía autoguardado y la IA lo corrige. No puede seguir escribiendo.',
      textoConfirmar: 'Entregar su examen',
      peligrosa: true,
    });
    if (!ok) return;
    setEntregando(a.intentoId);
    setResultado(null);
    try {
      await entregarIntentoAlumno(params.id, a.intentoId);
      setResultado(`Se entregó el examen de ${a.nombre}.`);
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo entregar su examen. Probá de nuevo.'));
    } finally {
      setEntregando(null);
    }
  }

  if (!datos) {
    return <div className="page">{error ? <div className="error-box">{error}</div> : <Cargando variante="pagina" />}</div>;
  }

  const { resumen, alumnos, examen } = datos;
  const cerrado = examen.estado === 'cerrado';

  return (
    <div className="page">
      <header className="page-header">
        <Link href={`/examenes/${params.id}`} className="volver">
          ← Volver al examen
        </Link>
        <div className="eyebrow">En vivo</div>
        <h1>{examen.titulo}</h1>
        <p className="muted">
          Quién está rindiendo ahora y cómo va.{' '}
          {ultimaVez && <>Actualizado {ultimaVez.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.</>}
        </p>
      </header>

      <div className="examen-barra">
        <TabsExamen examenId={params.id} activa="envivo" />
        <div className="examen-barra-acciones">
          <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Actualizar solo
          </label>
          <button type="button" className="btn btn-secondary" onClick={() => void cargar()} disabled={actualizando}>
            {actualizando ? 'Actualizando…' : 'Actualizar ahora'}
          </button>
        </div>
      </div>

      <div className="vivo-acciones" style={{ marginBottom: 'var(--space-3)' }}>
        <button type="button" className="btn btn-secondary" onClick={() => setDialogo('aviso')}>
          Avisar a los alumnos
        </button>
        {examen.modalidad === 'sesion_tiempo' && (
          <button type="button" className="btn btn-secondary" onClick={() => setDialogo('duracion')}>
            Cambiar la duración
          </button>
        )}
        {!cerrado && (
          <button type="button" className="btn btn-secondary" onClick={() => setDialogo('cierre')}>
            {examen.cierreProgramadoEn ? 'Cambiar el cierre automático' : 'Programar cierre automático'}
          </button>
        )}
      </div>

      {error && <div className="error-box">{error}</div>}
      {resultado && (
        <div className="aviso-ok" role="status">
          {resultado}
        </div>
      )}
      {examen.cierreProgramadoEn && !cerrado && (
        <div className="vivo-estado-cierre" role="status">
          <strong>Se cierra solo el {new Date(examen.cierreProgramadoEn).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}.</strong>{' '}
          {examen.cierreEntregarEnCurso ? 'A esa hora se entrega lo que tengan escrito los que sigan rindiendo.' : 'Los que sigan rindiendo a esa hora pueden terminar.'}
        </div>
      )}
      {examen.aviso && (
        <div className="vivo-estado-cierre" role="status">
          <strong>Aviso activo para los alumnos:</strong> {examen.aviso.texto}
        </div>
      )}
      {cerrado && (
        <p className="muted" role="status">
          El examen está cerrado: nadie nuevo puede empezar{resumen.rindiendo > 0 ? ', pero quienes ya estaban rindiendo pueden terminar' : ''}.
        </p>
      )}

      <div className="vivo-resumen">
        <div className="vivo-dato">
          <strong>{resumen.rindiendo}</strong>
          <span className="muted">{resumen.rindiendo === 1 ? 'rindiendo ahora' : 'rindiendo ahora'}</span>
        </div>
        <div className="vivo-dato">
          <strong>{resumen.entregaron}</strong>
          <span className="muted">{resumen.entregaron === 1 ? 'ya entregó' : 'ya entregaron'}</span>
        </div>
        <div className="vivo-dato">
          <strong>{resumen.sinEmpezar}</strong>
          <span className="muted" title="Alumnos de la lista que todavía no abrieron el examen. Con acceso abierto la lista crece sola, así que es un mínimo.">
            sin empezar
          </span>
        </div>
        <div className="vivo-dato" style={resumen.sinSenal > 0 ? { borderColor: 'var(--color-error)' } : undefined}>
          <strong>{resumen.sinSenal}</strong>
          <span className="muted" title="Hace más de 2 minutos que su navegador no manda ninguna señal: se le cortó internet, cerró la pestaña o el equipo se durmió.">
            sin señal
          </span>
        </div>
      </div>

      {alumnos.length === 0 ? (
        <div className="empty-state">
          {resumen.entregaron > 0 ? 'Ahora no hay nadie rindiendo: todos los que empezaron ya entregaron.' : 'Todavía no empezó ningún alumno. Cuando alguien abra el link va a aparecer acá.'}
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Alumno</th>
                <th>Avance</th>
                <th>Tiempo</th>
                <th>Actividad</th>
                {examen.monitoreado && <th>Señales de integridad</th>}
              </tr>
            </thead>
            <tbody>
              {alumnos.map((a) => {
                const pct = porcentajeAvance(a.respondidas, a.totalPreguntas);
                return (
                  <tr key={a.intentoId}>
                    <td>
                      <strong>{a.nombre}</strong>
                      <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                        {a.email} · {a.comision}
                      </div>
                    </td>
                    <td>
                      <div className="vivo-barra" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Avance de ${a.nombre}`}>
                        <span style={{ width: `${pct}%` }} />
                      </div>
                      <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                        {a.respondidas} de {plural(a.totalPreguntas, 'pregunta', 'preguntas')}
                      </div>
                    </td>
                    <td>
                      <div>{tiempoTranscurrido(a.inicioEn, datos.ahora)}</div>
                      <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                        {a.expiraEn ? `Quedan ${tiempoRestante(a.expiraEn, datos.ahora)}` : 'Sin límite de tiempo'}
                        {a.minutosExtra > 0 ? ` · +${a.minutosExtra} min extra` : ''}
                      </div>
                      <div className="vivo-fila-acciones">
                        {a.expiraEn && (
                          <button type="button" className="btn btn-secondary btn-chico" onClick={() => setExtraDe({ intentoId: a.intentoId, nombre: a.nombre })} title="Sumarle minutos solo a este alumno">
                            + Tiempo
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost btn-chico btn-peligro"
                          onClick={() => entregarAlumno({ intentoId: a.intentoId, nombre: a.nombre })}
                          disabled={entregando === a.intentoId}
                          title="Cierra el examen de este alumno: se entrega lo que tenga escrito"
                        >
                          {entregando === a.intentoId ? 'Entregando…' : 'Entregar'}
                        </button>
                      </div>
                    </td>
                    <td>
                      <span className={`vivo-punto ${a.conexion === 'sin_senal' ? 'vivo-punto-sin-senal' : ''}`} aria-hidden="true" />
                      {a.conexion === 'sin_senal' ? 'Sin señal' : 'Activo'}
                      <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                        {haceCuanto(a.ultimaActividad, datos.ahora)}
                      </div>
                    </td>
                    {examen.monitoreado && (
                      <td>
                        {a.totalSenales === 0 ? (
                          <span className="muted">Ninguna</span>
                        ) : (
                          <>
                            <strong>{a.totalSenales}</strong> <span className="muted">· {resumenSenales(a.senales)}</span>
                          </>
                        )}
                        {a.capturas > 0 && (
                          <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                            {plural(a.capturas, 'captura guardada', 'capturas guardadas')}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {dialogo === 'aviso' && <AvisoModal examenId={params.id} avisoActual={examen.aviso?.texto ?? null} onListo={listo} onCancelar={() => setDialogo(null)} />}
      {dialogo === 'cierre' && (
        <CierreProgramadoModal
          examenId={params.id}
          actual={examen.cierreProgramadoEn}
          entregarActual={examen.cierreEntregarEnCurso}
          onListo={listo}
          onCancelar={() => setDialogo(null)}
        />
      )}
      {dialogo === 'duracion' && <DuracionModal examenId={params.id} minutosActuales={examen.duracionMinutos} onListo={listo} onCancelar={() => setDialogo(null)} />}
      {extraDe && <TiempoExtraModal examenId={params.id} alumno={extraDe} onListo={listo} onCancelar={() => setExtraDe(null)} />}

      <p className="muted" style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)' }}>
        Las señales de integridad son información para tu criterio: no bloquean el examen ni cambian ninguna nota. «Sin señal» no significa que esté copiando; muchas veces
        es solo internet.
      </p>
    </div>
  );
}
