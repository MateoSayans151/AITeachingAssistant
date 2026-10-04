'use client';

// VistaPreviaAlumno: "Vista previa del alumno" del wizard de "Nuevo examen". Un botón que abre un diálogo modal con el examen
// tal como lo ve el alumno ANTES de publicarlo: título y consigna, el aviso de duración (si es de sesión con tiempo), el
// recuadro de qué se monitorea (si hay anti-cheat) y las preguntas. Las preguntas se dibujan con el MISMO componente que usa el
// alumno (`TarjetaPreguntaAlumno`, de app/components/PreguntaAlumno.tsx), alimentado con `preguntasParaAlumno`
// (lib/vista-previa.ts), que arma lo que entregaría el servidor SIN la clave de respuesta. Es interactiva (se puede escribir,
// elegir, marcar) pero no guarda nada, no llama a la red y se descarta al cerrar.
//
// Contrato:
//   VistaPreviaButton({ datos, preguntas })
//     datos      DatosForm (lib/examen-form.ts): se usan titulo, consigna, modalidad, duracionMinutos, antiCheatOn, acPantalla,
//                acPestana y acPegado.
//     preguntas  PreguntaForm[] en el orden del examen. Las que están a medio cargar se muestran como estén (enunciado vacío
//                -> "(Pregunta sin enunciado)", opciones sin texto se omiten).
//   Es autocontenido: maneja su propio estado de abierto/cerrado. No recibe callbacks ni escribe nada del formulario.
//
// Accesibilidad: el diálogo tiene role="dialog", aria-modal, título (aria-labelledby) y el aviso de vista previa como
// descripción. Al abrirse el foco pasa al diálogo y queda atrapado (Tab y Shift+Tab dan la vuelta); Esc, el botón "Cerrar vista
// previa" o un clic en el fondo lo cierran y el foco vuelve a lo que lo tenía antes (el botón). La página de atrás no scrollea:
// scrollea solo el cuerpo del diálogo, y el aviso con el título quedan fijos arriba.
//
// Diferencias a propósito con la pantalla real del alumno (app/rendir/[slug]/page.tsx): no hay campo de email ni "Comenzar", el
// consentimiento del recuadro de monitoreo es un checkbox inerte (deshabilitado) y el botón "Entregar examen" no entrega nada.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TarjetaPreguntaAlumno } from '@/app/components/PreguntaAlumno';
import type { DatosForm, PreguntaForm } from '@/lib/examen-form';
import { TEXTOS_INGRESO_ALUMNO, antiCheatParaAlumno, avisoDuracionTitulo, cantidadRespondidas, duracionParaAlumno, preguntasParaAlumno } from '@/lib/vista-previa';
import estilos from './VistaPreviaAlumno.module.css';

export interface VistaPreviaButtonProps {
  datos: DatosForm;
  preguntas: PreguntaForm[];
}

export function VistaPreviaButton({ datos, preguntas }: VistaPreviaButtonProps) {
  const [abierta, setAbierta] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-secondary" aria-haspopup="dialog" onClick={() => setAbierta(true)}>
        Vista previa del alumno
      </button>
      {abierta && <DialogoVistaPrevia datos={datos} preguntas={preguntas} onCerrar={() => setAbierta(false)} />}
    </>
  );
}

