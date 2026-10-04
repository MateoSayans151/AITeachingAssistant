// El mail con el que el docente invita a un alumno a rendir un examen: función pura (sin base ni red) para poder
// testearla sola. Recibe lo que el alumno tiene que saber (cuándo, cuánto dura, qué se monitorea, a dónde entrar) y lo
// convierte en asunto + HTML + texto plano. Quién lo manda y a quién (reply-to, modo prueba) lo decide InvitacionesService.
import { antiCheatActivo } from '../respuestas-examen/anticheat.util';
import { acortar, escaparHtml, MailArmado, unaLinea } from './mail-resultado.util';

export interface DatosMailInvitacion {
  nombreAlumno: string;
  /** El alumno se identifica solo con su email: se le dice con cuál tiene que ingresar. */
  emailAlumno: string;
  tituloExamen: string;
  nombreCurso?: string | null;
  nombreDocente: string;
  /** Ventana de la publicación a su comisión (null = sin límite de ese lado). Acepta Date o string ISO. */
  fechaInicio?: Date | string | null;
  fechaFin?: Date | string | null;
  /** Solo en los exámenes de sesión con tiempo. */
  duracionMinutos?: number | null;
  /** `Examen.antiCheat` tal cual viene de la base: se normaliza con `antiCheatActivo`. */
  antiCheat?: unknown;
  /** `ExamenComision.slugAcceso`: es lo único que identifica el link de esa comisión. */
  slugAcceso: string;
  /** Origen del front (FRONTEND_ORIGIN). Sin él, el de desarrollo. */
  frontendOrigin?: string | null;
  /** "Ahora", para decidir entre "Se habilita el…" y "Ya está disponible" (en los tests se fija). */
  ahora?: Date;
}

const MAX_TITULO_ASUNTO = 150;
const ORIGEN_POR_DEFECTO = 'http://localhost:3000';
const ZONA = 'America/Argentina/Buenos_Aires';

const formatoFecha = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: ZONA,
});

