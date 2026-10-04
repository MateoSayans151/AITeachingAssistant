// Pantalla completa con las diferencias de Safari:
//  - Safari de escritorio anterior a 16.4 solo tiene la versión con prefijo (webkit...).
//  - iPhone no permite pantalla completa para una página (solo para video): ahí el control no se
//    puede cumplir, y hay que avisarlo en vez de dejar al alumno con un botón que no hace nada.
// Todas estas funciones hay que llamarlas en el navegador (handlers o efectos), no al renderizar.

type DocumentoFS = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type ElementoFS = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const doc = () => document as DocumentoFS;

function silenciar(resultado: Promise<void> | void) {
  // Con prefijo, el método no devuelve una promesa; sin prefijo, si se rechaza no debe ser un error no capturado.
  if (resultado && typeof (resultado as Promise<void>).catch === 'function') (resultado as Promise<void>).catch(() => undefined);
}

export function pantallaCompletaSoportada(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.documentElement as ElementoFS;
  const habilitada = doc().fullscreenEnabled ?? doc().webkitFullscreenEnabled ?? false;
  return habilitada && !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

export function enPantallaCompleta(): boolean {
  return !!(doc().fullscreenElement ?? doc().webkitFullscreenElement);
}

/** Tiene que llamarse de forma síncrona dentro de un click: Safari es estricto con ese gesto. */
export function entrarPantallaCompleta() {
  const el = document.documentElement as ElementoFS;
  try {
    silenciar(el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.());
  } catch {
    /* el navegador lo rechazó: queda fuera de pantalla completa */
  }
}

export function salirDePantallaCompleta() {
  if (!enPantallaCompleta()) return;
  try {
    silenciar(doc().exitFullscreen ? doc().exitFullscreen() : doc().webkitExitFullscreen?.());
  } catch {
    /* ignorar */
  }
}

/** Escucha entradas y salidas de pantalla completa (con y sin prefijo). Devuelve cómo dejar de escuchar. */
export function alCambiarPantallaCompleta(cb: () => void): () => void {
  document.addEventListener('fullscreenchange', cb);
  document.addEventListener('webkitfullscreenchange', cb);
  return () => {
    document.removeEventListener('fullscreenchange', cb);
    document.removeEventListener('webkitfullscreenchange', cb);
  };
}
