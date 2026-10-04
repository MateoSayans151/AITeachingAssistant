'use client';

import { TextareaHTMLAttributes, useCallback, useEffect, useLayoutEffect, useRef } from 'react';

const useLayoutEffectSeguro = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * `<textarea>` que crece con su contenido: se ve el texto completo sin scroll interno ni
 * handle de resize. Recalcula la altura al cambiar el valor y al redimensionar la ventana
 * (el ancho cambia cómo se parte el texto).
 */
export default function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const ajustar = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    // scrollHeight no incluye el borde: se suma para que no aparezca scroll interno.
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, []);

  useLayoutEffectSeguro(ajustar, [props.value, ajustar]);

  useEffect(() => {
    window.addEventListener('resize', ajustar);
    return () => window.removeEventListener('resize', ajustar);
  }, [ajustar]);

  return <textarea rows={2} {...props} ref={ref} />;
}