/** "martes 6 de octubre de 2026, 18:30 h", siempre en hora de Buenos Aires (el servidor puede estar en UTC). */
export function fechaLegible(fecha: Date): string {
  const p = Object.fromEntries(formatoFecha.formatToParts(fecha).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} de ${p.month} de ${p.year}, ${p.hour}:${p.minute} h`;
}

/** Una fecha que no se puede leer (null, vacía, inválida) se trata como "sin fecha". */
function aFecha(valor: Date | string | null | undefined): Date | null {
  if (valor == null || valor === '') return null;
  const f = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(f.getTime()) ? null : f;
}

/** El link de acceso de una publicación: `<origen del front>/rendir/<slug>`. */
export function urlDeRendir(frontendOrigin: string | null | undefined, slugAcceso: string): string {
  const origen = (frontendOrigin ?? '').trim().replace(/\/+$/, '') || ORIGEN_POR_DEFECTO;
  return `${origen}/rendir/${encodeURIComponent(slugAcceso)}`;
}

export function armarMailInvitacion(datos: DatosMailInvitacion): MailArmado {
  const alumno = unaLinea(datos.nombreAlumno ?? '');
  const email = unaLinea(datos.emailAlumno ?? '');
  const docente = unaLinea(datos.nombreDocente ?? '') || 'tu docente';
  const curso = datos.nombreCurso ? unaLinea(datos.nombreCurso) : '';
  const titulo = unaLinea(datos.tituloExamen ?? '');
  const subject = `Te invitaron a rendir "${acortar(titulo, MAX_TITULO_ASUNTO)}"`;
  const saludo = alumno ? `Hola ${alumno},` : 'Hola,';
  const url = urlDeRendir(datos.frontendOrigin, datos.slugAcceso);

  // ---- Cuándo se puede rendir ----
  const ahora = datos.ahora ?? new Date();
  const inicio = aFecha(datos.fechaInicio);
  const fin = aFecha(datos.fechaFin);
  const cuando = [
    inicio && inicio.getTime() > ahora.getTime() ? `Se habilita el ${fechaLegible(inicio)}.` : 'Ya está disponible.',
    ...(fin ? [`Podés rendirlo hasta el ${fechaLegible(fin)}.`] : []),
  ];

  const minutos = Number.isFinite(datos.duracionMinutos) && datos.duracionMinutos > 0 ? Math.round(datos.duracionMinutos) : 0;
  const duracion = minutos > 0 ? `Tenés ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} desde que empezás.` : null;

  // ---- Monitoreo (señales de integridad): el alumno tiene que saber qué se registra antes de empezar ----
  const cfg = antiCheatActivo(datos.antiCheat);
  const registra = cfg
    ? [
        ...(cfg.pantallaCompleta ? ['cada vez que salís de la pantalla completa'] : []),
        ...(cfg.cambioPestana ? ['cada vez que cambiás de pestaña o de ventana'] : []),
        ...(cfg.pegado ? ['cuando pegás texto en una respuesta'] : []),
      ]
    : [];
  const aviso =
    registra.length > 0
      ? `Este examen registra algunas señales mientras lo rendís: ${registra.join('; ')}. Son información para tu docente: no te bajan la nota automáticamente.`
      : null;

  const intro = `${docente} te invitó a rendir "${titulo}"${curso ? ` (${curso})` : ''}.`;
  const ingreso = `Ingresá con este mismo email: ${email}`;
  const pie = `Este mail lo envió AI Teaching Assistant en nombre de ${docente}. Si tenés dudas, respondé a este mail: le llega a tu docente.`;

  // ---- Texto plano ----
  const text = [
    saludo,
    '',
    intro,
    '',
    ...cuando,
    ...(duracion ? [duracion] : []),
    ...(aviso ? ['', aviso] : []),
    '',
    'Para rendir, entrá a este link:',
    url,
    '',
    ingreso,
    '',
    '--',
    pie,
  ].join('\n');

  // ---- HTML: tablas y estilos en línea, sin imágenes ni links externos salvo el del examen ----
  const fuente = 'font-family:Arial,Helvetica,sans-serif;color:#1f2933;';
  const parrafo = (contenido: string, extra = '') =>
    `<p style="${fuente}font-size:14px;line-height:21px;margin:0 0 8px 0;${extra}">${contenido}</p>`;
  const href = escaparHtml(url);

  const html =
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escaparHtml(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background-color:#f4f5f7;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f5f7;"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e4e7eb;border-radius:8px;"><tr><td style="padding:28px 28px 24px 28px;">` +
    `<p style="${fuente}font-size:16px;line-height:24px;margin:0 0 16px 0;">${escaparHtml(saludo)}</p>` +
    `<p style="${fuente}font-size:14px;line-height:21px;margin:0 0 4px 0;">${escaparHtml(docente)} te invitó a rendir</p>` +
    `<p style="${fuente}font-size:22px;line-height:28px;font-weight:bold;margin:0 0 4px 0;">${escaparHtml(titulo)}</p>` +
    (curso ? `<p style="${fuente}font-size:14px;line-height:20px;color:#52606d;margin:0 0 16px 0;">${escaparHtml(curso)}</p>` : `<div style="height:12px;line-height:12px;">&nbsp;</div>`) +
    cuando.map((linea) => parrafo(escaparHtml(linea))).join('') +
    (duracion ? parrafo(escaparHtml(duracion)) : '') +
    (aviso
      ? `<p style="${fuente}font-size:13px;line-height:19px;color:#52606d;background-color:#f4f5f7;border-radius:6px;padding:10px 12px;margin:16px 0 0 0;">${escaparHtml(aviso)}</p>`
      : '') +
    `<p style="margin:24px 0 16px 0;"><a href="${href}" style="${fuente}display:inline-block;background-color:#1f4fd8;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;padding:12px 22px;border-radius:6px;">Ir al examen</a></p>` +
    `<p style="${fuente}font-size:12px;line-height:18px;color:#52606d;margin:0 0 4px 0;">Si el botón no abre, copiá este link en el navegador:</p>` +
    `<p style="${fuente}font-size:12px;line-height:18px;margin:0 0 16px 0;word-break:break-all;"><a href="${href}" style="color:#1f4fd8;">${escaparHtml(url)}</a></p>` +
    `<p style="${fuente}font-size:14px;line-height:21px;font-weight:bold;margin:0;">${escaparHtml(ingreso)}</p>` +
    `<p style="${fuente}font-size:12px;line-height:18px;color:#7b8794;margin:28px 0 0 0;border-top:1px solid #e4e7eb;padding-top:16px;">${escaparHtml(pie)}</p>` +
    `</td></tr></table></td></tr></table></body></html>`;

  return { subject, html, text };
}
