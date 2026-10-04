// Cálculo de la vara: funciones puras (sin base de datos) para poder testearlas solas.

export const MODOS_VARA = ['porcentaje', 'puntos', 'aprobados_esperados'] as const;
export type ModoVara = (typeof MODOS_VARA)[number];

export interface ReglaVara {
  modo: ModoVara;
  // porcentaje: % sobre la nota sugerida (puede ser negativo). puntos: suma fija (puede ser negativa).
  // aprobados_esperados: % de alumnos que se espera que aprueben (0-100).
  valor: number;
  // Solo aprobados_esperados: nota mínima para aprobar, dentro de la escala.
  umbral?: number;
  // Solo aprobados_esperados: máximo desplazamiento en puntos que la regla puede aplicar (hacia arriba
  // o hacia abajo). Si no se indica, un cuarto del rango de la escala.
  tope?: number;
  // Solo aprobados_esperados. false/ausente: "al menos X%", solo sube notas. true: "alrededor de X%",
  // sube si aprueban menos de lo esperado y baja si aprueban más.
  permitirBajar?: boolean;
}

export interface EntradaVara {
  id: string;
  // Nota sugerida por la IA (o la final, si el docente ya la revisó).
  base: number;
  // false si el docente ya revisó la respuesta: cuenta para la distribución pero no se toca.
  ajustable: boolean;
}

export interface ResultadoVara {
  items: { id: string; base: number; despues: number }[];
  // Puntos de desplazamiento uniforme, con signo (solo aprobados_esperados; en los otros modos es null).
  desplazamiento: number | null;
  resumen: {
    total: number;
    ajustadas: number;
    aprobadosAntes: number | null;
    aprobadosDespues: number | null;
    // Solo aprobados_esperados: false si el tope (o la escala) impidió llegar al objetivo.
    alcanzable: boolean | null;
  };
}

const redondear = (n: number) => Math.round(n * 100) / 100;
const acotar = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

export function topeVara(regla: ReglaVara, escalaMin: number, escalaMax: number) {
  return regla.tope ?? redondear((escalaMax - escalaMin) / 4);
}

/** Devuelve un mensaje si la regla no es válida para la escala, o null si lo es. */
export function validarRegla(regla: ReglaVara, escalaMin: number, escalaMax: number): string | null {
  const rango = escalaMax - escalaMin;
  if (!MODOS_VARA.includes(regla.modo)) return 'Modo de vara desconocido';
  if (!Number.isFinite(regla.valor)) return 'El valor de la vara no es un número';
  if (regla.modo === 'porcentaje' && (regla.valor < -100 || regla.valor > 100)) return 'El porcentaje tiene que estar entre -100 y 100';
  if (regla.modo === 'puntos' && Math.abs(regla.valor) > rango) return 'El ajuste en puntos no puede superar el rango de la escala';
  if (regla.modo === 'aprobados_esperados') {
    if (regla.valor < 0 || regla.valor > 100) return 'El porcentaje de aprobados esperado tiene que estar entre 0 y 100';
    if (regla.umbral === undefined || !Number.isFinite(regla.umbral)) return 'Falta la nota de aprobación';
    if (regla.umbral < escalaMin || regla.umbral > escalaMax) return 'La nota de aprobación tiene que estar dentro de la escala';
    if (regla.tope !== undefined && (!(regla.tope >= 0) || regla.tope > rango)) return 'El tope de desplazamiento tiene que estar entre 0 y el rango de la escala';
  } else if (regla.umbral !== undefined || regla.tope !== undefined || regla.permitirBajar !== undefined) {
    return 'El umbral, el tope y permitirBajar solo aplican al modo aprobados_esperados';
  }
  return null;
}

