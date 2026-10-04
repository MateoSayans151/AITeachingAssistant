import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReglaVaraDto } from './dto/vara.dto';
import { EntradaVara, ReglaVara, calcularVara, describirRegla, validarRegla } from './vara.util';

const num = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : Number(d));

/**
 * La vara es una capa sobre la nota sugerida, no un reemplazo: notaTotalSugerida no se toca,
 * la nota con vara vive en notaConVara y notaTotalFinal solo la escribe el docente al revisar.
 * Cada aplicación queda registrada (regla, autor, snapshot por respuesta) y se puede revertir.
 */
@Injectable()
export class VaraService {
  constructor(private readonly prisma: PrismaService) {}

  private async examen(examenId: string) {
    const examen = await this.prisma.examen.findUnique({ where: { id: examenId } });
    if (!examen) throw new NotFoundException(`Examen ${examenId} no encontrado`);
    return examen;
  }

  private normalizar(dto: ReglaVaraDto, escalaMin: number, escalaMax: number): ReglaVara {
    // Se valida lo que llegó tal cual (un umbral o un permitirBajar en un modo que no los usa es un error).
    const recibida: ReglaVara = {
      modo: dto.modo,
      valor: dto.valor,
      ...(dto.umbral !== undefined ? { umbral: dto.umbral } : {}),
      ...(dto.tope !== undefined ? { tope: dto.tope } : {}),
      ...(dto.permitirBajar !== undefined ? { permitirBajar: dto.permitirBajar } : {}),
    };
    const error = validarRegla(recibida, escalaMin, escalaMax);
    if (error) throw new BadRequestException(error);
    // Lo que se guarda: solo lo que tiene efecto (permitirBajar en false es lo mismo que no decirlo).
    const { permitirBajar, ...resto } = recibida;
    return permitirBajar ? { ...resto, permitirBajar: true } : resto;
  }

  /** Respuestas ya corregidas por la IA con su base para calcular: la sugerida (pendientes) o la final (revisadas). */
  private async entradas(examenId: string, db: PrismaClient | Prisma.TransactionClient = this.prisma): Promise<EntradaVara[]> {
    const respuestas = await db.respuestaExamen.findMany({
      where: { examenId, notaTotalSugerida: { not: null } },
      select: { id: true, estadoRevision: true, notaTotalSugerida: true, notaTotalFinal: true },
      orderBy: { createdAt: 'asc' },
    });
    return respuestas.map((r) =>
      r.estadoRevision === 'pendiente'
        ? { id: r.id, base: Number(r.notaTotalSugerida), ajustable: true }
        : { id: r.id, base: Number(r.notaTotalFinal ?? r.notaTotalSugerida), ajustable: false },
    );
  }

  /** Simula la regla sin guardar nada. */
  async preview(examenId: string, dto: ReglaVaraDto) {
    const examen = await this.examen(examenId);
    const regla = this.normalizar(dto, Number(examen.escalaMin), Number(examen.escalaMax));
    const resultado = calcularVara(await this.entradas(examenId), regla, Number(examen.escalaMin), Number(examen.escalaMax));

    const alumnos = await this.prisma.respuestaExamen.findMany({
      where: { id: { in: resultado.items.map((i) => i.id) } },
      select: { id: true, alumno: { select: { nombre: true } }, notaConVara: true },
    });
    const porId = new Map(alumnos.map((a) => [a.id, a]));
    return {
      regla,
      desplazamiento: resultado.desplazamiento,
      resumen: resultado.resumen,
      filas: resultado.items.map((i) => ({
        respuestaId: i.id,
        alumno: porId.get(i.id)?.alumno.nombre ?? null,
        notaSugerida: i.base,
        notaConVaraActual: num(porId.get(i.id)?.notaConVara),
        notaConVara: i.despues,
      })),
    };
  }

  /** Aplica la regla: queda un ajuste activo y el anterior, si había, pasa a "reemplazado". */
  async aplicar(examenId: string, docenteId: string, dto: ReglaVaraDto) {
    const examen = await this.examen(examenId);
    const escalaMin = Number(examen.escalaMin);
    const escalaMax = Number(examen.escalaMax);
    const regla = this.normalizar(dto, escalaMin, escalaMax);

    return this.prisma.$transaction(async (tx) => {
      const entradas = await this.entradas(examenId, tx);
      const resultado = calcularVara(entradas, regla, escalaMin, escalaMax);
      if (resultado.items.length === 0) throw new BadRequestException('No hay respuestas corregidas sin revisar para ajustar');

      const actuales = await tx.respuestaExamen.findMany({
        where: { id: { in: resultado.items.map((i) => i.id) } },
        select: { id: true, notaConVara: true, ajusteVaraId: true },
      });
      const actualPorId = new Map(actuales.map((a) => [a.id, a]));

      await tx.ajusteVara.updateMany({ where: { examenId, estado: 'activo' }, data: { estado: 'reemplazado' } });
      const ajuste = await tx.ajusteVara.create({
        data: {
          examenId,
          autorId: docenteId,
          regla: regla as unknown as Prisma.InputJsonValue,
          desplazamiento: resultado.desplazamiento,
          resumen: resultado.resumen as unknown as Prisma.InputJsonValue,
          detalles: {
            create: resultado.items.map((i) => ({
              respuestaId: i.id,
              notaBase: i.base,
              notaConVaraAntes: actualPorId.get(i.id)?.notaConVara ?? null,
              ajusteAnteriorId: actualPorId.get(i.id)?.ajusteVaraId ?? null,
              notaDespues: i.despues,
            })),
          },
        },
      });
      for (const i of resultado.items) {
        // Si entre el cálculo y la escritura el docente revisó esta respuesta, no se toca.
        await tx.respuestaExamen.updateMany({
          where: { id: i.id, estadoRevision: 'pendiente' },
          data: { notaConVara: i.despues, ajusteVaraId: ajuste.id },
        });
      }
      return { ...ajuste, descripcion: describirRegla(regla, resultado.desplazamiento) };
    });
  }

