'use client';

// Subir material de cátedra sin salir del asistente: se eligen o se arrastran VARIOS archivos de una vez, se ve cada uno con su estado
// y se suben de a uno (el servidor recibe un archivo por pedido). Un archivo que falla no frena a los demás: queda marcado con el motivo y
// se puede reintentar.
//
// Contrato:
//   SubirMaterial({ cursoId, onOcupado, onTerminado, intro })
//     cursoId        el curso donde se guarda el material.
//     onOcupado(b)   true mientras se está subiendo (el padre no tiene que desmontar este componente en ese momento).
//     onTerminado(n) terminó la tanda y `n` archivos quedaron guardados: el padre recarga los temas del material.
//     intro          texto de arriba (por qué conviene subir material).

import { useEffect, useId, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { ApiError, subirArchivoMaterialCurso } from '@/lib/api';
import { EXTENSIONES_MATERIAL, MAX_ARCHIVOS_POR_TANDA, cantidadDeArchivos, clasificarArchivos, tamanoLegible } from '@/lib/material';
import type { ArchivoRechazado } from '@/lib/material';
import s from './SubirMaterial.module.css';

export interface SubirMaterialProps {
  cursoId: string;
  onOcupado?: (ocupado: boolean) => void;
  onTerminado: (guardados: number) => void;
  intro?: ReactNode;
}

type EstadoArchivo = 'pendiente' | 'subiendo' | 'listo' | 'error';
interface Fila {
  id: number;
  archivo: File;
  estado: EstadoArchivo;
  error?: string;
}

/** Por qué falló un archivo, en lenguaje del docente (el servidor responde 400 con el motivo: «PDF escaneado, sin texto», etc.). */
function motivoDelFallo(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 413) return 'Es demasiado grande: el máximo es 4 MB.';
    if (err.status === 400) {
      try {
        const m = JSON.parse(err.body).message;
        const texto = Array.isArray(m) ? m.join(' ') : typeof m === 'string' ? m : null;
        if (texto) return texto;
      } catch {
        /* cuerpo que no es JSON */
      }
    }
  }
  return 'No se pudo subir. Probá de nuevo.';
}