export function calcularVara(entradas: EntradaVara[], regla: ReglaVara, escalaMin: number, escalaMax: number): ResultadoVara {
  const aplicar = (base: number, puntos: number) => redondear(acotar(base + puntos, escalaMin, escalaMax));
  let desplazamiento: number | null = null;
  let despuesDe: (base: number) => number;
  let objetivoAprobados: number | null = null;

  if (regla.modo === 'porcentaje') {
    despuesDe = (base) => redondear(acotar(base * (1 + regla.valor / 100), escalaMin, escalaMax));
  } else if (regla.modo === 'puntos') {
    despuesDe = (base) => aplicar(base, regla.valor);
  } else {
    // Todo en centésimos enteros: las notas se redondean a 2 decimales y una comparación contra el
    // umbral hecha con decimales puede fallar por un error de coma flotante.
    const cent = (n: number) => Math.round(n * 100);
    const umbralC = cent(regla.umbral as number);
    const topeC = cent(topeVara(regla, escalaMin, escalaMax));
    const total = entradas.length;
    const ajustables = entradas.filter((e) => e.ajustable).map((e) => cent(e.base));
    const fijasAprueban = entradas.filter((e) => !e.ajustable && cent(e.base) >= umbralC).length;
    // "Al menos X%" redondea hacia arriba; "alrededor de X%" al entero más cercano.
    const exacto = (regla.valor / 100) * total;
    const objetivo = regla.permitirBajar ? Math.round(exacto) : Math.ceil(exacto - 1e-9);
    const yaAprueban = fijasAprueban + ajustables.filter((c) => c >= umbralC).length;

    // Un desplazamiento uniforme: sube a todas las ajustables lo mínimo que completa a los aprobados que
    // faltan (el de la más cercana al umbral entre las que no llegan), o, si se puede bajar y sobran,
    // baja lo mínimo que saca a los que sobran (empezando por los que aprueban más justo).
    let d = 0;
    if (yaAprueban < objetivo) {
      const distancias = ajustables.filter((c) => c < umbralC).map((c) => umbralC - c).sort((a, b) => a - b);
      const faltan = objetivo - yaAprueban;
      d = faltan > distancias.length ? topeC : Math.min(distancias[faltan - 1], topeC);
    } else if (regla.permitirBajar && yaAprueban > objetivo) {
      // Para dejar a una con c >= umbral por debajo hay que restarle (c - umbral + 1) centésimos.
      const margenes = ajustables.filter((c) => c >= umbralC).map((c) => c - umbralC + 1).sort((a, b) => a - b);
      const sobran = yaAprueban - objetivo;
      d = -(sobran > margenes.length ? topeC : Math.min(margenes[sobran - 1], topeC));
    }
    desplazamiento = d / 100;
    despuesDe = (base) => aplicar(base, desplazamiento as number);
    objetivoAprobados = objetivo;
  }

  const items = entradas.filter((e) => e.ajustable).map((e) => ({ id: e.id, base: e.base, despues: despuesDe(e.base) }));
  const despues = new Map(items.map((i) => [i.id, i.despues]));

  const umbral = regla.modo === 'aprobados_esperados' ? (regla.umbral as number) : null;
  const contar = (nota: (e: EntradaVara) => number) => (umbral === null ? null : entradas.filter((e) => nota(e) >= umbral).length);
  const aprobadosDespues = contar((e) => despues.get(e.id) ?? e.base);
  // Se juzga por el resultado real (no por el cálculo): el tope o los bordes de la escala pueden impedirlo.
  const alcanzable =
    objetivoAprobados === null || aprobadosDespues === null
      ? null
      : regla.permitirBajar && (desplazamiento as number) < 0
        ? aprobadosDespues <= objetivoAprobados
        : aprobadosDespues >= objetivoAprobados;

  return {
    items,
    desplazamiento,
    resumen: {
      total: entradas.length,
      ajustadas: items.length,
      aprobadosAntes: contar((e) => (e.ajustable ? redondear(e.base) : e.base)),
      aprobadosDespues,
      alcanzable,
    },
  };
}

/** Texto para el docente: qué regla se aplicó y qué hizo con la nota. */
export function describirRegla(regla: ReglaVara, desplazamiento: number | null): string {
  if (regla.modo === 'porcentaje') return `ajuste de ${regla.valor > 0 ? '+' : ''}${regla.valor}% sobre la nota sugerida`;
  if (regla.modo === 'puntos') return `ajuste de ${regla.valor > 0 ? '+' : ''}${regla.valor} puntos`;
  const pts = desplazamiento === null ? '' : ` (desplazó ${desplazamiento > 0 ? '+' : ''}${desplazamiento} puntos)`;
  const cuanto = regla.permitirBajar ? 'alrededor de' : 'al menos';
  return `que aprueben ${cuanto} ${regla.valor}% con nota mínima ${regla.umbral}${pts}`;
}
