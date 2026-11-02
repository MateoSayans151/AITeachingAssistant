import type { Metadata } from 'next';
import Link from 'next/link';
import { CAMINO, GLOSARIO, PASOS_GUIA, PREGUNTAS_FRECUENTES } from '@/lib/guia';
import s from './ayuda.module.css';

export const metadata: Metadata = { title: 'Guía para docentes · AI Teaching Assistant' };

/** La guía completa. No pide sesión: tiene que poder leerse antes de crear la cuenta (la pantalla de entrada enlaza acá). */
export default function AyudaPage() {
  return (
    <div className={`page ${s.pagina}`}>
      <header className="page-header">
        <Link href="/" className="volver">
          ← Volver a la app
        </Link>
        <div className="eyebrow">Ayuda</div>
        <h1>Guía para docentes</h1>
        <p>Sin palabras raras: qué hace la app, cómo usarla paso a paso y qué hacer si algo no sale.</p>
      </header>

      <nav className={s.indice} aria-label="En esta guía">
        <a href="#como-funciona">Cómo funciona</a>
        <a href="#paso-a-paso">Paso a paso</a>
        <a href="#problemas">Si algo no sale</a>
        <a href="#palabras">Qué significa cada palabra</a>
      </nav>

      <section id="como-funciona" className={s.seccion}>
        <h2>Cómo funciona</h2>
        <ol className={s.camino}>
          {CAMINO.map((c, i) => (
            <li key={i} className={s.etapa} style={{ '--orden': i } as React.CSSProperties} data-final={i === CAMINO.length - 1}>
              <span className={s.etapaNumero} aria-hidden="true">
                {i + 1}
              </span>
              <strong>{c.quien}</strong>
              <span>{c.que}</span>
            </li>
          ))}
        </ol>
        <p className={s.promesa}>
          <strong>La nota siempre la decidís vos.</strong> La IA hace una propuesta, y nada le llega a un alumno hasta que vos lo confirmes.
        </p>
      </section>

      <section id="paso-a-paso" className={s.seccion}>
        <h2>Paso a paso</h2>
        <p className={s.intro}>
          Tocá cada título para abrirlo. Dentro de la app, el botón <strong>Mostrame esta pantalla</strong> del menú te señala cada parte de la
          pantalla en la que estés.
        </p>
        {PASOS_GUIA.map((p, i) => (
          <details key={p.id} id={p.id} className={s.plegable} open={i === 0}>
            <summary>
              <span className={s.plegableTitulo}>{p.titulo}</span>
              <span className={s.plegableResumen}>{p.resumen}</span>
            </summary>
            <ol className={s.instrucciones}>
              {p.pasos.map((texto) => (
                <li key={texto}>{texto}</li>
              ))}
            </ol>
            {p.nota && <p className={s.nota}>{p.nota}</p>}
          </details>
        ))}
      </section>

      <section id="problemas" className={s.seccion}>
        <h2>Si algo no sale</h2>
        {PREGUNTAS_FRECUENTES.map((p) => (
          <details key={p.pregunta} className={s.plegable}>
            <summary>
              <span className={s.plegableTitulo}>{p.pregunta}</span>
            </summary>
            <p className={s.respuesta}>{p.respuesta}</p>
          </details>
        ))}
      </section>

      <section id="palabras" className={s.seccion}>
        <h2>Qué significa cada palabra</h2>
        <dl className={s.glosario}>
          {GLOSARIO.map((g) => (
            <div key={g.termino}>
              <dt>{g.termino}</dt>
              <dd>{g.definicion}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
