'use client';

// Estado de carga: esqueleto con la forma de lo que va a aparecer (la página no salta cuando llegan los datos) en vez de un
// "Cargando…" suelto. Es un `role="status"`: el lector de pantalla lee la etiqueta y no los bloques. Si tarda más de 8 segundos
// avisa y ofrece reintentar (antes quedaba "Cargando…" para siempre, también cuando el servidor no respondía).

import { useEffect, useState } from 'react';

export type VarianteCarga = 'lista' | 'pagina' | 'asistente' | 'cuadricula';

const Bloque = ({ ancho = '100%', alto = 14 }: { ancho?: string; alto?: number }) => <span className="skeleton" style={{ width: ancho, height: alto }} />;

const TarjetaEsqueleto = () => (
  <div className="card skeleton-tarjeta">
    <Bloque ancho="40%" alto={16} />
    <Bloque ancho="75%" />
    <Bloque ancho="30%" />
  </div>
);

export function Cargando({ etiqueta = 'Cargando…', variante = 'lista' }: { etiqueta?: string; variante?: VarianteCarga }) {
  const [lento, setLento] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLento(true), 8000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{etiqueta}</span>
      <div className="skeleton-pila" aria-hidden="true">
        {variante === 'asistente' && (
          <>
            <Bloque ancho="35%" alto={28} />
            <div className="skeleton-pasos">
              <Bloque alto={32} />
              <Bloque alto={32} />
            </div>
            <div className="card skeleton-tarjeta">
              <Bloque ancho="20%" alto={12} />
              <Bloque alto={38} />
              <Bloque ancho="20%" alto={12} />
              <Bloque alto={38} />
            </div>
            <TarjetaEsqueleto />
          </>
        )}
        {variante === 'pagina' && (
          <>
            <Bloque ancho="45%" alto={28} />
            <Bloque ancho="60%" />
            <TarjetaEsqueleto />
            <TarjetaEsqueleto />
          </>
        )}
        {variante === 'cuadricula' && (
          <div className="cursos-grid">
            {[0, 1, 2].map((i) => (
              <span key={i} className="skeleton" style={{ aspectRatio: '1 / 1', height: 'auto', borderRadius: 'var(--radius-lg)' }} />
            ))}
          </div>
        )}
        {variante === 'lista' && (
          <>
            <TarjetaEsqueleto />
            <TarjetaEsqueleto />
            <TarjetaEsqueleto />
          </>
        )}
      </div>
      {lento && (
        <p className="muted" style={{ marginTop: 'var(--space-4)' }}>
          Está tardando más de lo normal. Revisá tu conexión.{' '}
          <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
            Reintentar
          </button>
        </p>
      )}
    </div>
  );
}