  async historial(examenId: string) {
    const ajustes = await this.prisma.ajusteVara.findMany({
      where: { examenId },
      orderBy: { createdAt: 'desc' },
      include: { autor: { select: { nombre: true } } },
    });
    return ajustes.map((a) => ({
      id: a.id,
      estado: a.estado,
      creadoEn: a.createdAt,
      revertidoEn: a.revertidoEn,
      autor: a.autor?.nombre ?? null,
      regla: a.regla,
      desplazamiento: num(a.desplazamiento),
      resumen: a.resumen,
      descripcion: describirRegla(a.regla as unknown as ReglaVara, num(a.desplazamiento)),
    }));
  }

  /**
   * Deshace un ajuste activo: las respuestas que todavía apuntan a él vuelven a la nota con vara
   * que tenían antes. Las que el docente ya revisó (o que otro ajuste movió) no se tocan.
   */
  async revertir(examenId: string, ajusteId: string) {
    const ajuste = await this.prisma.ajusteVara.findFirst({ where: { id: ajusteId, examenId }, include: { detalles: true } });
    if (!ajuste) throw new NotFoundException('Ajuste de vara no encontrado');
    if (ajuste.estado !== 'activo') throw new BadRequestException('Solo se puede revertir el ajuste vigente');

    return this.prisma.$transaction(async (tx) => {
      let restauradas = 0;
      for (const d of ajuste.detalles) {
        const r = await tx.respuestaExamen.updateMany({
          where: { id: d.respuestaId, ajusteVaraId: ajuste.id, estadoRevision: 'pendiente' },
          data: { notaConVara: d.notaConVaraAntes, ajusteVaraId: d.ajusteAnteriorId },
        });
        restauradas += r.count;
      }
      await tx.ajusteVara.update({ where: { id: ajuste.id }, data: { estado: 'revertido', revertidoEn: new Date() } });
      // Si se volvió a un ajuste anterior, ese vuelve a ser el vigente.
      const anteriores = [...new Set(ajuste.detalles.map((d) => d.ajusteAnteriorId).filter((x): x is string => !!x))];
      if (anteriores.length > 0) {
        await tx.ajusteVara.updateMany({ where: { id: { in: anteriores }, estado: 'reemplazado' }, data: { estado: 'activo' } });
      }
      return { restauradas, omitidas: ajuste.detalles.length - restauradas };
    });
  }

  /** "¿Por qué cambió esta nota?": de la sugerida de la IA a la final, paso por paso. */
  async explicar(examenId: string, respuestaId: string) {
    const r = await this.prisma.respuestaExamen.findFirst({
      where: { id: respuestaId, examenId },
      include: {
        ajustesVaraDetalle: { orderBy: { ajuste: { createdAt: 'asc' } }, include: { ajuste: { include: { autor: { select: { nombre: true } } } } } },
      },
    });
    if (!r) throw new NotFoundException(`Respuesta ${respuestaId} no encontrada`);

    const historial = r.ajustesVaraDetalle.map((d) => {
      const regla = d.ajuste.regla as unknown as ReglaVara;
      return {
        ajusteId: d.ajusteId,
        creadoEn: d.ajuste.createdAt,
        autor: d.ajuste.autor?.nombre ?? null,
        estado: d.ajuste.estado,
        regla,
        descripcion: describirRegla(regla, num(d.ajuste.desplazamiento)),
        notaBase: Number(d.notaBase),
        notaConVaraAntes: num(d.notaConVaraAntes),
        notaDespues: Number(d.notaDespues),
      };
    });
    const vigente = historial.find((h) => h.ajusteId === r.ajusteVaraId) ?? null;

    const pasos: string[] = [];
    pasos.push(r.notaTotalSugerida === null ? 'Todavía no fue corregida.' : `La corrección automática sugirió ${Number(r.notaTotalSugerida)}.`);
    if (vigente) {
      pasos.push(`Vara — ${vigente.descripcion}: ${vigente.notaBase} → ${vigente.notaDespues}.`);
    } else if (historial.length > 0) {
      pasos.push('Hubo ajustes de vara, pero ninguno sigue vigente sobre esta respuesta.');
    }
    if (r.estadoRevision === 'pendiente') {
      pasos.push('Pendiente de revisión: la nota final todavía no está definida.');
    } else if (r.estadoRevision === 'aceptada') {
      pasos.push(`El docente aceptó la sugerencia: nota final ${num(r.notaTotalFinal)}.`);
    } else {
      pasos.push(`El docente la editó a mano: nota final ${num(r.notaTotalFinal)}.`);
    }

    return {
      respuestaId: r.id,
      notaSugerida: num(r.notaTotalSugerida),
      notaConVara: num(r.notaConVara),
      notaFinal: num(r.notaTotalFinal),
      estadoRevision: r.estadoRevision,
      ajusteVigente: vigente,
      historial,
      explicacion: pasos.join(' '),
    };
  }
}
