// El mail con el código de acceso (OTP) para rendir un examen. Función pura, como las demás plantillas.
import { escaparHtml, MailArmado, unaLinea } from './mail-resultado.util';

export interface DatosMailCodigo {
  codigo: string;
  tituloExamen: string;
  nombreComision?: string | null;
  /** Cuánto dura el código, en minutos. */
  validezMinutos: number;
}

export function armarMailCodigo(datos: DatosMailCodigo): MailArmado {
  const titulo = unaLinea(datos.tituloExamen ?? '');
  const comision = datos.nombreComision ? unaLinea(datos.nombreComision) : '';
  const subject = `Tu código para rendir: ${datos.codigo}`;
  const linea1 = `Tu código para rendir "${titulo}"${comision ? ` (${comision})` : ''} es:`;
  const linea2 = `Vale ${datos.validezMinutos} minutos y se puede usar una sola vez. Si vos no lo pediste, ignorá este mail: nadie puede entrar sin el código.`;

  const text = [linea1, '', datos.codigo, '', linea2].join('\n');
  const fuente = 'font-family:Arial,Helvetica,sans-serif;color:#1f2933;';
  const html =
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escaparHtml(subject)}</title></head><body style="margin:0;padding:0;background-color:#f4f5f7;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#ffffff;border:1px solid #e4e7eb;border-radius:8px;"><tr><td style="padding:28px;">` +
    `<p style="${fuente}font-size:14px;line-height:21px;margin:0 0 12px 0;">${escaparHtml(linea1)}</p>` +
    `<p style="${fuente}font-size:34px;line-height:40px;font-weight:bold;letter-spacing:8px;margin:0 0 16px 0;">${escaparHtml(datos.codigo)}</p>` +
    `<p style="${fuente}font-size:13px;line-height:19px;color:#52606d;margin:0;">${escaparHtml(linea2)}</p>` +
    `</td></tr></table></td></tr></table></body></html>`;
  return { subject, html, text };
}
