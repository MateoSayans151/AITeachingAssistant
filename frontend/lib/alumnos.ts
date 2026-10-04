// Lógica pura del paso "Publicar" del wizard de nuevo examen (app/examenes/nuevo/PasoPublicar.tsx): detectar emails de alumnos
// con el dominio mal escrito, sugerir el nombre de la próxima comisión, validar las fechas de apertura y cierre y armar el
// resumen de una línea. Son funciones puras (sin React, sin red, sin leer el reloj salvo por el parámetro `ahora`) para poder
// testearlas con node:test (backend/test/alumnos-lista.test.ts). El parseo de la lista pegada vive en `lib/examen-form.ts`.

// ---------------------------------------------------------------- emails con el dominio mal escrito

// Terminaciones que no existen y que casi seguro son un error de tipeo: se reemplazan por la correcta. Va un solo cambio por
// dominio (el primero que coincida). Ninguna es un TLD real, así que no hay falsos positivos con dominios válidos.
const SUFIJOS_ERRONEOS: [malo: string, bueno: string][] = [
  ['.con', '.com'],
  ['.comm', '.com'],
  ['.cmo', '.com'],
  ['.ocm', '.com'],
  ['.comar', '.com.ar'],
  ['.com.arr', '.com.ar'],
  ['.com.ra', '.com.ar'],
  ['.edu.arr', '.edu.ar'],
  ['.eduar', '.edu.ar'],
  ['.edu.ra', '.edu.ar'],
];

// Errores de tipeo frecuentes en el nombre de los proveedores de correo más usados. Solo se corrigen estos nombres exactos
// (nada de distancia de edición: `mail.com` está a una letra de `gmail.com` y es un dominio real).
const NOMBRES_MAL_ESCRITOS: Record<string, string[]> = {
  gmail: ['gmial', 'gmal', 'gmaill', 'gamil', 'gnail', 'gmai', 'gmeil', 'gimail'],
  hotmail: ['hotmial', 'hotmal', 'hotmai', 'hotmaill', 'hotnail', 'hotmil', 'hitmail'],
  outlook: ['outlok', 'outloook', 'outlock', 'outllok', 'otlook'],
  yahoo: ['yahho', 'yaho', 'yahooo', 'yhaoo', 'yahou'],
  icloud: ['iclod', 'icloude', 'iclould', 'icoud'],
};

const CORRECTO_DE: Record<string, string> = {};
for (const [correcto, malos] of Object.entries(NOMBRES_MAL_ESCRITOS)) for (const malo of malos) CORRECTO_DE[malo] = correcto;

// Con estas terminaciones sí existen esos proveedores y se les escribe mal (por ejemplo `hotmail.com.ar` es válido).
const TERMINACIONES_CORREGIBLES = ['com', 'com.ar'];

// Gmail solo existe como `gmail.com`: cualquiera de estas terminaciones es un error.
const TERMINACIONES_ERRONEAS_DE_GMAIL = ['com.ar', 'co', 'cm', 'om', 'vom'];

/**
 * Si el dominio del email parece tener un error de tipeo (`gmial.com`, `gmail.con`, `hotmail.comar`, `yaho.com`…), devuelve el
 * email corregido (`ana@gmail.com`); si el dominio está bien (o no se reconoce el problema), devuelve null. Solo sugiere:
 * nunca cambia nada por su cuenta y conserva la parte local tal cual.
 */
export function sugerirCorreccionDominio(email: string): string | null {
  const limpio = email.trim();
  const arroba = limpio.lastIndexOf('@');
  if (arroba < 1) return null;
  const local = limpio.slice(0, arroba);
  const original = limpio.slice(arroba + 1).toLowerCase();
  if (!original.includes('.')) return null;

  let dominio = original;

  // 1) Terminación mal escrita (`.con`, `.comar`, `.com.arr`…).
  for (const [malo, bueno] of SUFIJOS_ERRONEOS) {
    if (dominio.length > malo.length && dominio.endsWith(malo)) {
      dominio = dominio.slice(0, -malo.length) + bueno;
      break;
    }
  }

  // 2) Nombre del proveedor mal escrito (`gmial`, `hotmal`, `yaho`…), solo con una terminación habitual.
  const punto = dominio.indexOf('.');
  const nombre = dominio.slice(0, punto);
  const terminacion = dominio.slice(punto + 1);
  const correcto = CORRECTO_DE[nombre];
  if (correcto && TERMINACIONES_CORREGIBLES.includes(terminacion)) dominio = `${correcto}.${terminacion}`;

  // 3) Gmail con una terminación que no existe (`gmail.com.ar`, `gmail.co`…).
  const [proveedor, ...resto] = dominio.split('.');
  if (proveedor === 'gmail' && TERMINACIONES_ERRONEAS_DE_GMAIL.includes(resto.join('.'))) dominio = 'gmail.com';

  return dominio === original ? null : `${local}@${dominio}`;
}

