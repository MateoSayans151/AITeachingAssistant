'use client';

// PasoPublicar: el último paso del wizard (el examen ya está creado). Es AUTOCONTENIDO: maneja su propio estado y sus propias
// llamadas a la API. Carga las comisiones del curso; el docente pega la lista de alumnos (o elige una comisión que ya
// tiene), pone las fechas (opcionales) y genera el link de acceso. Muestra sus propios errores y, al terminar, el link con
// el botón de copiar y "Ir al examen".
//
// Contrato:
//   PasoPublicar({ examenId, cursoId, tituloExamen, onPublicado? })
//     examenId      id del examen recién creado (se publica a una comisión con `publicarExamenAComision`).
//     cursoId       id del curso del examen (de ahí salen las comisiones; la comisión nueva se crea en este curso).
//     tituloExamen  título del examen: es el nombre sugerido para el grupo de alumnos nuevo.
//     onPublicado?  se llama una vez cuando el link quedó generado, con el link y la cantidad de alumnos (null si no se sabe).

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createComision, listComisionesPorCurso, publicarExamenAComision } from '@/lib/api';
import type { Comision } from '@/lib/api';
import { fechaLocalAIso } from '@/lib/fechas';
import { mensajesDelServidor, parsearAlumnos } from '@/lib/examen-form';

export interface PasoPublicarProps {
  examenId: string;
  cursoId: string;
  tituloExamen: string;
  onPublicado?: (info: { link: string | null; cantidadAlumnos: number | null }) => void;
}