export function SubirMaterial({ cursoId, onOcupado, onTerminado, intro }: SubirMaterialProps) {
  const idCampo = useId();
  const montado = useRef(true);
  const siguienteId = useRef(1);
  const campo = useRef<HTMLInputElement>(null);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [rechazados, setRechazados] = useState<ArchivoRechazado[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumen, setResumen] = useState<string | null>(null);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const pendientes = filas.filter((f) => f.estado === 'pendiente' || f.estado === 'error');

  function agregarArchivos(lista: FileList | File[] | null) {
    if (!lista || subiendo) return;
    const { aceptados, rechazados: no } = clasificarArchivos(Array.from(lista), filas.map((f) => f.archivo));
    setRechazados(no);
    setResumen(null);
    setError(null);
    if (aceptados.length > 0) setFilas((prev) => [...prev, ...aceptados.map((archivo) => ({ id: siguienteId.current++, archivo, estado: 'pendiente' as const }))]);
    if (campo.current) campo.current.value = ''; // para poder volver a elegir el mismo archivo si falló
  }

  function cambiarFila(id: number, cambio: Partial<Fila>) {
    if (montado.current) setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, ...cambio } : f)));
  }

  function quitarFila(id: number) {
    setFilas((prev) => prev.filter((f) => f.id !== id));
  }

  async function subir() {
    if (subiendo || pendientes.length === 0) return;
    setSubiendo(true);
    onOcupado?.(true);
    setError(null);
    setResumen(null);
    setRechazados([]); // los avisos de lo que no se pudo elegir eran de antes de subir
    try {
      let guardados = 0;
      for (const fila of pendientes) {
        cambiarFila(fila.id, { estado: 'subiendo', error: undefined });
        try {
          await subirArchivoMaterialCurso(cursoId, fila.archivo, {});
          cambiarFila(fila.id, { estado: 'listo' });
          guardados++;
        } catch (err) {
          cambiarFila(fila.id, { estado: 'error', error: motivoDelFallo(err) });
        }
      }
      if (!montado.current) return;
      const fallaron = pendientes.length - guardados;
      setResumen(
        fallaron === 0
          ? `Listo: ${cantidadDeArchivos(guardados)} ${guardados === 1 ? 'guardado' : 'guardados'}. La IA ya los puede usar.`
          : guardados === 0
            ? 'No se pudo subir ningún archivo. Revisá los motivos de abajo.'
            : `${guardados} de ${pendientes.length} listos. Los que fallaron quedan marcados: podés reintentarlos.`,
      );
      if (guardados > 0) onTerminado(guardados);
    } finally {
      if (montado.current) setSubiendo(false);
      onOcupado?.(false);
    }
  }

  function alSoltar(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setArrastrando(false);
    agregarArchivos(e.dataTransfer.files);
  }

  const aceptadas = EXTENSIONES_MATERIAL.map((x) => `.${x}`).join(', ');
  const haySubiendo = filas.find((f) => f.estado === 'subiendo');
  const hechos = filas.filter((f) => f.estado === 'listo').length;

  return (
    <section className={s.raiz} aria-label="Subir material de cátedra">
      {intro && <p className={s.intro}>{intro}</p>}

      <div
        className={`${s.zona}${arrastrando ? ` ${s.arrastrando}` : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!subiendo) setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={alSoltar}
      >
        <span className={s.zonaTexto}>Arrastrá tus archivos hasta acá</span>
        <label htmlFor={idCampo} className={`btn btn-secondary ${s.elegir}${subiendo ? ` ${s.deshabilitado}` : ''}`}>
          Elegir archivos
        </label>
        <input
          ref={campo}
          id={idCampo}
          className="archivo-oculto"
          type="file"
          multiple
          accept={EXTENSIONES_MATERIAL.map((x) => `.${x}`).join(',')}
          disabled={subiendo}
          onChange={(e) => agregarArchivos(e.target.files)}
        />
        <span className={s.ayuda}>
          {aceptadas} · hasta 4 MB cada uno · hasta {MAX_ARCHIVOS_POR_TANDA} a la vez
        </span>
      </div>

      {rechazados.length > 0 && (
        <ul className={s.rechazados} role="alert">
          {rechazados.map((r, i) => (
            <li key={`${r.nombre}-${i}`}>{r.motivo}</li>
          ))}
        </ul>
      )}

      {filas.length > 0 && (
        <ul className={s.lista} aria-label="Archivos elegidos">
          {filas.map((f) => (
            <li key={f.id} className={s.fila} data-estado={f.estado}>
              <span className={s.nombre} title={f.archivo.name}>
                {f.archivo.name}
              </span>
              <span className={s.tamano}>{tamanoLegible(f.archivo.size)}</span>
              <span className={s.estado}>
                {f.estado === 'pendiente' && 'Listo para subir'}
                {f.estado === 'subiendo' && 'Subiendo…'}
                {f.estado === 'listo' && '✓ Guardado'}
                {f.estado === 'error' && (f.error ?? 'No se pudo subir')}
              </span>
              {(f.estado === 'pendiente' || f.estado === 'error') && !subiendo && (
                <button type="button" className={s.quitar} onClick={() => quitarFila(f.id)} aria-label={`Quitar ${f.archivo.name}`}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      <div className={s.acciones} role="status" aria-live="polite">
        {pendientes.length > 0 && (
          <button type="button" className="btn btn-secondary" onClick={subir} disabled={subiendo}>
            {subiendo
              ? `Subiendo ${Math.min(hechos + 1, filas.length)} de ${filas.length}…`
              : pendientes.some((f) => f.estado === 'error')
                ? `Reintentar ${cantidadDeArchivos(pendientes.length)}`
                : `Subir ${cantidadDeArchivos(pendientes.length)}`}
          </button>
        )}
        {resumen && !haySubiendo && <span className={s.resumen}>{resumen}</span>}
      </div>
    </section>
  );
}