// ---------------------------------------------------------------- nombre sugerido para la comisión nueva

function normalizarNombre(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Nombre sugerido para la comisión nueva: "Comisión A", o la primera letra libre (B, C…) si ya existe una comisión con ese
 * nombre en el curso (sin distinguir mayúsculas ni acentos). Pasadas las 26 letras, numera: "Comisión 27".
 */
export function siguienteNombreComision(existentes: string[]): string {
  const ocupados = new Set(existentes.map(normalizarNombre));
  for (let i = 0; i < 26; i++) {
    const candidato = `Comisión ${String.fromCharCode(65 + i)}`;
    if (!ocupados.has(normalizarNombre(candidato))) return candidato;
  }
  let n = 27;
  while (ocupados.has(normalizarNombre(`Comisión ${n}`))) n++;
  return `Comisión ${n}`;
}

// ---------------------------------------------------------------- fechas de apertura y cierre

/** Valor de <input type="datetime-local"> ("2026-10-12T18:00", hora local) -> Date, o null si está vacío o no se entiende. */
function aFecha(valor: string): Date | null {
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Mensaje de error si las fechas no sirven para publicar, o null si están bien (o vacías: las dos son opcionales). El cierre
 * no puede ser pasado ni anterior (o igual) a la apertura. Una apertura pasada no es error: equivale a "habilitado ahora".
 */
export function validarFechasPublicacion(inicio: string, fin: string, ahora: Date = new Date()): string | null {
  const cierre = aFecha(fin);
  if (!cierre) return null;
  if (cierre.getTime() <= ahora.getTime()) return 'El cierre ya pasó: elegí una fecha y hora que todavía no hayan llegado.';
  const apertura = aFecha(inicio);
  if (apertura && cierre.getTime() <= apertura.getTime()) return 'El cierre tiene que ser posterior a la apertura.';
  return null;
}

const dos = (n: number) => String(n).padStart(2, '0');

/** "12/10 18:00" (es-AR: día/mes y 24 horas); con el año ("12/10/2027 18:00") si no es el de `ahora`. Null si la fecha no es válida. */
export function formatearFechaHora(valor: string, ahora: Date = new Date()): string | null {
  const d = aFecha(valor);
  if (!d) return null;
  const anio = d.getFullYear() === ahora.getFullYear() ? '' : `/${d.getFullYear()}`;
  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}${anio} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

/**
 * Resumen de una línea de lo que se va a publicar: "32 alumnos · se habilita ahora · cierra el 12/10 18:00 · 60 min por alumno".
 * Lo que no aplica se omite: sin cantidad conocida de alumnos, sin cierre o sin duración no se dice nada de eso. Sin apertura (o
 * con una apertura que ya pasó) se habilita ahora.
 */
export function resumenPublicacion(datos: {
  alumnos: number | null;
  inicio: string;
  fin: string;
  duracionMinutos?: number | null;
  ahora?: Date;
}): string {
  const ahora = datos.ahora ?? new Date();
  const partes: string[] = [];
  if (datos.alumnos !== null) partes.push(`${datos.alumnos} alumno${datos.alumnos === 1 ? '' : 's'}`);

  const apertura = aFecha(datos.inicio);
  partes.push(apertura && apertura.getTime() > ahora.getTime() ? `se habilita el ${formatearFechaHora(datos.inicio, ahora)}` : 'se habilita ahora');

  const cierre = formatearFechaHora(datos.fin, ahora);
  if (cierre) partes.push(`cierra el ${cierre}`);

  if (datos.duracionMinutos && datos.duracionMinutos > 0) partes.push(`${datos.duracionMinutos} min por alumno`);
  return partes.join(' · ');
}
