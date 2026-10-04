import { HttpException, HttpStatus } from '@nestjs/common';

/** Dónde se anotan los fallos. En producción es la base (compartida por todas las instancias). */
export interface AlmacenFallos {
  /** Cantidad de fallos de `clave` ocurridos desde `desdeMs` (epoch ms). */
  contar(clave: string, desdeMs: number): Promise<number>;
  registrar(clave: string, ahoraMs: number): Promise<void>;
  borrar(clave: string): Promise<void>;
}

/** Almacén en memoria: para tests. No sirve con más de una instancia del backend. */
export class AlmacenFallosMemoria implements AlmacenFallos {
  private readonly fallos = new Map<string, number[]>();
  async contar(clave: string, desdeMs: number) {
    return (this.fallos.get(clave) ?? []).filter((t) => t >= desdeMs).length;
  }
  async registrar(clave: string, ahoraMs: number) {
    this.fallos.set(clave, [...(this.fallos.get(clave) ?? []), ahoraMs]);
  }
  async borrar(clave: string) {
    this.fallos.delete(clave);
  }
}

/**
 * Freno a quien prueba emails al azar para entrar a un examen. Cuenta solo los intentos FALLIDOS de la
 * última ventana, por clave (slug+email y, aparte, IP). No usamos el rate limit por IP del
 * ThrottlerGuard porque un aula entera comparte IP (NAT): 30 alumnos empezando a la vez no
 * pueden bloquearse entre sí, pero alguien probando muchos emails desde un mismo lugar sí.
 */
export class LimitadorFallos {
  constructor(
    private readonly almacen: AlmacenFallos,
    private readonly maxFallos: number,
    private readonly ventanaMs: number,
  ) {}

  async verificar(clave: string, ahora = Date.now()) {
    if ((await this.almacen.contar(clave, ahora - this.ventanaMs)) >= this.maxFallos) {
      throw new HttpException('Demasiados intentos fallidos. Esperá unos minutos y probá de nuevo.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async fallo(clave: string, ahora = Date.now()) {
    await this.almacen.registrar(clave, ahora);
  }

  async exito(clave: string) {
    await this.almacen.borrar(clave);
  }
}
