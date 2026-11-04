'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  NOMBRES_DIAS_SEMANA,
  acotarNumero,
  compararDias,
  diasDelMes,
  fechaHoraLegible,
  formatearFechaHora,
  mismoDia,
  moverDia,
  moverMes,
  nombreDelMes,
  parsearFechaHora,
} from '@/lib/calendario';
import type { FechaHora } from '@/lib/calendario';

/** «noviembre de 2026» → «Noviembre de 2026» (solo la primera letra: «de» va en minúscula). */
const capitalizar = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

const hoyComoFecha = () => {
  const d = new Date();
  return { año: d.getFullYear(), mes: d.getMonth(), dia: d.getDate() };
};

/**
 * Selector de fecha y hora con el aspecto del resto de la app (el calendario del navegador no se puede estilar). El valor es el mismo texto que
 * usa `<input type="datetime-local">` ("2026-11-03T21:19", hora local): se puede cambiar uno por otro sin tocar nada más. Calendario que empieza en
 * lunes, hora y minutos aparte, y teclado: flechas para moverse entre días, RePág/AvPág para cambiar de mes, Enter para elegir, Esc para cerrar.
 */
export function SelectorFecha({
  id,
  value,
  onChange,
  ariaLabel,
  disabled = false,
  placeholder = 'dd/mm/aaaa hh:mm',
  minimo,
  limpiable = true,
  ariaInvalid,
  ariaDescribedBy,
}: {
  id?: string;
  value: string;
  onChange: (valor: string) => void;
  ariaLabel?: string;
  disabled?: boolean;
  placeholder?: string;
  /** Los días anteriores a esta fecha ("2026-11-03T00:00") no se pueden elegir. */
  minimo?: string;
  /** Muestra «Borrar» (la fecha puede quedar vacía). */
  limpiable?: boolean;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
}) {
  const idAuto = useId();
  const idBoton = id ?? `fecha-${idAuto}`;
  const boton = useRef<HTMLButtonElement>(null);
  const calendario = useRef<HTMLDivElement>(null);
  const actual = parsearFechaHora(value);
  const min = parsearFechaHora(minimo);
  const [abierto, setAbierto] = useState(false);
  const base = actual ?? { ...hoyComoFecha(), hora: 9, minuto: 0 };
  const [vista, setVista] = useState({ año: base.año, mes: base.mes });
  const [foco, setFoco] = useState<{ año: number; mes: number; dia: number }>(base);
  const [pos, setPos] = useState<{ left: number; top: number; arriba: boolean } | null>(null);
  // Alto del calendario ya dibujado (cambia con el mes: 5 o 6 semanas no, siempre 6, pero sí con el ancho de pantalla): se mide para que nunca se corte.
  const [altoReal, setAltoReal] = useState(0);
  const [horaTexto, setHoraTexto] = useState(String(base.hora).padStart(2, '0'));
  const [minutoTexto, setMinutoTexto] = useState(String(base.minuto).padStart(2, '0'));

  const abrir = () => {
    if (disabled) return;
    const b = parsearFechaHora(value) ?? { ...hoyComoFecha(), hora: 9, minuto: 0 };
    setVista({ año: b.año, mes: b.mes });
    setFoco(b);
    setHoraTexto(String(b.hora).padStart(2, '0'));
    setMinutoTexto(String(b.minuto).padStart(2, '0'));
    setAbierto(true);
  };

  const cerrar = useCallback((devolverFoco = true) => {
    setAbierto(false);
    if (devolverFoco) boton.current?.focus();
  }, []);

  const ubicar = useCallback(() => {
    const r = boton.current?.getBoundingClientRect();
    if (!r) return;
    const alto = altoReal || 465;
    const espacioAbajo = window.innerHeight - r.bottom;
    const arriba = espacioAbajo < alto && r.top > espacioAbajo;
    const ancho = Math.min(320, window.innerWidth - 16);
    // Hacia el lado con más lugar; si ni así entra, se corre para quedar entero dentro de la pantalla (puede tapar el campo, pero no se corta).
    const top = Math.max(8, Math.min(arriba ? r.top - alto - 4 : r.bottom + 4, window.innerHeight - alto - 8));
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - ancho - 8)), top, arriba });
  }, [altoReal]);

  // Una vez dibujado, se mide su alto real y se reubica si difiere de la estimación.
  useLayoutEffect(() => {
    const h = calendario.current?.offsetHeight;
    if (abierto && h && Math.abs(h - altoReal) > 1) setAltoReal(h);
  }, [abierto, pos, altoReal]);

  useLayoutEffect(() => {
    if (!abierto) return;
    ubicar();
    window.addEventListener('resize', ubicar);
    window.addEventListener('scroll', ubicar, true);
    return () => {
      window.removeEventListener('resize', ubicar);
      window.removeEventListener('scroll', ubicar, true);
    };
  }, [abierto, ubicar]);

  useEffect(() => {
    if (!abierto) return;
    const alTocar = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (boton.current?.contains(t) || calendario.current?.contains(t)) return;
      cerrar(false);
    };
    document.addEventListener('mousedown', alTocar);
    document.addEventListener('touchstart', alTocar);
    return () => {
      document.removeEventListener('mousedown', alTocar);
      document.removeEventListener('touchstart', alTocar);
    };
  }, [abierto, cerrar]);

  // El foco entra al día elegido (o a hoy) al abrir, y sigue a las flechas.
  useEffect(() => {
    if (!abierto || !pos) return;
    calendario.current?.querySelector<HTMLElement>(`[data-dia="${foco.año}-${foco.mes}-${foco.dia}"]`)?.focus({ preventScroll: true });
  }, [abierto, pos, foco]);

  const horaActual = () => acotarNumero(horaTexto, 23, base.hora);
  const minutoActual = () => acotarNumero(minutoTexto, 59, base.minuto);

  function elegirDia(d: { año: number; mes: number; dia: number }) {
    if (min && compararDias(d, min) < 0) return;
    const f: FechaHora = { ...d, hora: horaActual(), minuto: minutoActual() };
    onChange(formatearFechaHora(f));
    setFoco(d);
  }

  /** Cambiar la hora o los minutos con un día ya elegido actualiza el valor al instante. */
  function aplicarHora(h: number, m: number) {
    if (actual) onChange(formatearFechaHora({ ...actual, hora: h, minuto: m }));
  }

  function moverFoco(delta: number) {
    const nuevo = moverDia(foco, delta);
    setFoco(nuevo);
    if (nuevo.mes !== vista.mes || nuevo.año !== vista.año) setVista({ año: nuevo.año, mes: nuevo.mes });
  }

  function cambiarMes(delta: number) {
    const v = moverMes(vista.año, vista.mes, delta);
    setVista(v);
    setFoco({ ...v, dia: Math.min(foco.dia, new Date(v.año, v.mes + 1, 0).getDate()) });
  }

  function alTeclearDia(e: React.KeyboardEvent) {
    const k = e.key;
    const pasos: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (k in pasos) {
      e.preventDefault();
      moverFoco(pasos[k]);
    } else if (k === 'PageUp' || k === 'PageDown') {
      e.preventDefault();
      cambiarMes(k === 'PageUp' ? -1 : 1);
    } else if (k === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // no cierra también el diálogo que lo contiene
      cerrar();
    }
  }

  const hoy = hoyComoFecha();
  const dias = diasDelMes(vista.año, vista.mes);

  return (
    <>
      <button
        ref={boton}
        id={idBoton}
        type="button"
        className={`desplegable ${abierto ? 'desplegable-abierto' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        onClick={() => (abierto ? cerrar() : abrir())}
        onKeyDown={(e) => {
          if (!abierto && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            abrir();
          }
        }}
      >
        <span className={actual ? undefined : 'desplegable-placeholder'}>{actual ? fechaHoraLegible(value) : placeholder}</span>
        <svg className="desplegable-flecha" viewBox="0 0 16 16" aria-hidden="true" focusable="false" style={{ transform: 'none' }}>
          <rect x="2" y="3" width="12" height="11" rx="2" />
          <path d="M2 7h12M5.5 1.5v3M10.5 1.5v3" />
        </svg>
      </button>

      {abierto &&
        pos &&
        createPortal(
          <div
            ref={calendario}
            className="fecha-calendario"
            role="dialog"
            aria-label="Elegir fecha y hora"
            style={{ left: pos.left, top: pos.top, maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' }}
            // El teclado de acá adentro es de este calendario: no llega al diálogo que lo contiene (Esc lo cerraría entero y Tab lo desordenaría).
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') {
                e.preventDefault();
                cerrar();
              }
            }}
          >
            <div className="fecha-cabecera">
              <button type="button" className="fecha-nav" onClick={() => cambiarMes(-1)} aria-label="Mes anterior">
                <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10 3L5 8l5 5" />
                </svg>
              </button>
              <strong aria-live="polite">{capitalizar(nombreDelMes(vista.año, vista.mes))}</strong>
              <button type="button" className="fecha-nav" onClick={() => cambiarMes(1)} aria-label="Mes siguiente">
                <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 3l5 5-5 5" />
                </svg>
              </button>
            </div>

            <div className="fecha-grilla" role="grid" aria-label={nombreDelMes(vista.año, vista.mes)}>
              {NOMBRES_DIAS_SEMANA.map((d, i) => (
                <div key={i} className="fecha-dia-semana" role="columnheader">
                  {d}
                </div>
              ))}
              {dias.map((d) => {
                const deshabilitado = !!min && compararDias(d, min) < 0;
                const elegido = !!actual && mismoDia(d, actual);
                const esFoco = mismoDia(d, foco);
                return (
                  <button
                    key={`${d.año}-${d.mes}-${d.dia}`}
                    type="button"
                    role="gridcell"
                    data-dia={`${d.año}-${d.mes}-${d.dia}`}
                    tabIndex={esFoco ? 0 : -1}
                    aria-selected={elegido}
                    aria-label={new Intl.DateTimeFormat('es-AR', { dateStyle: 'full' }).format(new Date(d.año, d.mes, d.dia))}
                    disabled={deshabilitado}
                    className={`fecha-dia ${d.delMes ? '' : 'fecha-dia-otro-mes'} ${mismoDia(d, hoy) ? 'fecha-dia-hoy' : ''} ${elegido ? 'fecha-dia-elegido' : ''}`}
                    onClick={() => elegirDia(d)}
                    onKeyDown={alTeclearDia}
                  >
                    {d.dia}
                  </button>
                );
              })}
            </div>

            <div className="fecha-hora">
              <label htmlFor={`${idBoton}-h`}>Hora</label>
              <input
                id={`${idBoton}-h`}
                inputMode="numeric"
                maxLength={2}
                value={horaTexto}
                onChange={(e) => setHoraTexto(e.target.value.replace(/\D/g, '').slice(0, 2))}
                onBlur={() => {
                  const h = horaActual();
                  setHoraTexto(String(h).padStart(2, '0'));
                  aplicarHora(h, minutoActual());
                }}
                aria-label="Hora (0 a 23)"
              />
              <span aria-hidden="true">:</span>
              <input
                inputMode="numeric"
                maxLength={2}
                value={minutoTexto}
                onChange={(e) => setMinutoTexto(e.target.value.replace(/\D/g, '').slice(0, 2))}
                onBlur={() => {
                  const m = minutoActual();
                  setMinutoTexto(String(m).padStart(2, '0'));
                  aplicarHora(horaActual(), m);
                }}
                aria-label="Minutos (0 a 59)"
              />
            </div>

            <div className="fecha-acciones">
              {limpiable && actual ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-chico"
                  onClick={() => {
                    onChange('');
                    cerrar();
                  }}
                >
                  Borrar
                </button>
              ) : (
                <button type="button" className="btn btn-ghost btn-chico" onClick={() => elegirDia(hoy)}>
                  Hoy
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary btn-chico"
                onClick={() => {
                  // «Listo» sin haber tocado ningún día: se queda con el día resaltado.
                  if (!actual) elegirDia(foco);
                  else aplicarHora(horaActual(), minutoActual());
                  cerrar();
                }}
              >
                Listo
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