export function PasoPublicar({ examenId, cursoId, tituloExamen, onPublicado }: PasoPublicarProps) {
  const router = useRouter();
  const [errores, setErrores] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [comisiones, setComisiones] = useState<Comision[] | null>(null);
  const [modoPublicar, setModoPublicar] = useState<'nueva' | 'existente'>('nueva');
  const [comisionSeleccionada, setComisionSeleccionada] = useState('');
  const [nombreComision, setNombreComision] = useState(tituloExamen);
  const [textoAlumnos, setTextoAlumnos] = useState('');
  const [linkGenerado, setLinkGenerado] = useState<string | null>(null);
  const [cantidadAlumnos, setCantidadAlumnos] = useState<number | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');

  const alumnosParseados = useMemo(() => parsearAlumnos(textoAlumnos), [textoAlumnos]);

  useEffect(() => {
    if (!cursoId) return;
    listComisionesPorCurso(cursoId)
      .then((cs) => {
        setComisiones(cs);
        setModoPublicar(cs.length > 0 ? 'existente' : 'nueva');
      })
      .catch(() => setComisiones([]));
  }, [cursoId]);

  async function handlePublicar() {
    setErrores([]);
    let comisionId = comisionSeleccionada;
    if (modoPublicar === 'nueva') {
      if (!nombreComision.trim()) return setErrores(['Poné un nombre para el grupo de alumnos (por ejemplo, "Comisión A").']);
      if (alumnosParseados.alumnos.length === 0) return setErrores(['Pegá la lista de alumnos: uno por línea, con su email.']);
      if (alumnosParseados.errores.length > 0) return setErrores(alumnosParseados.errores);
    } else if (!comisionId) {
      return setErrores(['Elegí una comisión.']);
    }

    setLoading(true);
    try {
      let cantidad: number | null = null;
      if (modoPublicar === 'nueva') {
        cantidad = alumnosParseados.alumnos.length;
        const creada = await createComision(cursoId, { nombre: nombreComision.trim(), alumnos: alumnosParseados.alumnos });
        comisionId = creada.id;
        // Si publicar falla, un reintento usa esta misma comisión en vez de crear otra.
        setComisiones((prev) => [...(prev ?? []), creada]);
        setComisionSeleccionada(creada.id);
        setModoPublicar('existente');
      }
      const resultado = await publicarExamenAComision(examenId, {
        comisionId,
        fechaInicio: fechaLocalAIso(fechaInicio),
        fechaFin: fechaLocalAIso(fechaFin),
      });
      if (cantidad === null) cantidad = (comisiones ?? []).find((c) => c.id === comisionId)?._count?.alumnos ?? null;
      setCantidadAlumnos(cantidad);
      setLinkGenerado(resultado.urlAcceso ?? null);
      onPublicado?.({ link: resultado.urlAcceso ?? null, cantidadAlumnos: cantidad });
    } catch (err) {
      const detalle = mensajesDelServidor(err);
      setErrores(['No se pudo publicar el examen.', ...detalle.slice(0, 3)]);
    } finally {
      setLoading(false);
    }
  }

  async function copiar(que: string, texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(que);
      setTimeout(() => setCopiado((c) => (c === que ? null : c)), 2000);
    } catch {
      setErrores(['No se pudo copiar automáticamente: seleccioná el texto y copialo a mano.']);
    }
  }

  return (
    <div>
      {errores.length > 0 && (
        <div className="error-box" role="alert">
          {errores.length === 1 ? (
            errores[0]
          ) : (
            <>
              {errores[0]}
              <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                {errores.slice(1).map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {!linkGenerado && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: 6 }}>
            ¿Quiénes lo rinden?
          </div>
          <p className="muted" style={{ marginBottom: 14 }}>
            Cada alumno entra al link con el email con el que figura en la lista: cargalos tal cual los usan (no distingue mayúsculas).
          </p>

          {comisiones && comisiones.length > 0 && (
            <div style={{ display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', gap: 6 }}>
                <input type="radio" name="modoPublicar" checked={modoPublicar === 'nueva'} onChange={() => setModoPublicar('nueva')} />
                Pegar una lista de alumnos
              </label>
              <label style={{ display: 'flex', gap: 6 }}>
                <input type="radio" name="modoPublicar" checked={modoPublicar === 'existente'} onChange={() => setModoPublicar('existente')} />
                Usar una comisión que ya tengo
              </label>
            </div>
          )}

          {modoPublicar === 'existente' ? (
            <div className="field">
              <select value={comisionSeleccionada} onChange={(e) => setComisionSeleccionada(e.target.value)}>
                <option value="">Elegí una comisión…</option>
                {(comisiones ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                    {c._count ? ` (${c._count.alumnos} alumnos)` : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="nombreComision">Nombre del grupo</label>
                <input id="nombreComision" value={nombreComision} onChange={(e) => setNombreComision(e.target.value)} placeholder="Ej: Comisión A" />
              </div>
              <div className="field">
                <label htmlFor="alumnos">Alumnos</label>
                <textarea
                  id="alumnos"
                  value={textoAlumnos}
                  onChange={(e) => setTextoAlumnos(e.target.value)}
                  style={{ minHeight: 140 }}
                  placeholder={'Uno por línea. Con el email alcanza; si querés, el nombre antes:\nAna Pérez, ana@mail.com\nluis@mail.com'}
                />
                <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                  {textoAlumnos.trim()
                    ? `${alumnosParseados.alumnos.length} alumno${alumnosParseados.alumnos.length === 1 ? '' : 's'} listo${alumnosParseados.alumnos.length === 1 ? '' : 's'}` +
                      (alumnosParseados.errores.length ? ` · ${alumnosParseados.errores.length} línea${alumnosParseados.errores.length === 1 ? '' : 's'} con problemas` : '')
                    : 'Podés pegar directamente desde una planilla.'}
                </div>
                {alumnosParseados.errores.length > 0 && (
                  <ul className="muted" style={{ fontSize: 13, margin: '6px 0 0', paddingLeft: 20 }}>
                    {alumnosParseados.errores.slice(0, 5).map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, minWidth: 220 }}>
              <label htmlFor="fechaInicio">Se habilita (opcional)</label>
              <input id="fechaInicio" type="datetime-local" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 220 }}>
              <label htmlFor="fechaFin">Cierra (opcional)</label>
              <input id="fechaFin" type="datetime-local" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
            </div>
          </div>
          <p className="muted" style={{ marginBottom: 12 }}>
            Si el examen tiene duración, cada alumno tiene ese tiempo desde que empieza, pero nunca más allá de la fecha de cierre.
          </p>
          <button className="btn btn-primary" onClick={handlePublicar} disabled={loading}>
            {loading ? 'Publicando…' : 'Generar link de acceso'}
          </button>
        </div>
      )}

      {linkGenerado && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: 8 }}>
            Listo: el examen está publicado
          </div>
          <p className="muted" style={{ marginBottom: 6 }}>Link para los alumnos:</p>
          <p style={{ wordBreak: 'break-all', marginBottom: 10 }}>{linkGenerado}</p>
          <button type="button" className="btn btn-secondary" onClick={() => copiar('link', linkGenerado)} style={{ marginBottom: 20 }}>
            {copiado === 'link' ? '¡Copiado!' : 'Copiar link'}
          </button>

          <p className="muted" style={{ marginBottom: 20 }}>
            {cantidadAlumnos !== null ? `Los ${cantidadAlumnos} alumnos del listado` : 'Los alumnos del listado'} entran con su email: no necesitan ningún código.
          </p>

          <div>
            <button className="btn btn-primary" onClick={() => router.push(`/examenes/${examenId}`)}>
              Ir al examen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
