'use client';

// PasoPreguntas: las preguntas del examen. Sin preguntas muestra un estado vacío con las tres formas de empezar (sugerencias de
// la IA, escribir una, duplicar un examen anterior). Con preguntas: la barra "El examen vale N puntos" (pegada arriba mientras se
// scrollea), el panel de sugerencias de la IA (plegado), la lista de <PreguntaCard/> (plegables) y el menú "+ Agregar pregunta".
//
// Los puntos tienen UN solo modelo: el examen vale N y el sistema reparte N entre las preguntas en partes iguales; la que el
// docente edita a mano queda "fija" y las demás absorben la diferencia (`balancearPuntos`). Nunca se bloquea por puntos sin
// repartir: se muestra cuántos faltan o sobran. No guarda la lista: el estado de las preguntas (incluido si cada una está
// plegada) vive en el padre. Solo tiene estado de interfaz: el menú abierto y los avisos de lo que acaba de pasar.
//
// Contrato:
//   PasoPreguntas({ preguntas, onChange, niveles, matrices, escalaMin, escalaMax, onCambiarTotal, onUsarComoEscala, onMatrizCreada, errores })
//     preguntas          PreguntaForm[] (el estado vive en el padre).
//     onChange(next)     se llama con la lista completa ya modificada (pregunta editada, agregada, quitada, movida, duplicada,
//                        plegada, con los puntos repartidos o con una rúbrica copiada).
//     niveles            escala de niveles del examen (`datos.niveles`): para armar preguntas y criterios nuevos.
//     matrices           matrices de rúbrica del docente.
//     escalaMin/Max      `datos.escalaMin` / `datos.escalaMax` tal cual (strings del formulario): el total se compara con la máxima.
//     onCambiarTotal(valor)    el docente cambió "El examen vale N puntos"; el padre pone `escalaMax = valor` (el reparto se rehace acá).
//     onUsarComoEscala(total)  el docente apretó "Que el examen valga X"; el padre pone `escalaMax = String(total)`.
//   Opcionales:
//     onMatrizCreada(m)  se pasa tal cual a cada <RubricaEditor/> (vía <PreguntaCard/>): se llamó al guardar una rúbrica como matriz;
//                        el padre agrega `m` a `matrices`.
//     cursoId            curso elegido en el encabezado del examen ('' o 'nuevo' si todavía no hay uno): lo usa <PanelSugerirPreguntas/> para traer el material.
//     errores            los mensajes de validación que muestra el padre ("Pregunta 3: falta el enunciado."). Cada vez que cambia el
//                        arreglo (OJO: por identidad, el padre tiene que pasar el mismo arreglo mientras no cambien) se despliegan las
//                        tarjetas que nombran y el foco y el scroll van a la primera; esas tarjetas muestran qué les falta.

import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import Link from 'next/link';
import { useConfirmar } from '@/app/components/Confirmar';
import type { MatrizRubrica, TipoPregunta } from '@/lib/api';
import { esNumero, formatearPuntos, preguntaVacia, redondearPuntos, totalCoincideConEscala, totalDelExamen, validarPregunta } from '@/lib/examen-form';
import type { NivelForm, PreguntaForm } from '@/lib/examen-form';
import {
  agregarPreguntaPlegando,
  balancearPuntos,
  copiarRubricaA,
  desplegarPreguntas,
  duplicarPregunta,
  esPreguntaAbierta,
  hayPuntosFijados,
  indicesConError,
  moverPregunta,
  soltarPuntos,
  tieneCriteriosCargados,
} from '@/lib/examen-preguntas';
import { agregarSugerida } from '@/lib/sugerir-preguntas';
import { PanelSugerirPreguntas } from './PanelSugerirPreguntas';
import { PreguntaCard, TIPOS_GRUPOS, TIPOS_LABEL } from './PreguntaCard';
import s from './PreguntaCard.module.css';

