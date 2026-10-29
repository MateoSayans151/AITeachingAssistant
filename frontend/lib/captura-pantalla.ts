// Compartir la pantalla completa y sacar capturas para el docente (control "pantalla compartida" del anti-cheat).
//   - `compartirPantalla` pide la pantalla y VERIFICA lo que el alumno eligió (el navegador solo recibe una sugerencia).
//   - `capturarFrame` convierte lo que se ve en ese momento en un JPEG chico (para que entren muchas en el almacenamiento).
// Todo esto corre en el navegador del alumno: lo puede alterar. Por eso el servidor decide cuándo pide capturas y anota si faltan.
// Hay que llamarlo desde un clic (el navegador lo exige) y nunca durante el render.

export type ErrorCompartir = 'no_soportado' | 'cancelado' | 'superficie_no_permitida' | 'monitor_extendido' | 'error';

export class ErrorCompartirPantalla extends Error {
  constructor(public motivo: ErrorCompartir) {
    super(motivo);
  }
}

export const MENSAJES_COMPARTIR: Record<ErrorCompartir, string> = {
  no_soportado:
    'Este examen pide compartir la pantalla y tu dispositivo o navegador no lo permite (por ejemplo, un celular). Rendilo desde una computadora o consultá con tu docente.',
  cancelado: 'No compartiste la pantalla. Tocá el botón de nuevo y elegí “Pantalla completa” (o “Toda la pantalla”).',
  superficie_no_permitida: 'Elegiste una ventana o una pestaña. Tenés que compartir la pantalla completa: tocá el botón de nuevo y elegí “Pantalla completa”.',
  monitor_extendido: 'Detectamos más de un monitor. Desconectalo o desactivalo y volvé a intentar: el examen se rinde en una sola pantalla.',
  error:
    'No se pudo compartir la pantalla. Revisá que el navegador tenga permiso para grabar la pantalla (en Mac: Ajustes del Sistema → Privacidad → Grabación de pantalla) y probá de nuevo.',
};

type PantallaConExtension = Screen & { isExtended?: boolean };

export function compartirPantallaSoportada(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
}

/** true si el sistema tiene más de un monitor (solo Chromium lo informa; en otros navegadores no se puede saber). */
export function hayMonitorExtendido(): boolean {
  return typeof window !== 'undefined' && (window.screen as PantallaConExtension).isExtended === true;
}

export function pantallaActiva(stream: MediaStream | null | undefined): boolean {
  const pista = stream?.getVideoTracks()[0];
  return !!pista && pista.readyState === 'live';
}

export function detenerPantalla(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Pide la pantalla completa. Si lo que eligió el alumno no es una pantalla entera, la corta y falla. */
export async function compartirPantalla(): Promise<MediaStream> {
  if (!compartirPantallaSoportada()) throw new ErrorCompartirPantalla('no_soportado');
  if (hayMonitorExtendido()) throw new ErrorCompartirPantalla('monitor_extendido');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      // Sugerencias (solo Chromium las respeta): pantalla entera, sin pasar a otra pestaña, 1 cuadro por segundo alcanza.
      video: { displaySurface: 'monitor', frameRate: 1 } as MediaTrackConstraints,
      audio: false,
      monitorTypeSurfaces: 'include',
      surfaceSwitching: 'exclude',
      selfBrowserSurface: 'include',
    } as DisplayMediaStreamOptions);
  } catch (e) {
    const nombre = (e as DOMException)?.name;
    throw new ErrorCompartirPantalla(nombre === 'NotAllowedError' || nombre === 'AbortError' ? 'cancelado' : 'error');
  }
  const pista = stream.getVideoTracks()[0];
  // Lo pedido es solo una sugerencia: se comprueba lo que se eligió. Si el navegador no informa el tipo, se acepta.
  const superficie = (pista?.getSettings() as MediaTrackSettings & { displaySurface?: string })?.displaySurface;
  if (superficie && superficie !== 'monitor') {
    detenerPantalla(stream);
    throw new ErrorCompartirPantalla('superficie_no_permitida');
  }
  return stream;
}

const ANCHO_CAPTURA = 960;
const CALIDAD_JPEG = 0.55;

function aJpeg(fuente: CanvasImageSource, ancho: number, alto: number): string | null {
  const escala = Math.min(1, ANCHO_CAPTURA / ancho);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(ancho * escala);
  canvas.height = Math.round(alto * escala);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(fuente, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', CALIDAD_JPEG);
}

/** Un cuadro de lo que se ve ahora como "data:image/jpeg;base64,…", o null si el stream no está vivo o no tiene imagen todavía. */
export async function capturarFrame(stream: MediaStream): Promise<string | null> {
  if (!pantallaActiva(stream)) return null;
  // Chromium: ImageCapture saca el cuadro directo de la pista (anda aunque la pestaña esté en segundo plano).
  const ImageCaptureCtor = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { grabFrame(): Promise<ImageBitmap> } }).ImageCapture;
  if (ImageCaptureCtor) {
    try {
      const bmp = await new ImageCaptureCtor(stream.getVideoTracks()[0]).grabFrame();
      const jpeg = aJpeg(bmp, bmp.width, bmp.height);
      bmp.close();
      if (jpeg) return jpeg;
    } catch {
      /* se prueba con el <video> */
    }
  }
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await video.play();
    // El primer cuadro puede tardar un instante en llegar.
    for (let i = 0; i < 20 && (video.videoWidth === 0 || video.readyState < 2); i++) await new Promise((r) => setTimeout(r, 100));
    if (video.videoWidth === 0) return null;
    return aJpeg(video, video.videoWidth, video.videoHeight);
  } catch {
    return null;
  } finally {
    video.pause();
    video.srcObject = null;
  }
}