const ENFOCABLES = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function DialogoVistaPrevia({ datos, preguntas, onCerrar }: VistaPreviaButtonProps & { onCerrar: () => void }) {
  const idTitulo = useId();
  const idAviso = useId();
  const dialogoRef = useRef<HTMLDivElement>(null);
  const cerrarRef = useRef(onCerrar);
  cerrarRef.current = onCerrar;

  // Lo que se escribe acá vive solo en memoria mientras el diálogo está abierto.
  const [respuestas, setRespuestas] = useState<Record<string, unknown>>({});
  const preguntasAlumno = useMemo(() => preguntasParaAlumno(preguntas), [preguntas]);
  const minutos = duracionParaAlumno(datos);
  const cfg = antiCheatParaAlumno(datos);
  const respondidas = cantidadRespondidas(preguntasAlumno, respuestas);

  // Foco, Esc, trampa de foco y scroll de la página de atrás.
  useEffect(() => {
    const dialogo = dialogoRef.current;
    if (!dialogo) return;
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflowPrevio = document.body.style.overflow;
    const paddingPrevio = document.body.style.paddingRight;
    const anchoBarra = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (anchoBarra > 0) document.body.style.paddingRight = `${anchoBarra}px`; // para que la página no "salte" al perder la barra
    dialogo.focus();

    const enfocables = () => Array.from(dialogo.querySelectorAll<HTMLElement>(ENFOCABLES)).filter((el) => el.getClientRects().length > 0);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cerrarRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const lista = enfocables();
      if (lista.length === 0) {
        e.preventDefault();
        dialogo.focus();
        return;
      }
      const primero = lista[0];
      const ultimo = lista[lista.length - 1];
      const activo = document.activeElement;
      if (!dialogo.contains(activo) || activo === dialogo) {
        e.preventDefault();
        (e.shiftKey ? ultimo : primero).focus();
      } else if (e.shiftKey && activo === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && activo === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };
    // Si el foco se escapa del diálogo (clic afuera, foco programático), vuelve.
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof Node && !dialogo.contains(e.target)) dialogo.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      document.body.style.overflow = overflowPrevio;
      document.body.style.paddingRight = paddingPrevio;
      previo?.focus();
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className={estilos.fondo}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar(); // clic en el fondo, no en el diálogo
      }}
    >
      <div ref={dialogoRef} className={estilos.dialogo} role="dialog" aria-modal="true" aria-labelledby={idTitulo} aria-describedby={idAviso} tabIndex={-1}>
        <div className={estilos.cabecera}>
          <h2 id={idTitulo} className={estilos.titulo}>
            Vista previa del alumno
          </h2>
          <button type="button" className="btn btn-secondary" onClick={onCerrar}>
            Cerrar vista previa
          </button>
        </div>
        <div id={idAviso} className={estilos.aviso}>
          Vista previa: así lo ve el alumno. Nada de lo que escribas acá se guarda.
        </div>

        <div className={estilos.cuerpo}>
          <div className={estilos.contenido}>
            <header className="page-header">
              <h1>{datos.titulo.trim() || 'Sin título'}</h1>
              {datos.consigna.trim() && <p>{datos.consigna}</p>}
            </header>

            {minutos !== null && (
              <div className="card" style={{ marginBottom: 16 }}>
                <strong>{avisoDuracionTitulo(minutos)}</strong>
                <p className="muted" style={{ marginTop: 6 }}>
                  {TEXTOS_INGRESO_ALUMNO.duracionDetalle}
                </p>
              </div>
            )}

            {cfg && (
              <div className="card" style={{ marginBottom: 16 }} role="region" aria-label={TEXTOS_INGRESO_ALUMNO.monitoreoTitulo}>
                <div className="card-title" style={{ marginBottom: 8 }}>
                  {TEXTOS_INGRESO_ALUMNO.monitoreoTitulo}
                </div>
                <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
                  {cfg.pantallaCompleta && <li>{TEXTOS_INGRESO_ALUMNO.monitoreoPantalla}</li>}
                  {cfg.cambioPestana && <li>{TEXTOS_INGRESO_ALUMNO.monitoreoPestana}</li>}
                  {cfg.pegado && <li>{TEXTOS_INGRESO_ALUMNO.monitoreoPegado}</li>}
                </ul>
                <p className="muted" style={{ marginBottom: 12 }}>
                  {TEXTOS_INGRESO_ALUMNO.monitoreoNota}
                </p>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <input type="checkbox" disabled style={{ marginTop: 4 }} />
                  <span>{TEXTOS_INGRESO_ALUMNO.consentimiento}</span>
                </label>
              </div>
            )}

            {preguntasAlumno.length === 0 && <div className={`empty-state ${estilos.sinPreguntas}`}>Todavía no cargaste preguntas.</div>}
            {preguntasAlumno.map((p, i) => (
              <TarjetaPreguntaAlumno
                key={p.id}
                pregunta={p}
                numero={i + 1}
                valor={respuestas[p.id]}
                onChange={(v) => setRespuestas((prev) => ({ ...prev, [p.id]: v }))}
              />
            ))}

            <div className={estilos.pie}>
              <button className="btn btn-primary" type="button" disabled>
                Entregar examen
              </button>
              <span className="muted">
                {respondidas} de {preguntasAlumno.length} respondidas
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
