'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  AjusteVaraResumen,
  ApiError,
  Examen,
  ModoVara,
  PreviewVara,
  ReglaVara,
  aplicarVara,
  getExamen,
  listAjustesVara,
  previewVara,
  revertirAjusteVara,
} from '@/lib/api';

const MODO_LABEL: Record<ModoVara, string> = {
  aprobados_esperados: 'Que aprueben un % de los alumnos',
  puntos: 'Sumar (o restar) puntos a todos',
  porcentaje: 'Subir (o bajar) un % la nota de todos',
};

const ESTADO_LABEL: Record<AjusteVaraResumen['estado'], string> = {
  activo: 'Vigente',
  reemplazado: 'Reemplazado',
  revertido: 'Revertido',
};

function mensajeDeError(err: unknown, porDefecto: string) {
  if (err instanceof ApiError) {
    try {
      const m = JSON.parse(err.body).message;
      return Array.isArray(m) ? m.join(' · ') : String(m);
    } catch {
      /* cae al mensaje por defecto */
    }
  }
  return porDefecto;
}

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : String(Math.round(n * 100) / 100));
const signo = (n: number) => `${n > 0 ? '+' : ''}${Math.round(n * 100) / 100}`;

export default function AjustarVaraPage() {
  const params = useParams<{ id: string }>();
  const [examen, setExamen] = useState<Examen | null>(null);
  const [ajustes, setAjustes] = useState<AjusteVaraResumen[]>([]);
  const [modo, setModo] = useState<ModoVara>('aprobados_esperados');
  const [valor, setValor] = useState('60');
  const [umbral, setUmbral] = useState('6');
  const [tope, setTope] = useState('');
  const [permitirBajar, setPermitirBajar] = useState(false);
  const [preview, setPreview] = useState<PreviewVara | null>(null);
  const [errorPreview, setErrorPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const pedido = useRef(0);

  const cargarAjustes = useCallback(() => listAjustesVara(params.id).then(setAjustes), [params.id]);

  useEffect(() => {
    Promise.all([getExamen(params.id), listAjustesVara(params.id)])
      .then(([e, a]) => {
        setExamen(e);
        setAjustes(a);
        // La expectativa que el docente cargó al crear el examen precarga la regla.
        const d = e.distribucionEsperada;
        setValor(d ? String(d.aprobadosEsperadosPct) : '60');
        setUmbral(d ? String(d.umbralAprobacion) : String(Number(e.escalaMin) + (Number(e.escalaMax) - Number(e.escalaMin)) * 0.6));
      })
      .catch((e) => setError(e.message));
  }, [params.id]);

  function reglaActual(): ReglaVara | null {
    const v = Number(valor);
    if (valor.trim() === '' || !Number.isFinite(v)) return null;
    if (modo !== 'aprobados_esperados') return { modo, valor: v };
    if (umbral.trim() === '' || !Number.isFinite(Number(umbral))) return null;
    const regla: ReglaVara = { modo, valor: v, umbral: Number(umbral) };
    if (tope.trim() !== '' && Number.isFinite(Number(tope))) regla.tope = Number(tope);
    if (permitirBajar) regla.permitirBajar = true;
    return regla;
  }

  // La simulación la calcula el servidor, así lo que se ve es exactamente lo que se aplica.
  useEffect(() => {
    if (!examen) return;
    const regla = reglaActual();
    if (!regla) {
      setPreview(null);
      setErrorPreview(null);
      return;
    }
    const mio = ++pedido.current;
    const t = setTimeout(() => {
      previewVara(params.id, regla)
        .then((p) => {
          if (mio !== pedido.current) return;
          setPreview(p);
          setErrorPreview(null);
        })
        .catch((err) => {
          if (mio !== pedido.current) return;
          setPreview(null);
          setErrorPreview(mensajeDeError(err, 'No se pudo calcular la vista previa.'));
        });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examen, modo, valor, umbral, tope, permitirBajar, ajustes]);

  async function handleAplicar() {
    const regla = reglaActual();
    if (!regla) return;
    if (bajan > 0 && !window.confirm(`Esta regla le baja la nota a ${bajan} alumno${bajan === 1 ? '' : 's'} respecto de lo que sugirió la IA. ¿Aplicarla?`)) return;
    setLoading(true);
    setError(null);
    setAviso(null);
    try {
      await aplicarVara(params.id, regla);
      await cargarAjustes();
      setAviso('Vara aplicada. La nota sugerida original no cambió y la nota final sigue en manos del docente: se define al aceptar o editar cada respuesta.');
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo aplicar la vara.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleRevertir(ajuste: AjusteVaraResumen) {
    if (!window.confirm('¿Revertir este ajuste? Las respuestas todavía sin revisar vuelven a la nota que tenían antes.')) return;
    setLoading(true);
    setError(null);
    setAviso(null);
    try {
      const r = await revertirAjusteVara(params.id, ajuste.id);
      await cargarAjustes();
      setAviso(
        `Ajuste revertido en ${r.restauradas} respuesta${r.restauradas === 1 ? '' : 's'}` +
          (r.omitidas > 0 ? `; ${r.omitidas} no se tocaron porque ya fueron revisadas.` : '.'),
      );
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo revertir el ajuste.'));
    } finally {
      setLoading(false);
    }
  }

  if (!examen) {
    return (
      <div className="page">
        {error ? <div className="error-box">{error}</div> : <p className="muted">Cargando…</p>}
      </div>
    );
  }

  const r = preview?.resumen;
  // Cuántos quedarían por debajo de lo que sugirió la IA (cualquier modo puede bajar notas).
  const bajan = preview ? preview.filas.filter((f) => f.notaConVara < f.notaSugerida).length : 0;
  const sinNada = preview !== null && preview.filas.length === 0;

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">{examen.titulo}</div>
        <h1>Ajustar vara</h1>
        <p>
          Definí una regla y mirá qué pasaría antes de aplicarla. La vara solo toca las respuestas que todavía no revisaste;
          la nota sugerida por la IA nunca se modifica y la nota final la definís vos al aceptar o editar cada respuesta.
        </p>
      </header>

      {error && <div className="error-box">{error}</div>}
      {aviso && <div className="card" style={{ marginBottom: 16 }}>{aviso}</div>}

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="field" style={{ maxWidth: 420, marginBottom: 16 }}>
          <label htmlFor="modo">Regla</label>
          <select id="modo" value={modo} onChange={(e) => setModo(e.target.value as ModoVara)}>
            {(Object.keys(MODO_LABEL) as ModoVara[]).map((m) => (
              <option key={m} value={m}>
                {MODO_LABEL[m]}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          <div className="field" style={{ width: 200 }}>
            <label htmlFor="valor">
              {modo === 'aprobados_esperados' ? 'Aprobados esperados (%)' : modo === 'puntos' ? 'Puntos' : 'Ajuste (%)'}
            </label>
            <input id="valor" type="number" step="any" value={valor} onChange={(e) => setValor(e.target.value)} />
          </div>
          {modo === 'aprobados_esperados' && (
            <>
              <div className="field" style={{ width: 200 }}>
                <label htmlFor="umbral">Nota de aprobación</label>
                <input id="umbral" type="number" step="any" value={umbral} onChange={(e) => setUmbral(e.target.value)} />
              </div>
              <div className="field" style={{ width: 240 }}>
                <label htmlFor="tope">Máximo a desplazar (puntos, opcional)</label>
                <input
                  id="tope"
                  type="number"
                  step="any"
                  min="0"
                  placeholder={`${(Number(examen.escalaMax) - Number(examen.escalaMin)) / 4} por defecto`}
                  value={tope}
                  onChange={(e) => setTope(e.target.value)}
                />
              </div>
            </>
          )}
        </div>

        {modo === 'aprobados_esperados' && (
          <>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <input type="checkbox" checked={permitirBajar} onChange={(e) => setPermitirBajar(e.target.checked)} />
              Si aprueban más de lo esperado, también bajar las notas
            </label>
            <p className="muted" style={{ marginBottom: 16 }}>
              {permitirBajar
                ? 'Busca que aprueben alrededor de ese porcentaje: sube a todos si aprueban menos, y baja a todos si aprueban más. '
                : 'Busca que aprueben al menos ese porcentaje: sube a todos lo mínimo necesario; si ya se cumple no cambia nada y nunca baja notas. '}
              El máximo a desplazar (hacia arriba o hacia abajo) evita un ajuste desproporcionado.
            </p>
          </>
        )}

        {errorPreview && <div className="error-box" style={{ marginBottom: 16 }}>{errorPreview}</div>}

        {r && (
          <div style={{ marginBottom: 16 }}>
            {modo === 'aprobados_esperados' && preview && (
              <p>
                <strong>
                  Aprobados: {r.aprobadosAntes} de {r.total} → {r.aprobadosDespues} de {r.total}
                </strong>
                {preview.desplazamiento !== null && ` · desplazamiento ${signo(preview.desplazamiento)} puntos`}
              </p>
            )}
            {modo === 'aprobados_esperados' && permitirBajar && r.aprobadosDespues !== null && r.aprobadosDespues !== Math.round((Number(valor) / 100) * r.total) && r.alcanzable !== false && (
              <p className="muted" style={{ marginTop: 8 }}>
                Como la vara mueve a todos por igual y hay alumnos con notas iguales o muy parecidas, no puede quedar justo en{' '}
                {Math.round((Number(valor) / 100) * r.total)} aprobados: es lo más cercano que se puede lograr.
              </p>
            )}
            {bajan > 0 && (
              <p className="error-box" style={{ marginTop: 8 }}>
                Esta regla baja la nota de {bajan} alumno{bajan === 1 ? '' : 's'} respecto de lo que sugirió la IA. Nada es definitivo hasta
                que aceptes o edites cada respuesta, y podés revertir el ajuste.
              </p>
            )}
            {r.alcanzable === false && (
              <p className="error-box" style={{ marginTop: 8 }}>
                No se llega al objetivo (por el máximo a desplazar o por los límites de la escala): quedarían {r.aprobadosDespues} de{' '}
                {r.total} aprobados.
              </p>
            )}
          </div>
        )}

        <button className="btn btn-primary" onClick={handleAplicar} disabled={loading || !preview || sinNada}>
          {loading ? 'Aplicando…' : 'Aplicar vara'}
        </button>
      </div>

      {sinNada && <div className="empty-state">No hay respuestas corregidas y sin revisar para ajustar.</div>}

      {preview && preview.filas.length > 0 && (
        <div className="card" style={{ overflowX: 'auto', marginBottom: 24 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Alumno</th>
                <th>Nota sugerida (IA)</th>
                <th>Con vara hoy</th>
                <th>Con esta regla</th>
                <th>Cambio</th>
              </tr>
            </thead>
            <tbody>
              {preview.filas.map((f) => (
                <tr key={f.respuestaId}>
                  <td>{f.alumno}</td>
                  <td>{fmt(f.notaSugerida)}</td>
                  <td>{fmt(f.notaConVaraActual)}</td>
                  <td>
                    <strong>{fmt(f.notaConVara)}</strong>
                  </td>
                  <td>{signo(f.notaConVara - f.notaSugerida)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div className="card-title" style={{ marginBottom: 8 }}>
          Historial de ajustes
        </div>
        {ajustes.length === 0 ? (
          <p className="muted">Todavía no se aplicó ninguna vara a este examen.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Cuándo</th>
                <th>Quién</th>
                <th>Regla</th>
                <th>Resultado</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ajustes.map((a) => (
                <tr key={a.id}>
                  <td>{new Date(a.creadoEn).toLocaleString('es-AR')}</td>
                  <td>{a.autor ?? '—'}</td>
                  <td>{a.descripcion}</td>
                  <td>
                    {a.resumen.aprobadosAntes !== null
                      ? `Aprobados ${a.resumen.aprobadosAntes} → ${a.resumen.aprobadosDespues} de ${a.resumen.total}`
                      : `${a.resumen.ajustadas} respuesta${a.resumen.ajustadas === 1 ? '' : 's'} ajustada${a.resumen.ajustadas === 1 ? '' : 's'}`}
                  </td>
                  <td>{ESTADO_LABEL[a.estado]}</td>
                  <td>
                    {a.estado === 'activo' && (
                      <button className="btn btn-secondary" onClick={() => handleRevertir(a)} disabled={loading}>
                        Revertir
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ marginTop: 24 }}>
        <Link href={`/examenes/${examen.id}/respuestas`}>Ir a las respuestas</Link>
      </p>
    </div>
  );
}
