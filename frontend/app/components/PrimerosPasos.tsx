'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CursoParaPasos, claveOcultarPrimerosPasos, pasoActual, pasosDeInicio } from '@/lib/guia';
import { useRecorrido } from './Recorrido';
import s from './PrimerosPasos.module.css';

/**
 * El camino del docente nuevo, en el inicio: cuatro pasos que se tildan solos con lo que hizo de verdad, y un solo botón, el del paso que
 * sigue. Desaparece cuando completó todo o cuando la oculta (se recuerda en este navegador, por docente).
 */
export function PrimerosPasos({ docenteId, cursos, examenPorRevisarId }: { docenteId: string; cursos: CursoParaPasos[]; examenPorRevisarId?: string }) {
  const { iniciar } = useRecorrido();
  const [oculta, setOculta] = useState(true);

  useEffect(() => {
    try {
      setOculta(window.localStorage.getItem(claveOcultarPrimerosPasos(docenteId)) === '1');
    } catch {
      setOculta(false); // sin acceso al almacenamiento se muestra: es solo una ayuda
    }
  }, [docenteId]);

  const pasos = pasosDeInicio(cursos, examenPorRevisarId);
  const actual = pasoActual(pasos);
  if (oculta || !actual) return null;

  const hechos = pasos.filter((p) => p.hecho).length;

  function ocultar() {
    setOculta(true);
    try {
      window.localStorage.setItem(claveOcultarPrimerosPasos(docenteId), '1');
    } catch {
      /* no se recuerda para la próxima, nada más */
    }
  }

  return (
    <section className={s.tarjeta} aria-labelledby="primeros-pasos-titulo">
      <header className={s.cabecera}>
        <div>
          <h2 id="primeros-pasos-titulo" className={s.titulo}>
            Primeros pasos
          </h2>
          <p className={s.avance}>
            {hechos} de {pasos.length} hechos
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={iniciar}>
          Mostrame esta pantalla
        </button>
      </header>
      <div className={s.barra} aria-hidden="true">
        <span className={s.barraRelleno} style={{ transform: `scaleX(${hechos / pasos.length})` }} />
      </div>
      <ol className={s.lista}>
        {pasos.map((p, i) => {
          const esActual = p.clave === actual.clave;
          return (
            <li key={p.clave} className={s.paso} data-estado={p.hecho ? 'hecho' : esActual ? 'actual' : 'pendiente'}>
              <span className={s.marca} aria-hidden="true">
                {p.hecho ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path className={s.tilde} d="M2.5 7.5l3 3 6-7" pathLength={1} />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <div className={s.pasoCuerpo}>
                <strong>
                  {p.titulo}
                  {p.hecho && <span className={s.soloLectores}> (hecho)</span>}
                </strong>
                {esActual && (
                  <>
                    <p className={s.detalle}>{p.detalle}</p>
                    <Link href={p.accion.href} className="btn btn-primary">
                      {p.accion.etiqueta}
                    </Link>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <footer className={s.pie}>
        <Link href="/ayuda" className={s.enlace}>
          Ver la guía completa
        </Link>
        <button type="button" className={s.enlace} onClick={ocultar}>
          Ocultar esta tarjeta
        </button>
      </footer>
    </section>
  );
}
