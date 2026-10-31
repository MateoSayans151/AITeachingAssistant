import { Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Chequeos de pertenencia: cada recurso cuelga de un curso (examen, comisión, material, respuesta) o de un docente (matriz de
 * rúbrica). Un curso lo comparten los docentes de su equipo, todos con los mismos permisos: el acceso se decide por pertenencia
 * al equipo (`curso_docentes`), no por quién lo creó. Si el recurso no existe o no es del docente se responde igual 404, para no
 * revelar qué ids existen.
 */
@Injectable()
export class AccesoService {
  constructor(private readonly prisma: PrismaService) {}

  private noEncontrado(recurso: string): never {
    throw new NotFoundException(`${recurso} no encontrado`);
  }

  /** Un id que no es UUID no puede existir: 404 directo (sin esto Prisma responde 500). */
  private uuids(ids: string[], recurso: string) {
    if (!ids.every((id) => isUUID(id))) this.noEncontrado(recurso);
  }

  /** Filtro de Prisma para "cursos de los que forma parte este docente". Lo usan también los listados (cursos, pendientes). */
  static delEquipo(docenteId: string) {
    return { equipo: { some: { docenteId } } };
  }

  async curso(docenteId: string, cursoId: string) {
    this.uuids([cursoId], 'curso');
    const ok = await this.prisma.curso.count({ where: { id: cursoId, ...AccesoService.delEquipo(docenteId) } });
    if (!ok) this.noEncontrado('Curso');
  }

  async examen(docenteId: string, examenId: string) {
    this.uuids([examenId], 'examen');
    const ok = await this.prisma.examen.count({ where: { id: examenId, curso: AccesoService.delEquipo(docenteId) } });
    if (!ok) this.noEncontrado('Examen');
  }

  async comision(docenteId: string, comisionId: string) {
    this.uuids([comisionId], 'comision');
    const ok = await this.prisma.comision.count({ where: { id: comisionId, curso: AccesoService.delEquipo(docenteId) } });
    if (!ok) this.noEncontrado('Comisión');
  }

  async material(docenteId: string, materialId: string) {
    this.uuids([materialId], 'material');
    const ok = await this.prisma.materialCurso.count({ where: { id: materialId, curso: AccesoService.delEquipo(docenteId) } });
    if (!ok) this.noEncontrado('Material');
  }

  async matriz(docenteId: string, matrizId: string) {
    this.uuids([matrizId], 'matriz');
    const ok = await this.prisma.matrizRubrica.count({ where: { id: matrizId, docenteId } });
    if (!ok) this.noEncontrado('Matriz de rúbrica');
  }

  async respuestaExamen(docenteId: string, examenId: string, respuestaId: string) {
    this.uuids([examenId, respuestaId], 'respuestaExamen');
    const ok = await this.prisma.respuestaExamen.count({
      where: { id: respuestaId, examenId, examen: { curso: AccesoService.delEquipo(docenteId) } },
    });
    if (!ok) this.noEncontrado('Respuesta');
  }
}
