'use client';

// PasoPreguntas: el paso 2 del wizard. Recuadro con el total de puntos (pegado arriba mientras se scrollea, tiene que ser
// igual a la escala máxima) y el botón para repartir los puntos en partes iguales, la lista de <PreguntaCard/> (plegables,
// que se pueden subir, bajar y duplicar) y el menú "+ Agregar pregunta" con los tipos en dos grupos. No guarda la lista: el
// estado de las preguntas (incluido si cada una está plegada) vive en el padre. Solo tiene estado de interfaz: el menú
// abierto y los avisos de lo que acaba de pasar.
//
// Contrato:
//   PasoPreguntas({ preguntas, onChange, niveles, matrices, escalaMin, escalaMax, onUsarComoEscala, onMatrizCreada, errores })
//     preguntas          PreguntaForm[] (el estado vive en el padre).
//     onChange(next)     se llama con la lista completa ya modificada (pregunta editada, agregada, quitada, movida, duplicada,
//                        plegada, con los puntos repartidos o con una rúbrica copiada).
//     niveles            escala de niveles del examen (`datos.niveles`): para armar preguntas y criterios nuevos.
//     matrices           matrices de rúbrica del docente.
//     escalaMin/Max      `datos.escalaMin` / `datos.escalaMax` tal cual (strings del formulario): el total se compara con la máxima.
//     onUsarComoEscala(total)  el docente apretó "Usar X como escala máxima"; el padre pone `escalaMax = String(total)`.
//   Opcionales:
//     onMatrizCreada(m)  se pasa tal cual a cada <RubricaEditor/> (vía <PreguntaCard/>): se llamó al guardar una rúbrica como matriz;
//                        el padre agrega `m` a `matrices`.
//     errores            los mensajes de validación que muestra el padre ("Pregunta 3: falta el enunciado."). Cada vez que cambia el
//                        arreglo (OJO: por identidad, el padre tiene que pasar el mismo arreglo mientras no cambien) se despliegan las
//                        tarjetas que nombran y el foco y el scroll van a la primera; esas tarjetas muestran qué les falta.

import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { MatrizRubrica, TipoPregunta } from '@/lib/api';
import { esNumero, formatearPuntos, preguntaVacia, redondearPuntos, totalCoincideConEscala, totalDelExamen, validarPregunta } from '@/lib/examen-form';
import type { NivelForm, PreguntaForm } from '@/lib/examen-form';
import {
  agregarPreguntaPlegando,
  copiarRubricaA,
  desplegarPreguntas,
  duplicarPregunta,
  esPreguntaAbierta,
  hayPuntosCargados,
  indicesConError,
  moverPregunta,
  repartirPuntos,
  tieneCriteriosCargados,
} from '@/lib/examen-preguntas';
import { PreguntaCard, TIPOS_GRUPOS, TIPOS_LABEL } from './PreguntaCard';
import s from './PreguntaCard.module.css';

export interface PasoPreguntasProps {
  preguntas: PreguntaForm[];
  onChange: (next: PreguntaForm[]) => void;
  niveles: NivelForm[];
  matrices: MatrizRubrica[];
  escalaMin: string;
  escalaMax: string;
  onUsarComoEscala: (total: number) => void;
  onMatrizCreada?: (m: MatrizRubrica) => void;
  errores?: string[];
}

/** A dónde llevar el foco cuando la lista ya se redibujó con el cambio (la tarjeta nueva todavía no existía al pedirlo). */
interface FocoPendiente {
  indice: number;
  /** 'tarjeta': la tarjeta entera; 'enunciado': su enunciado (para escribir enseguida); 'mover': el botón que se acaba de usar. */
  que: 'tarjeta' | 'enunciado' | 'mover';
  /** Con 'mover': el botón preferido ('subir' | 'bajar'); si quedó deshabilitado (llegó a un extremo), el otro. */
  boton?: 'subir' | 'bajar';
  /** 'start': la tarjeta arriba de todo (pregunta nueva o con errores); 'nearest': solo si no se ve. */
  bloque: 'start' | 'nearest';
}

