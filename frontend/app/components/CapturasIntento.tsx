'use client';

// Capturas de pantalla que el alumno compartió durante el examen (control "pantalla compartida"). Solo las ve el docente dueño del examen.
// Se bajan recién cuando el docente las pide (son imágenes de la pantalla de una persona) y se pueden borrar antes de que venzan solas.

import { useEffect, useRef, useState } from 'react';
import { useConfirmar } from '@/app/components/Confirmar';
import { CapturaIntegridad, borrarCaptura, borrarCapturas, getCapturaImagen, getCapturas } from '@/lib/api';

const MOTIVO_LABEL: Record<string, string> = {
  muestreo: 'Captura periódica',
  cambio_pestana: 'Al cambiar de pestaña o ventana',
  salida_pantalla_completa: 'Al salir de pantalla completa',
  pantalla_compartida_detenida: 'Al dejar de compartir',
};

export function CapturasIntento({ examenId, respuestaId, cantidad }: { examenId: string; respuestaId: string; cantidad: number }) {
  const confirmar = useConfirmar();
  const [capturas, setCapturas] = useState<CapturaIntegridad[] | null>(null);
  const [imagenes, setImagenes] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ampliada, setAmpliada] = useState<string | null>(null);
  const urls = useRef<string[]>([]);

  useEffect(
    () => () => {
      urls.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  async function ver() {
    setCargando(true);
    setError(null);
    try {
      const lista = await getCapturas(examenId, respuestaId);
      setCapturas(lista);
      for (const c of lista) {
        try {
          const url = URL.createObjectURL(await getCapturaImagen(examenId, respuestaId, c.id));
          urls.current.push(url);
          setImagenes((prev) => ({ ...prev, [c.id]: url }));
        } catch {
          /* esa imagen ya no está: queda el recuadro vacío */
        }
      }
    } catch {
      setError('No se pudieron cargar las capturas.');
    } finally {
      setCargando(false);
    }
  }

  async function borrarUna(id: string) {
    if (!(await confirmar({ titulo: '¿Borrar esta captura?', mensaje: 'No se puede deshacer.', textoConfirmar: 'Borrar', textoCancelar: 'Cancelar' }))) return;
    try {
      await borrarCaptura(examenId, respuestaId, id);
      setCapturas((prev) => (prev ?? []).filter((c) => c.id !== id));
      setAmpliada(null);
    } catch {
      setError('No se pudo borrar la captura.');
    }
  }

  async function borrarTodas() {
    if (!(await confirmar({ titulo: '¿Borrar todas las capturas?', mensaje: 'Se borran las imágenes de este alumno. No se puede deshacer.', textoConfirmar: 'Borrar todas', textoCancelar: 'Cancelar' }))) return;
    try {
      await borrarCapturas(examenId, respuestaId);
      setCapturas([]);
      setAmpliada(null);
    } catch {
      setError('No se pudieron borrar las capturas.');
    }
  }

  const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-AR');

  if (capturas === null) {
    return (
      <div style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-ghost" onClick={ver} disabled={cargando} data-testid="ver-capturas">
          {cargando ? 'Cargando…' : `Ver ${cantidad} ${cantidad === 1 ? 'captura' : 'capturas'} de pantalla`}
        </button>
        {error && <div className="error-box">{error}</div>}
      </div>
    );
  }

  const elegida = capturas.find((c) => c.id === ampliada);
  return (
    <div style={{ marginTop: 12 }} data-testid="galeria-capturas">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <strong>Capturas de pantalla ({capturas.length})</strong>
        {capturas.length > 0 && (
          <button type="button" className="btn btn-ghost" onClick={borrarTodas}>
            Borrar todas
          </button>
        )}
      </div>
      {error && <div className="error-box">{error}</div>}
      {capturas.length === 0 ? (
        <p className="muted">No quedan capturas.</p>
      ) : (
        <>
          <p className="muted" style={{ marginBottom: 8 }}>
            Cada captura tiene que mostrar el código <code>ID</code> de la barra del examen; si no coincide con el que emitió el servidor, aparece una advertencia.
            Se borran solas el {new Date(capturas[0].eliminarEn).toLocaleDateString('es-AR')}.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            {capturas.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setAmpliada(c.id)}
                style={{ textAlign: 'left', border: '1px solid var(--color-divider, #ddd)', borderRadius: 6, padding: 6, background: 'transparent', cursor: 'pointer' }}
              >
                {imagenes[c.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imagenes[c.id]} alt={`Captura de las ${hora(c.ocurridoEn)}`} style={{ width: '100%', display: 'block', borderRadius: 4 }} />
                ) : (
                  <div style={{ aspectRatio: '16 / 9', background: '#eee', borderRadius: 4 }} />
                )}
                <small style={{ display: 'block', marginTop: 4 }}>
                  {hora(c.ocurridoEn)} · {MOTIVO_LABEL[c.motivo] ?? c.motivo}
                </small>
                <small className={c.marcaValida ? 'muted' : undefined} style={c.marcaValida ? undefined : { color: 'var(--color-danger, #b00020)' }}>
                  {c.marcaValida ? `ID ${c.marca} ✓` : c.marca ? `ID ${c.marca}: no coincide ⚠` : 'sin ID ⚠'}
                </small>
              </button>
            ))}
          </div>
        </>
      )}
      {elegida && imagenes[elegida.id] && (
        <div style={{ marginTop: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imagenes[elegida.id]} alt="Captura ampliada" style={{ maxWidth: '100%', borderRadius: 6, border: '1px solid var(--color-divider, #ddd)' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setAmpliada(null)}>
              Cerrar
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => borrarUna(elegida.id)}>
              Borrar esta captura
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
