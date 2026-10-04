// Límites de tamaño de lo que manda el alumno. El cuerpo HTTP de autoguardado y entrega admite
// más que el resto de la API (100 KB) para poder rendir con respuestas largas; el tope del
// contenido va por debajo del tope del cuerpo para que el rechazo sea un 400 con mensaje claro.
export const LIMITE_CUERPO_RENDIR = '1mb';
export const MAX_CONTENIDO_BYTES = 900_000;
export const LIMITE_CUERPO_GENERAL = '100kb';
