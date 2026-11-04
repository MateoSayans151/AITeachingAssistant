'use client';

import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { SelectorFecha } from './SelectorFecha';
import { plural } from '@/lib/texto';
import { fechaLocalAIso, isoAFechaLocal } from '@/lib/fechas';
import { mensajeDeError } from '@/lib/errores';
import { cambiarDuracionExamen, darTiempoExtra, enviarAviso, getVistaPreviaDuracion, programarCierreExamen, quitarAviso } from '@/lib/api';

// Durante el examen: aviso a todos, cierre automático, duración de la sesión y tiempo extra por alumno. Cada diálogo hace su pedido al
// servidor y avisa a la pantalla con `onListo` para que recargue.

/** Un cartel que aparece dentro del examen de todos los que están rindiendo. Reemplaza al anterior; también se puede quitar. */
export function AvisoModal({ examenId, avisoActual, onListo, onCancelar }: { examenId: string; avisoActual: string | null; onListo: (mensaje: string) => void; onCancelar: () => void }) {
  const [texto, setTexto] = useState(avisoActual ?? '');
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limite = 500;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!texto.trim() || trabajando) return;
    setTrabajando(true);
    setError(null);
    try {
      await enviarAviso(examenId, texto.trim());
      onListo('Aviso enviado: los alumnos que están rindiendo lo ven en unos segundos.');
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo enviar el aviso. Probá de nuevo.'));
      setTrabajando(false);
    }
  }

  async function quitar() {
    setTrabajando(true);
    setError(null);
    try {
      await quitarAviso(examenId);
      onListo('Aviso quitado.');
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo quitar el aviso. Probá de nuevo.'));
      setTrabajando(false);
    }
  }

  return (
    <Modal titulo="Avisar a los que están rindiendo" onCerrar={onCancelar} cerrable={!trabajando}>
      <form onSubmit={enviar}>
        <p className="dialog-message">Aparece como un cartel dentro del examen de cada alumno, en pocos segundos. Un aviso nuevo reemplaza al anterior.</p>
        <div className="field">
          <label htmlFor="aviso-texto">Mensaje</label>
          <textarea
            id="aviso-texto"
            value={texto}
            onChange={(e) => setTexto(e.target.value.slice(0, limite))}
            rows={4}
            disabled={trabajando}
            placeholder="Ej.: Hay un error en la pregunta 3: donde dice «n» es «n + 1»."
          />
          <p className="ayuda-campo">
            {texto.length} de {limite} caracteres
          </p>
        </div>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-actions">
          {avisoActual && (
            <button type="button" className="btn btn-ghost" onClick={quitar} disabled={trabajando}>
              Quitar el aviso actual
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onCancelar} disabled={trabajando}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={!texto.trim() || trabajando}>
            {trabajando ? 'Enviando…' : 'Enviar aviso'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Programar el cierre automático del examen: a esa hora se cierra solo. Se elige qué pasa con quien siga rindiendo (la misma pregunta que al
 * cerrarlo a mano). Se puede cambiar o quitar mientras no haya llegado la hora.
 */
export function CierreProgramadoModal({
  examenId,
  actual,
  entregarActual,
  onListo,
  onCancelar,
}: {
  examenId: string;
  actual: string | null;
  entregarActual: boolean;
  onListo: (mensaje: string) => void;
  onCancelar: () => void;
}) {
  const [cuando, setCuando] = useState(isoAFechaLocal(actual));
  const [entregar, setEntregar] = useState<boolean>(entregarActual);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const futuro = !!cuando && new Date(cuando).getTime() > Date.now();

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!futuro || trabajando) return;
    setTrabajando(true);
    setError(null);
    try {
      await programarCierreExamen(examenId, fechaLocalAIso(cuando) ?? null, entregar);
      onListo(`Cierre programado para el ${new Date(cuando).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}.`);
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo programar el cierre. Probá de nuevo.'));
      setTrabajando(false);
    }
  }

  async function quitar() {
    setTrabajando(true);
    setError(null);
    try {
      await programarCierreExamen(examenId, null, entregar);
      onListo('Cierre programado quitado.');
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo quitar el cierre. Probá de nuevo.'));
      setTrabajando(false);
    }
  }

  return (
    <Modal titulo="Cierre automático del examen" onCerrar={onCancelar} cerrable={!trabajando}>
      <form onSubmit={guardar}>
        <p className="dialog-message">A la hora que elijas el examen se cierra solo: nadie nuevo puede empezar. Podés volver a abrirlo después.</p>
        <div className="field">
          <label htmlFor="cierre-cuando">Se cierra el</label>
          <SelectorFecha id="cierre-cuando" value={cuando} onChange={setCuando} disabled={trabajando} minimo={isoAFechaLocal(new Date().toISOString())} limpiable={false} />
          {cuando && !futuro && (
            <p className="ayuda-campo" style={{ color: 'var(--color-error)' }}>
              Elegí una fecha y hora que todavía no pasó.
            </p>
          )}
        </div>
        <fieldset className="control-opciones" disabled={trabajando}>
          <legend>Si a esa hora hay alumnos rindiendo…</legend>
          <label className="opcion-tarjeta">
            <span>
              <strong>Entregar lo que tengan escrito</strong>
              <span className="ayuda-campo">Se entrega el último autoguardado de cada uno y la IA lo corrige.</span>
            </span>
            <input type="radio" name="cierre-que-hacer" checked={entregar} onChange={() => setEntregar(true)} />
          </label>
          <label className="opcion-tarjeta">
            <span>
              <strong>Dejar que terminen</strong>
              <span className="ayuda-campo">Siguen hasta que entreguen o se les acabe su tiempo; solo se impide que empiecen nuevos.</span>
            </span>
            <input type="radio" name="cierre-que-hacer" checked={!entregar} onChange={() => setEntregar(false)} />
          </label>
        </fieldset>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-actions">
          {actual && (
            <button type="button" className="btn btn-ghost" onClick={quitar} disabled={trabajando}>
              Quitar el cierre
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onCancelar} disabled={trabajando}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={!futuro || trabajando}>
            {trabajando ? 'Guardando…' : 'Programar cierre'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Cambiar cuánto dura la sesión. Vale también para los que ya están rindiendo (su vencimiento pasa a ser lo que empezaron + la nueva duración, más
 * el tiempo extra que ya tuvieran), y a todos les aparece un aviso. Si la baja deja a alguien por encima del nuevo tiempo, se lo muestra antes
 * de confirmar: a esos alumnos se les entrega lo que tengan.
 */
export function DuracionModal({ examenId, minutosActuales, onListo, onCancelar }: { examenId: string; minutosActuales: number | null; onListo: (mensaje: string) => void; onCancelar: () => void }) {
  const [minutos, setMinutos] = useState(String(minutosActuales ?? 60));
  const [vista, setVista] = useState<{ rindiendo: number; seCortan: { intentoId: string; nombre: string }[] } | null>(null);
  const [cargandoVista, setCargandoVista] = useState(false);
  const [entiendo, setEntiendo] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(minutos);
  const valido = Number.isInteger(n) && n >= 1 && n <= 1440;
  const cambio = valido && n !== minutosActuales;

  // Qué pasaría con los que rinden ahora: se pide con una pausa tras dejar de escribir.
  useEffect(() => {
    setEntiendo(false);
    if (!cambio) {
      setVista(null);
      return;
    }
    let cancelado = false;
    setCargandoVista(true);
    const t = setTimeout(() => {
      getVistaPreviaDuracion(examenId, n)
        .then((v) => !cancelado && setVista(v))
        .catch(() => !cancelado && setVista(null))
        .finally(() => !cancelado && setCargandoVista(false));
    }, 400);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [examenId, n, cambio]);

  const cortan = vista?.seCortan.length ?? 0;
  const puedeGuardar = cambio && !cargandoVista && (cortan === 0 || entiendo);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!puedeGuardar || trabajando) return;
    setTrabajando(true);
    setError(null);
    try {
      const r = await cambiarDuracionExamen(examenId, n);
      onListo(
        `Ahora la sesión dura ${n} min.${r.actualizados > 0 ? ` Se actualizó el reloj de ${plural(r.actualizados, 'alumno que está rindiendo', 'alumnos que están rindiendo')} y les llegó un aviso.` : ''}${
          r.seCortan > 0 ? ` ${plural(r.seCortan, 'alumno ya pasó', 'alumnos ya pasaron')} el nuevo tiempo: se les entrega lo que tengan.` : ''
        }`,
      );
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo cambiar la duración. Probá de nuevo.'));
      setTrabajando(false);
    }
  }

  return (
    <Modal titulo="Duración de la sesión" onCerrar={onCancelar} cerrable={!trabajando}>
      <form onSubmit={guardar}>
        <p className="dialog-message">
          Cuánto tiempo tiene cada alumno desde que empieza. El cambio vale para los que empiecen y también para los que ya están rindiendo, y a todos les aparece un aviso.
        </p>
        <div className="field">
          <label htmlFor="duracion-min">Minutos</label>
          <input id="duracion-min" type="number" min={1} max={1440} value={minutos} onChange={(e) => setMinutos(e.target.value)} disabled={trabajando} />
          {minutosActuales !== null && <p className="ayuda-campo">Ahora son {minutosActuales} min.</p>}
        </div>

        {cambio && cargandoVista && <p className="muted">Viendo cómo afecta a los que están rindiendo…</p>}
        {cambio && vista && !cargandoVista && (
          <>
            <p className="muted" role="status">
              {vista.rindiendo === 0
                ? 'Ahora no hay nadie rindiendo: el cambio vale para los que empiecen.'
                : `Hay ${plural(vista.rindiendo, 'alumno rindiendo', 'alumnos rindiendo')} y su reloj se recalcula.`}
            </p>
            {cortan > 0 && (
              <div className="error-box" role="alert">
                <strong>
                  {plural(cortan, 'alumno ya pasó', 'alumnos ya pasaron')} el nuevo tiempo y {cortan === 1 ? 'se le cortaría' : 'se les cortaría'} el examen
                </strong>{' '}
                (se entrega lo que tengan escrito): {vista.seCortan.map((a) => a.nombre).join(', ')}. Si no querés cortarlo, elegí una duración mayor, o dale tiempo extra desde «En vivo»
                después de guardar (aunque con poco margen).
                <label className="opcion-tarjeta" style={{ marginTop: 12 }}>
                  <span>
                    <strong>Entiendo que se corta a esos alumnos</strong>
                  </span>
                  <input type="checkbox" checked={entiendo} onChange={(e) => setEntiendo(e.target.checked)} disabled={trabajando} />
                </label>
              </div>
            )}
          </>
        )}

        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancelar} disabled={trabajando}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={!puedeGuardar || trabajando}>
            {trabajando ? 'Guardando…' : 'Cambiar duración'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Más tiempo para UN alumno que está rindiendo (el reloj de los demás no cambia). */
export function TiempoExtraModal({
  examenId,
  alumno,
  onListo,
  onCancelar,
}: {
  examenId: string;
  alumno: { intentoId: string; nombre: string };
  onListo: (mensaje: string) => void;
  onCancelar: () => void;
}) {
  const [minutos, setMinutos] = useState('10');
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(minutos);
  const valido = Number.isInteger(n) && n >= 1 && n <= 240;

  async function dar(e: React.FormEvent) {
    e.preventDefault();
    if (!valido || trabajando) return;
    setTrabajando(true);
    setError(null);
    try {
      await darTiempoExtra(examenId, alumno.intentoId, n);
      onListo(`${alumno.nombre} tiene ${n} min más.`);
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo dar el tiempo extra. Probá de nuevo.'));
      setTrabajando(false);
    }
  }

  return (
    <Modal titulo={`Tiempo extra para ${alumno.nombre}`} onCerrar={onCancelar} cerrable={!trabajando}>
      <form onSubmit={dar}>
        <p className="dialog-message">Se suma al reloj de este alumno; el de los demás no cambia. Lo ve en pocos segundos.</p>
        <div className="vivo-fila-acciones" role="group" aria-label="Minutos habituales">
          {[5, 10, 15, 30].map((m) => (
            <button key={m} type="button" className={`btn btn-chico ${n === m ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMinutos(String(m))} disabled={trabajando}>
              {m} min
            </button>
          ))}
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="extra-min">Minutos</label>
          <input id="extra-min" type="number" min={1} max={240} value={minutos} onChange={(e) => setMinutos(e.target.value)} disabled={trabajando} />
        </div>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancelar} disabled={trabajando}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={!valido || trabajando}>
            {trabajando ? 'Dando tiempo…' : `Dar ${valido ? n : ''} min`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