export interface PasoPreguntasProps {
  preguntas: PreguntaForm[];
  onChange: (next: PreguntaForm[]) => void;
  niveles: NivelForm[];
  matrices: MatrizRubrica[];
  escalaMin: string;
  escalaMax: string;
  onCambiarTotal: (valor: string) => void;
  onUsarComoEscala: (total: number) => void;
  onMatrizCreada?: (m: MatrizRubrica) => void;
  cursoId?: string;
  errores?: string[];
}

/** A dónde llevar el foco cuando la lista ya se redibujó con el cambio (la tarjeta nueva todavía no existía al pedirlo). */
interface FocoPendiente {
  indice: number;
  /** 'tarjeta': la tarjeta entera; 'enunciado': su enunciado (para escribir enseguida). */
  que: 'tarjeta' | 'enunciado';
  /** 'start': la tarjeta arriba de todo (pregunta nueva o con errores); 'nearest': solo si no se ve. */
  bloque: 'start' | 'nearest';
}

export function PasoPreguntas({ preguntas, onChange, niveles, matrices, escalaMin, escalaMax, onCambiarTotal, onUsarComoEscala, onMatrizCreada, cursoId = '', errores }: PasoPreguntasProps) {
  const confirmar = useConfirmar();
  const raiz = useRef<HTMLDivElement>(null);
  const foco = useRef<FocoPendiente | null>(null);
  // La lista más reciente: agregar una sugerencia abierta espera la rúbrica de la IA y, mientras, el docente pudo seguir editando.
  const preguntasRef = useRef(preguntas);
  preguntasRef.current = preguntas;
  const [aviso, setAviso] = useState(''); // visible un rato: lo que hizo "Volver al reparto automático" o "usar esta rúbrica en todas"
  const [anuncio, setAnuncio] = useState(''); // solo para lectores de pantalla: pregunta agregada, movida, duplicada

  // El total a la vista: el examen vale `max` puntos y el reparto automático lo mantiene.
  const total = totalDelExamen(preguntas);
  const max = esNumero(escalaMax) ? Number(escalaMax) : null;
  const coincide = max !== null && totalCoincideConEscala(total, max);
  const diferencia = max !== null ? redondearPuntos(max - total) : 0; // > 0: faltan asignar; < 0: sobran
  const puedeUsarComoEscala = max !== null && !coincide && total > 0 && (!esNumero(escalaMin) || total > Number(escalaMin));
  const conPuntosFijados = hayPuntosFijados(preguntas);
  const hayCursoReal = cursoId !== '' && cursoId !== 'nuevo';

  // Reparto automático: después de CUALQUIER cambio (pregunta agregada, quitada, duplicada, total nuevo, borrador restaurado…) las
  // preguntas sin puntos fijados se reparten lo que queda. Es idempotente: si ya está repartido no devuelve otra lista.
  useEffect(() => {
    if (max === null) return;
    const balanceada = balancearPuntos(preguntas, max);
    if (balanceada !== preguntas) onChange(balanceada);
  }, [preguntas, max]);

  // Qué tarjetas nombran los errores del padre: se despliegan y muestran qué les falta mientras sigan incompletas.
  const marcadas = new Set(errores ? indicesConError(errores) : []);

  function enfocar(f: FocoPendiente) {
    const tarjeta = raiz.current?.querySelector<HTMLElement>(`[data-pregunta-indice="${f.indice}"]`);
    if (!tarjeta) return;
    let destino: HTMLElement | null = tarjeta;
    if (f.que === 'enunciado') destino = tarjeta.querySelector<HTMLElement>('[data-campo="enunciado"]') ?? tarjeta;
    // Sin scroll propio del foco: el scroll lo hace la tarjeta (con su margen, para que no la tape la barra del total).
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

  /** Agrega una pregunta sugerida por la IA (plegada, para no mover al docente de lugar) y devuelve en qué posición quedó. */
  function agregarDeSugerencia(nueva: PreguntaForm): number {
    const { lista, indice } = agregarSugerida(preguntasRef.current, nueva);
    onChange(lista);
    setAnuncio(`Pregunta ${indice + 1} agregada desde las sugerencias de la IA: ${TIPOS_LABEL[nueva.tipo]}.`);
    return indice;
  }

  /** «Ver en la lista» de una sugerencia ya agregada: despliega esa pregunta y lleva el foco ahí. */
  function editarDeSugerencia(indice: number) {
    if (indice < 0 || indice >= preguntasRef.current.length) return;
    foco.current = { indice, que: 'enunciado', bloque: 'start' };
    onChange(desplegarPreguntas(preguntasRef.current, [indice]));
    // Si ya estaba desplegada `onChange` no cambia nada y no hay redibujado que espere: se enfoca directo.
    if (!preguntasRef.current[indice].plegada) {
      const pendiente = foco.current;
      foco.current = null;
      if (pendiente) enfocar(pendiente);
    }
  }

  function mover(indice: number, delta: -1 | 1) {
    const destino = indice + delta;
    if (destino < 0 || destino >= preguntas.length) return;
    foco.current = { indice: destino, que: 'tarjeta', bloque: 'nearest' };
    onChange(moverPregunta(preguntas, indice, delta));
    setAnuncio(`Pregunta ${indice + 1} movida a la posición ${destino + 1} de ${preguntas.length}.`);
  }

  function duplicar(indice: number) {
    foco.current = { indice: indice + 1, que: 'tarjeta', bloque: 'nearest' };
    onChange(duplicarPregunta(preguntas, indice));
    setAnuncio(`Pregunta ${indice + 1} duplicada: la copia es la pregunta ${indice + 2}.`);
  }

  /** Quitar una pregunta: si ya tiene enunciado se pide confirmar (con una en blanco no hay nada que perder). */
  async function quitar(indice: number) {
    const q = preguntasRef.current[indice];
    if (!q) return;
    if (q.enunciado.trim() && !(await confirmar({ mensaje: `Se quita la pregunta ${indice + 1} con todo lo que escribiste.`, textoConfirmar: 'Quitar' }))) return;
    onChange(preguntasRef.current.filter((_, i) => i !== indice));
    setAnuncio(`Pregunta ${indice + 1} quitada.`);
  }

  async function volverAlRepartoAutomatico() {
    if (!(await confirmar({ mensaje: 'Los puntos que ajustaste a mano se reemplazan por un reparto en partes iguales.', textoConfirmar: 'Repartir' }))) return;
    onChange(soltarPuntos(preguntas));
    setAviso(`Repartimos ${max !== null ? `${formatearPuntos(max)} pts ` : ''}en partes iguales entre ${preguntas.length} ${preguntas.length === 1 ? 'pregunta' : 'preguntas'}.`);
  }

  /** "Usar esta rúbrica en todas las preguntas abiertas": copia los criterios de la pregunta `origen` a las demás abiertas (cada una conserva sus puntos). */
  async function aplicarATodas(origen: number) {
    const destinos = preguntas.map((q, i) => i !== origen && esPreguntaAbierta(q));
    if (!destinos.some(Boolean)) return;
    if (!tieneCriteriosCargados(preguntas[origen])) {
      setAviso(`Cargá primero algún criterio en la pregunta ${origen + 1}: no hay nada para copiar.`);
      return;
    }
    const pisa = preguntas.some((q, i) => destinos[i] && tieneCriteriosCargados(q));
    if (pisa && !(await confirmar({ mensaje: 'Esto reemplaza los criterios que ya cargaste en las otras preguntas abiertas.', textoConfirmar: 'Reemplazar' }))) return;
    onChange(preguntas.map((q, i) => (destinos[i] ? copiarRubricaA(preguntas[origen], q) : q)));
    const cantidad = destinos.filter(Boolean).length;
    setAviso(`Copiamos la rúbrica de la pregunta ${origen + 1} a ${cantidad} ${cantidad === 1 ? 'pregunta abierta' : 'preguntas abiertas'}; cada una conserva sus puntos.`);
  }

  const estadoTotal = coincide ? 'ok' : diferencia > 0 ? 'falta' : 'sobra';

  return (
    <div ref={raiz} className={s.raiz}>
      {preguntas.length > 0 && (
        <div className={s.barraTotal} role="status" data-estado={max === null ? 'falta' : estadoTotal}>
          <div className={s.totalCampo}>
            <label htmlFor="total-examen">El examen vale</label>
            <input
              id="total-examen"
              className={s.totalInput}
              type="number"
              min="1"
              step="any"
              value={escalaMax}
              onChange={(e) => {
                onCambiarTotal(e.target.value);
                const nuevo = e.target.value.trim() !== '' && Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : null;
                if (nuevo !== null && nuevo > 0) onChange(balancearPuntos(preguntas, nuevo));
              }}
            />
            <span>puntos</span>
          </div>
          <div className={s.totalEstado}>
            {max === null
              ? 'Indicá cuántos puntos vale el examen.'
              : coincide
                ? `✓ Los ${formatearPuntos(max)} puntos están repartidos${conPuntosFijados ? '' : ' en partes iguales'}`
                : diferencia > 0
                  ? `${formatearPuntos(diferencia)} pts sin asignar de ${formatearPuntos(max)}`
                  : `Sobran ${formatearPuntos(-diferencia)} pts sobre los ${formatearPuntos(max)}`}
          </div>
          <div className={s.accionesTotal}>
            {conPuntosFijados && (
              <button type="button" className={`btn btn-ghost ${s.btnTotal}`} onClick={volverAlRepartoAutomatico} title="Vuelve a repartir los puntos en partes iguales entre todas las preguntas">
                Repartir en partes iguales
              </button>
            )}
            {puedeUsarComoEscala && (
              <button type="button" className={`btn btn-secondary ${s.btnTotal}`} onClick={() => onUsarComoEscala(redondearPuntos(total))}>
                Que el examen valga {formatearPuntos(total)}
              </button>
            )}
          </div>
        </div>
      )}
      <div className={s.aviso} aria-live="polite">
        {aviso}
      </div>
      <div className={s.soloLectores} aria-live="polite">
        {anuncio}
      </div>

      {preguntas.length === 0 && (
        <div className={s.vacio}>
          <h2 className={s.vacioTitulo}>¿Cómo querés empezar?</h2>
          <p className="muted">Todo lo que genere la IA lo revisás vos antes de agregarlo al examen.</p>
          <div className={s.vacioFila}>
            <MenuAgregarPregunta onElegir={agregar} etiqueta="Escribir una pregunta" primario />
            {hayCursoReal && (
              <Link href={`/cursos/${cursoId}`} className="btn btn-ghost">
                Duplicar un examen anterior
              </Link>
            )}
          </div>
        </div>
      )}

      <PanelSugerirPreguntas
        cursoId={cursoId}
        preguntas={preguntas}
        niveles={niveles}
        onAgregar={agregarDeSugerencia}
        onEditar={editarDeSugerencia}
      />

      {preguntas.map((p, pi) => (
        <PreguntaCard
          key={pi}
          indice={pi}
          pregunta={p}
          onChange={(nueva) => onChange(preguntas.map((x, i) => (i === pi ? nueva : x)))}
          onQuitar={() => quitar(pi)}
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

      {preguntas.length > 0 && <MenuAgregarPregunta onElegir={agregar} />}
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
function MenuAgregarPregunta({ onElegir, etiqueta = '+ Agregar pregunta', primario = false }: { onElegir: (tipo: TipoPregunta) => void; etiqueta?: string; primario?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [lugar, setLugar] = useState<{ arriba: boolean; alto: number }>({ arriba: false, alto: 560 });
  const contenedor = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const idMenu = useId();

  function abrir() {
    // El botón está al final de la lista: el menú se abre del lado que tenga más lugar (sin quedar debajo de la barra de puntos pegada) y, si no entra entero, se queda con ese alto y se scrollea por dentro.
    const r = boton.current?.getBoundingClientRect();
    if (r) {
      const barra = 0; // sin barra superior (el menú es lateral)
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
        className={`btn ${primario ? 'btn-primary' : 'btn-secondary'}`}
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
        {etiqueta}
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