export function PasoPreguntas({ preguntas, onChange, niveles, matrices, escalaMin, escalaMax, onUsarComoEscala, onMatrizCreada, errores }: PasoPreguntasProps) {
  const raiz = useRef<HTMLDivElement>(null);
  const foco = useRef<FocoPendiente | null>(null);
  const [aviso, setAviso] = useState(''); // visible un rato: lo que hizo "Repartir" o "usar esta rúbrica en todas"
  const [anuncio, setAnuncio] = useState(''); // solo para lectores de pantalla: pregunta agregada, movida, duplicada

  // Total a la vista mientras se arman las preguntas: tiene que ser igual a la escala máxima.
  const total = totalDelExamen(preguntas);
  const max = esNumero(escalaMax) ? Number(escalaMax) : null;
  const coincide = max !== null && totalCoincideConEscala(total, max);
  const diferencia = max !== null ? redondearPuntos(max - total) : 0; // > 0: faltan puntos; < 0: sobran
  const puedeUsarComoEscala = max !== null && !coincide && (!esNumero(escalaMin) || total > Number(escalaMin));

  // Repartir la escala máxima en partes iguales: solo con una escala válida (> 0), con preguntas y si a cada una le toca algo.
  const reparto = max !== null && max > 0 ? repartirPuntos(preguntas.length, max) : [];
  const puedeRepartir = reparto.length > 0 && reparto.every((x) => Number(x) > 0);

  // Qué tarjetas nombran los errores del padre: se despliegan y muestran qué les falta mientras sigan incompletas.
  const marcadas = new Set(errores ? indicesConError(errores) : []);

  function enfocar(f: FocoPendiente) {
    const tarjeta = raiz.current?.querySelector<HTMLElement>(`[data-pregunta-indice="${f.indice}"]`);
    if (!tarjeta) return;
    let destino: HTMLElement | null = tarjeta;
    if (f.que === 'enunciado') destino = tarjeta.querySelector<HTMLElement>('[data-campo="enunciado"]') ?? tarjeta;
    if (f.que === 'mover') {
      const otro = f.boton === 'subir' ? 'bajar' : 'subir';
      destino =
        tarjeta.querySelector<HTMLElement>(`[data-accion="${f.boton}"]:not(:disabled)`) ??
        tarjeta.querySelector<HTMLElement>(`[data-accion="${otro}"]:not(:disabled)`) ??
        tarjeta;
    }
    // Sin scroll propio del foco: el scroll lo hace la tarjeta (con su margen, para que no la tape el recuadro del total).
    destino.focus({ preventScroll: true });
    tarjeta.scrollIntoView({ block: f.bloque });
  }

  // Después de cada redibujado: si había un foco pendiente (la lista cambió y recién ahora existe el elemento), se lo lleva.
  useEffect(() => {
    if (!foco.current) return;
    const pendiente = foco.current;
    foco.current = null;
    enfocar(pendiente);
  });

  // Errores de validación: cada vez que llega una lista nueva se despliegan las tarjetas nombradas y se va a la primera.
  useEffect(() => {
    if (!errores || errores.length === 0) return;
    const indices = indicesConError(errores).filter((i) => i < preguntas.length);
    if (indices.length === 0) return;
    const pendiente: FocoPendiente = { indice: indices[0], que: 'tarjeta', bloque: 'start' };
    const desplegadas = desplegarPreguntas(preguntas, indices);
    if (desplegadas === preguntas) {
      enfocar(pendiente); // ya estaban todas abiertas: no habrá redibujado que espere
    } else {
      foco.current = pendiente;
      onChange(desplegadas);
    }
    // Solo cuando cambia la lista de errores (no en cada tecla que el docente escribe en las preguntas).
  }, [errores]);

  // El aviso visible se borra solo.
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(''), 8000);
    return () => clearTimeout(t);
  }, [aviso]);

  function agregar(tipo: TipoPregunta) {
    foco.current = { indice: preguntas.length, que: 'enunciado', bloque: 'start' };
    onChange(agregarPreguntaPlegando(preguntas, { ...preguntaVacia(niveles), tipo }));
    setAnuncio(`Pregunta ${preguntas.length + 1} agregada: ${TIPOS_LABEL[tipo]}.`);
  }

  function mover(indice: number, delta: -1 | 1) {
    const destino = indice + delta;
    if (destino < 0 || destino >= preguntas.length) return;
    foco.current = { indice: destino, que: 'mover', boton: delta < 0 ? 'subir' : 'bajar', bloque: 'nearest' };
    onChange(moverPregunta(preguntas, indice, delta));
    setAnuncio(`Pregunta ${indice + 1} movida a la posición ${destino + 1} de ${preguntas.length}.`);
  }

  function duplicar(indice: number) {
    foco.current = { indice: indice + 1, que: 'tarjeta', bloque: 'nearest' };
    onChange(duplicarPregunta(preguntas, indice));
    setAnuncio(`Pregunta ${indice + 1} duplicada: la copia es la pregunta ${indice + 2}.`);
  }

  function repartirEnPartesIguales() {
    if (!puedeRepartir || max === null) return;
    if (hayPuntosCargados(preguntas) && !window.confirm('Esto reemplaza los puntos que cargaste. ¿Seguir?')) return;
    onChange(preguntas.map((p, i) => ({ ...p, puntajeMaximo: reparto[i] })));
    const partes = reparto.map((x) => formatearPuntos(Number(x)));
    setAviso(`Repartimos ${formatearPuntos(max)} pts entre ${preguntas.length} ${preguntas.length === 1 ? 'pregunta' : 'preguntas'}: ${partes.join(' / ')}.`);
  }

  /** "Usar esta rúbrica en todas las preguntas abiertas": copia los criterios de la pregunta `origen` a las demás abiertas (cada una conserva sus puntos). */
  function aplicarATodas(origen: number) {
    const destinos = preguntas.map((q, i) => i !== origen && esPreguntaAbierta(q));
    if (!destinos.some(Boolean)) return;
    if (!tieneCriteriosCargados(preguntas[origen])) {
      setAviso(`Cargá primero algún criterio en la pregunta ${origen + 1}: no hay nada para copiar.`);
      return;
    }
    const pisa = preguntas.some((q, i) => destinos[i] && tieneCriteriosCargados(q));
    if (pisa && !window.confirm('Esto reemplaza los criterios que ya cargaste en las otras preguntas abiertas. ¿Seguir?')) return;
    onChange(preguntas.map((q, i) => (destinos[i] ? copiarRubricaA(preguntas[origen], q) : q)));
    const cantidad = destinos.filter(Boolean).length;
    setAviso(`Copiamos la rúbrica de la pregunta ${origen + 1} a ${cantidad} ${cantidad === 1 ? 'pregunta abierta' : 'preguntas abiertas'}; cada una conserva sus puntos.`);
  }

  return (
    <div ref={raiz}>
      <div
        className="card"
        role="status"
        style={{
          position: 'sticky',
          top: 60, // debajo de la barra superior (que también es sticky)
          zIndex: 25,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          marginBottom: 16,
          borderColor: coincide ? 'var(--color-success)' : 'var(--color-accent)',
          color: coincide ? 'var(--color-success)' : 'var(--color-accent-800)',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
            Total del examen: {formatearPuntos(total)}
            {max !== null && ` de ${formatearPuntos(max)}`} pts
          </strong>
          {max !== null && (
            <span className={`badge ${coincide ? 'badge-revisado' : 'badge-pendiente'}`}>
              {coincide ? 'OK' : diferencia > 0 ? `Faltan ${formatearPuntos(diferencia)} pts` : `Sobran ${formatearPuntos(-diferencia)} pts`}
            </span>
          )}
        </div>
        <div className={s.accionesTotal}>
          <button
            type="button"
            className={`btn btn-secondary ${s.btnTotal}`}
            onClick={repartirEnPartesIguales}
            disabled={!puedeRepartir}
            title="Pone los mismos puntos en cada pregunta para que el total sea la escala máxima"
          >
            {max !== null && max > 0 ? `Repartir ${formatearPuntos(max)} pts en partes iguales` : 'Repartir en partes iguales'}
          </button>
          {puedeUsarComoEscala && (
            <button type="button" className={`btn btn-secondary ${s.btnTotal}`} onClick={() => onUsarComoEscala(redondearPuntos(total))}>
              Usar {formatearPuntos(total)} como escala máxima
            </button>
          )}
        </div>
      </div>
      <div className={s.aviso} aria-live="polite">
        {aviso}
      </div>
      <div className={s.soloLectores} aria-live="polite">
        {anuncio}
      </div>

      {preguntas.map((p, pi) => (
        <PreguntaCard
          key={pi}
          indice={pi}
          pregunta={p}
          onChange={(nueva) => onChange(preguntas.map((x, i) => (i === pi ? nueva : x)))}
          onQuitar={() => onChange(preguntas.filter((_, i) => i !== pi))}
          cantidadPreguntas={preguntas.length}
          niveles={niveles}
          matrices={matrices}
          onMover={(delta) => mover(pi, delta)}
          onDuplicar={() => duplicar(pi)}
          esPrimera={pi === 0}
          esUltima={pi === preguntas.length - 1}
          onMatrizCreada={onMatrizCreada}
          // Sin otras preguntas abiertas no hay a dónde copiar: no se ofrece.
          onAplicarATodas={preguntas.some((q, i) => i !== pi && esPreguntaAbierta(q)) ? () => aplicarATodas(pi) : undefined}
          errores={marcadas.has(pi) ? validarPregunta(p, pi) : undefined}
        />
      ))}

      <MenuAgregarPregunta onElegir={agregar} />
    </div>
  );
}

/** Alto con el que entra entero el menú de tipos (px): con menos lugar se scrollea por dentro. */
const MENU_ALTO_IDEAL = 560;

/**
 * "+ Agregar pregunta": un botón que abre un menú con los tipos en dos grupos ("Se corrigen solas" / "Las corrige la IA"), cada
 * uno con su descripción. Teclado: al abrir el foco va al primer ítem; flechas, Inicio y Fin se mueven entre ítems; Esc cierra y
 * devuelve el foco al botón; Tab cierra y sigue con el elemento que viene después del botón. Un click afuera también cierra.
 */
function MenuAgregarPregunta({ onElegir }: { onElegir: (tipo: TipoPregunta) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [lugar, setLugar] = useState<{ arriba: boolean; alto: number }>({ arriba: false, alto: 560 });
  const contenedor = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const idMenu = useId();

  function abrir() {
    // El botón está al final de la lista: el menú se abre del lado que tenga más lugar (sin quedar debajo de la barra superior
    // pegada) y, si no entra entero, se queda con ese alto y se scrollea por dentro.
    const r = boton.current?.getBoundingClientRect();
    if (r) {
      const barra = document.querySelector('.topnav')?.getBoundingClientRect().bottom ?? 0;
      const abajo = window.innerHeight - r.bottom - 14;
      const arriba = r.top - Math.max(barra, 0) - 14;
      const hacerArriba = abajo < MENU_ALTO_IDEAL && arriba > abajo;
      setLugar({ arriba: hacerArriba, alto: Math.max(180, Math.min(MENU_ALTO_IDEAL, hacerArriba ? arriba : abajo)) });
    }
    setAbierto(true);
  }

  function cerrar(devolverFoco: boolean) {
    setAbierto(false);
    if (devolverFoco) boton.current?.focus();
  }

  // Al abrir, el foco va al primer ítem.
  useEffect(() => {
    if (abierto) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [abierto]);

  // Click (o toque) afuera cierra.
  useEffect(() => {
    if (!abierto) return;
    const alPresionar = (e: PointerEvent) => {
      if (!contenedor.current?.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('pointerdown', alPresionar);
    return () => document.removeEventListener('pointerdown', alPresionar);
  }, [abierto]);

  function alTeclear(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cerrar(true);
      return;
    }
    if (e.key === 'Tab') {
      // Se cierra y el foco vuelve al botón: el Tab (o Shift+Tab) sigue desde ahí, sin quedar el foco en un ítem que desaparece.
      cerrar(true);
      return;
    }
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const actual = items.indexOf(document.activeElement as HTMLElement);
    let siguiente = -1;
    if (e.key === 'ArrowDown') siguiente = (actual + 1) % items.length;
    else if (e.key === 'ArrowUp') siguiente = (actual - 1 + items.length) % items.length;
    else if (e.key === 'Home') siguiente = 0;
    else if (e.key === 'End') siguiente = items.length - 1;
    if (siguiente >= 0) {
      e.preventDefault();
      items[siguiente]?.focus();
    }
  }

  return (
    <div ref={contenedor} className={s.menuRaiz}>
      <button
        ref={boton}
        type="button"
        className="btn btn-secondary"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? idMenu : undefined}
        onClick={() => (abierto ? cerrar(false) : abrir())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !abierto) {
            e.preventDefault();
            abrir();
          }
        }}
      >
        + Agregar pregunta
      </button>
      {abierto && (
        <div ref={menu} id={idMenu} role="menu" aria-label="Tipo de pregunta para agregar" className={`${s.menu}${lugar.arriba ? ` ${s.menuArriba}` : ''}`} style={{ maxHeight: lugar.alto }} onKeyDown={alTeclear}>
          {TIPOS_GRUPOS.map((g) => (
            <div key={g.id} role="group" aria-labelledby={`${idMenu}-${g.id}`}>
              <div id={`${idMenu}-${g.id}`} className={s.menuGrupo}>
                {g.titulo}
              </div>
              {g.tipos.map(({ tipo, descripcion }) => (
                <button
                  key={tipo}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className={s.menuItem}
                  onClick={() => {
                    setAbierto(false);
                    onElegir(tipo);
                  }}
                >
                  <span className={s.menuItemTitulo}>{TIPOS_LABEL[tipo]}</span>
                  <span className={s.menuItemDesc}>{descripcion}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
