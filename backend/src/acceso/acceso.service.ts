import { Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Chequeos de pertenencia: cada recurso cuelga de un docente (directo o a través del
 * curso / trabajo práctico). Si el recurso no existe o es de otro docente se responde
 * igual 404, para no revelar qué ids existen.
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

  async curso(docenteId: string, cursoId: string) {
    this.uuids([cursoId], 'curso');
    const ok = await this.prisma.curso.count({ where: { id: cursoId, docenteId } });
    if (!ok) this.noEncontrado('Curso');
  }

  async examen(docenteId: string, examenId: string) {
    this.uuids([examenId], 'examen');
    const ok = await this.prisma.examen.count({ where: { id: examenId, curso: { docenteId } } });
    if (!ok) this.noEncontrado('Examen');
  }

  async comision(docenteId: string, comisionId: string) {
    this.uuids([comisionId], 'comision');
    const ok = await this.prisma.comision.count({ where: { id: comisionId, curso: { docenteId } } });
    if (!ok) this.noEncontrado('Comisión');
  }

  async material(docenteId: string, materialId: string) {
    this.uuids([materialId], 'material');
    const ok = await this.prisma.materialCurso.count({ where: { id: materialId, curso: { docenteId } } });
    if (!ok) this.noEncontrado('Material');
  }

  async matriz(docenteId: string, matrizId: string) {
    this.uuids([matrizId], 'matriz');
    const ok = await this.prisma.matrizRubrica.count({ where: { id: matrizId, docenteId } });
    if (!ok) this.noEncontrado('Matriz de rúbrica');
  }

  async trabajoPractico(docenteId: string, trabajoPracticoId: string) {
    this.uuids([trabajoPracticoId], 'trabajoPractico');
    const ok = await this.prisma.trabajoPractico.count({ where: { id: trabajoPracticoId, docenteId } });
    if (!ok) this.noEncontrado('Trabajo práctico');
  }

  async entrega(docenteId: string, entregaId: string) {
    this.uuids([entregaId], 'entrega');
    const ok = await this.prisma.entrega.count({ where: { id: entregaId, trabajoPractico: { docenteId } } });
    if (!ok) this.noEncontrado('Entrega');
  }

  async respuestaExamen(docenteId: string, examenId: string, respuestaId: string) {
    this.uuids([examenId, respuestaId], 'respuestaExamen');
    const ok = await this.prisma.respuestaExamen.count({
      where: { id: respuestaId, examenId, examen: { curso: { docenteId } } },
    });
    if (!ok) this.noEncontrado('Respuesta');
  }
}
