'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from './Modal';
import { ConfirmarBorrado } from './ConfirmarBorrado';
import { useConfirmar } from './Confirmar';
import { plural } from '@/lib/texto';
import { mensajeDeError } from '@/lib/errores';
import { useDocente } from '@/lib/auth';
import { actualizarCurso, eliminarCurso, getEquipoCurso, getQueSePierdeCurso, quitarDocenteCurso } from '@/lib/api';
import type { Curso } from '@/lib/api';

/**
 * Editar y eliminar un curso. Cualquiera del equipo puede editar el nombre y la materia. Eliminar solo lo puede quien es el último docente
 * del curso (escribiendo su nombre); si hay más docentes, lo que se ofrece es salir del curso y que lo sigan usando ellos.
 */
export function AjustesCurso({ curso, onCambio }: { curso: Curso; onCambio: () => void }) {
  const router = useRouter();
  const confirmar = useConfirmar();
  const docente = useDocente();
  const [dialogo, setDialogo] = useState<'editar' | 'eliminar' | 'salir' | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [perdida, setPerdida] = useState<string[]>([]);
  const [otrosDocentes, setOtrosDocentes] = useState(0);

  async function pedirEliminar() {
    setCargando(true);
    setError(null);
    try {
      const equipo = await getEquipoCurso(curso.id);
      if (equipo.docentes.length > 1) {
        setOtrosDocentes(equipo.docentes.length - 1);
        setDialogo('salir');
        return;
      }
      const q = await getQueSePierdeCurso(curso.id).catch(() => null);
      setPerdida([
        ...(q ? [plural(q.examenes, 'examen', 'exámenes'), plural(q.respuestas, 'respuesta de alumno', 'respuestas de alumnos'), plural(q.comisiones, 'comisión', 'comisiones'), plural(q.materiales, 'material de cátedra', 'materiales de cátedra')] : ['Sus exámenes, respuestas de alumnos, comisiones y material de cátedra']),
        'Las capturas de pantalla guardadas',
      ]);
      setDialogo('eliminar');
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo preparar el borrado. Probá de nuevo.'));
    } finally {
      setCargando(false);
    }
  }

  async function eliminar() {
    try {
      await eliminarCurso(curso.id, curso.nombre);
    } catch (err) {
      throw new Error(mensajeDeError(err, 'No se pudo eliminar el curso.'));
    }
    router.push('/cursos');
  }

  async function salir() {
    if (!docente) return;
    const ok = await confirmar({
      titulo: '¿Salir del curso?',
      mensaje: 'Vas a dejar de ver este curso y sus exámenes. Los docentes que quedan lo siguen usando y cualquiera de ellos puede volver a sumarte.',
      textoConfirmar: 'Salir del curso',
      peligrosa: true,
    });
    if (!ok) return;
    try {
      await quitarDocenteCurso(curso.id, docente.id);
      router.push('/cursos');
    } catch (err) {
      setDialogo(null);
      setError(mensajeDeError(err, 'No se pudo salir del curso.'));
    }
  }

  return (
    <>
      <div className="examen-barra-acciones" data-guia="curso-ajustes">
        <button type="button" className="btn btn-secondary" onClick={() => setDialogo('editar')}>
          Editar curso
        </button>
        <button type="button" className="btn btn-ghost btn-peligro" onClick={pedirEliminar} disabled={cargando}>
          {cargando ? 'Un momento…' : 'Eliminar curso'}
        </button>
      </div>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}

      {dialogo === 'editar' && (
        <EditarCurso
          curso={curso}
          onListo={() => {
            setDialogo(null);
            onCambio();
          }}
          onCancelar={() => setDialogo(null)}
        />
      )}

      {dialogo === 'eliminar' && (
        <ConfirmarBorrado
          titulo="¿Eliminar el curso?"
          nombre={curso.nombre}
          etiquetaNombre="curso"
          perdida={perdida}
          textoConfirmar="Eliminar curso"
          onConfirmar={eliminar}
          onCancelar={() => setDialogo(null)}
        />
      )}

      {dialogo === 'salir' && (
        <Modal titulo="Este curso no se puede eliminar" onCerrar={() => setDialogo(null)}>
          <p className="dialog-message">
            {otrosDocentes === 1 ? 'Hay otro docente' : `Hay otros ${otrosDocentes} docentes`} en este curso. Un curso solo se elimina cuando sos el último docente, para no sacárselo a quienes lo
            usan.
          </p>
          <p className="dialog-message">Lo que sí podés hacer es salir del curso: dejás de verlo y el resto lo sigue usando con todo lo que tiene.</p>
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setDialogo(null)}>
              Cancelar
            </button>
            <button type="button" className="btn btn-danger" onClick={salir}>
              Salir del curso
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function EditarCurso({ curso, onListo, onCancelar }: { curso: Curso; onListo: () => void; onCancelar: () => void }) {
  const [nombre, setNombre] = useState(curso.nombre);
  const [materia, setMateria] = useState(curso.materia ?? '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cambio = nombre.trim() !== curso.nombre || materia.trim() !== (curso.materia ?? '');

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim() || !cambio || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      await actualizarCurso(curso.id, { nombre: nombre.trim(), materia: materia.trim() });
      onListo();
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudieron guardar los cambios. Probá de nuevo.'));
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Editar curso" onCerrar={onCancelar} cerrable={!guardando}>
      <form onSubmit={guardar}>
        <div className="field">
          <label htmlFor="curso-nombre">Nombre</label>
          <input id="curso-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={200} disabled={guardando} />
        </div>
        <div className="field">
          <label htmlFor="curso-materia">Materia (opcional)</label>
          <input id="curso-materia" value={materia} onChange={(e) => setMateria(e.target.value)} maxLength={200} disabled={guardando} />
        </div>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancelar} disabled={guardando}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={!nombre.trim() || !cambio || guardando}>
            {guardando ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
