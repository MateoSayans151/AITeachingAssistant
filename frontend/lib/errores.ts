import { ApiError } from './api';

/** El backend responde los errores como JSON `{ message }` (a veces una lista): se muestra el motivo, no el cuerpo crudo. */
export function mensajeDeError(err: unknown, porDefecto: string): string {
  if (err instanceof ApiError) {
    try {
      const m = JSON.parse(err.body).message;
      if (Array.isArray(m)) return m.join(' · ');
      if (typeof m === 'string' && m) return m;
    } catch {
      /* el cuerpo no era JSON: sale el mensaje por defecto */
    }
  }
  return porDefecto;
}
