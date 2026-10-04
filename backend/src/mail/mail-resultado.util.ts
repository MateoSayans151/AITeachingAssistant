// El mail con la nota del alumno: función pura (sin base ni red) para poder testearla sola. Recibe el resultado que ya
// armó `armarResultadoParaAlumno` (solo lo que el alumno puede ver) y lo convierte en asunto + HTML + texto plano.
import type { ResultadoParaAlumno } from '../respuestas-examen/resultado.util';

export interface DatosMailResultado {
  nombreAlumno: string;
  nombreDocente: string;
  nombreCurso?: string | null;
}

export interface MailArmado {
  subject: string;
  html: string;
  text: string;
}

/** Los enunciados pueden ser párrafos enteros: en la tabla se muestra el principio. */
const MAX_ENUNCIADO = 200;
const MAX_TITULO_ASUNTO = 150;
/** Tolerancia al comparar la suma por pregunta con la nota total (los decimales vienen redondeados a 2). */
const TOLERANCIA_SUMA = 0.01;

const formatoNota = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const nota = (n: number) => formatoNota.format(n);

/** Todo texto variable (nombre, título, enunciado, feedback) pasa por acá antes de entrar al HTML. */
export function escaparHtml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const unaLinea = (texto: string) => texto.replace(/\s+/g, ' ').trim();

function acortar(texto: string, max: number): string {
  const t = unaLinea(texto);
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

/**
 * ¿La tabla por pregunta suma la nota total? Si el docente editó la nota total a mano, o aplicó una vara, los
 * puntajes por pregunta ya no explican la nota: mostrar un detalle que no suma confunde más de lo que aclara.
 */
export function detalleSumaLaNota(r: Pick<ResultadoParaAlumno, 'notaFinal' | 'porPregunta'>): boolean {
  if (r.porPregunta.length === 0) return false;
  const suma = r.porPregunta.reduce((acc, p) => acc + p.notaFinal, 0);
  return Math.abs(suma - r.notaFinal) <= TOLERANCIA_SUMA + 1e-9;
}

export function armarMailResultado(resultado: ResultadoParaAlumno, datos: DatosMailResultado): MailArmado {
  const alumno = unaLinea(datos.nombreAlumno);
  const docente = unaLinea(datos.nombreDocente) || 'tu docente';
  const curso = datos.nombreCurso ? unaLinea(datos.nombreCurso) : '';
  const titulo = unaLinea(resultado.titulo);
  const subject = `Tu nota en "${acortar(titulo, MAX_TITULO_ASUNTO)}"`;

  const escala = resultado.escala.min === 0 ? '' : ` (escala de ${nota(resultado.escala.min)} a ${nota(resultado.escala.max)})`;
  const notaTexto = `${nota(resultado.notaFinal)} sobre ${nota(resultado.escala.max)}${escala}`;
  const saludo = alumno ? `Hola ${alumno},` : 'Hola,';
  const feedback = resultado.feedback?.trim() ? resultado.feedback.replace(/\r\n?/g, '\n').trim() : null;
  const detalle = detalleSumaLaNota(resultado) ? resultado.porPregunta : [];
  const pie = `Este mail lo envió AI Teaching Assistant en nombre de ${docente}. Si tenés dudas sobre tu nota, respondé a este mail: le llega a tu docente.`;
  const contexto = curso ? `${titulo} · ${curso}` : titulo;

  // ---- Texto plano ----
  const text = [
    saludo,
    '',
    `Tu nota en "${titulo}"${curso ? ` (${curso})` : ''}: ${notaTexto}`,
    ...(feedback ? ['', 'Comentarios de tu docente:', feedback] : []),
    ...(detalle.length > 0
      ? ['', 'Detalle por pregunta:', ...detalle.map((p) => `- ${acortar(p.enunciado, MAX_ENUNCIADO)}: ${nota(p.notaFinal)} de ${nota(p.puntajeMaximo)}`)]
      : []),
    '',
    '--',
    pie,
  ].join('\n');

  // ---- HTML: tablas y estilos en línea, sin imágenes ni links externos (lo que soportan todos los clientes de mail) ----
  const fuente = 'font-family:Arial,Helvetica,sans-serif;color:#1f2933;';
  const filas = detalle
    .map(
      (p) =>
        `<tr><td style="${fuente}font-size:14px;line-height:20px;padding:8px 12px 8px 0;border-bottom:1px solid #e4e7eb;">${escaparHtml(acortar(p.enunciado, MAX_ENUNCIADO))}</td>` +
        `<td align="right" style="${fuente}font-size:14px;line-height:20px;padding:8px 0;border-bottom:1px solid #e4e7eb;white-space:nowrap;">${nota(p.notaFinal)} / ${nota(p.puntajeMaximo)}</td></tr>`,
    )
    .join('');
  const bloqueDetalle =
    detalle.length > 0
      ? `<p style="${fuente}font-size:14px;font-weight:bold;margin:24px 0 8px 0;">Detalle por pregunta</p>` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${filas}</table>`
      : '';
  const bloqueFeedback = feedback
    ? `<p style="${fuente}font-size:14px;font-weight:bold;margin:24px 0 8px 0;">Comentarios de tu docente</p>` +
      `<p style="${fuente}font-size:14px;line-height:21px;margin:0;">${escaparHtml(feedback).replace(/\n/g, '<br>')}</p>`
    : '';

  const html =
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escaparHtml(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background-color:#f4f5f7;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f5f7;"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e4e7eb;border-radius:8px;"><tr><td style="padding:28px 28px 24px 28px;">` +
    `<p style="${fuente}font-size:16px;line-height:24px;margin:0 0 16px 0;">${escaparHtml(saludo)}</p>` +
    `<p style="${fuente}font-size:14px;line-height:20px;color:#52606d;margin:0 0 4px 0;">${escaparHtml(contexto)}</p>` +
    `<p style="${fuente}font-size:28px;line-height:34px;font-weight:bold;margin:0;">${escaparHtml(notaTexto)}</p>` +
    bloqueFeedback +
    bloqueDetalle +
    `<p style="${fuente}font-size:12px;line-height:18px;color:#7b8794;margin:28px 0 0 0;border-top:1px solid #e4e7eb;padding-top:16px;">${escaparHtml(pie)}</p>` +
    `</td></tr></table></td></tr></table></body></html>`;

  return { subject, html, text };
}
