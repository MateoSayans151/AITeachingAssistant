'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * "Copiar link": copia `url` al portapapeles y avisa "¡Copiado!" un momento. Si el navegador no deja copiar (por ejemplo en una
 * conexión sin https), dice cómo hacerlo a mano en vez de fallar callado.
 */
export function CopiarLinkButton({ url, etiqueta = 'Copiar link' }: { url: string; etiqueta?: string }) {
  const [estado, setEstado] = useState<'normal' | 'copiado' | 'error'>('normal');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setEstado('copiado');
    } catch {
      setEstado('error');
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setEstado('normal'), 3000);
  }

  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={copiar}>
        {estado === 'copiado' ? '¡Copiado!' : etiqueta}
      </button>
      <span role="status" className="muted" style={{ fontSize: 13 }}>
        {estado === 'error' ? 'No se pudo copiar solo: seleccioná el link y copialo a mano.' : ''}
      </span>
    </>
  );
}
