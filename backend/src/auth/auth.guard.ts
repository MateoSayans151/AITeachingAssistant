import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { VerificadorSesion } from './verificador-sesion';
import { SesionDocenteService } from './sesion-docente.service';

/**
 * Guard global: default-deny. Una ruta nueva queda protegida sin hacer nada; para
 * abrirla hay que marcarla con @Public() a propósito.
 *
 * La sesión de docente es el access token de Supabase Auth. El token que se le da al alumno para su intento
 * (firmado por nosotros) no pasa: no tiene el emisor ni la audiencia de Supabase.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly verificador: VerificadorSesion,
    private readonly sesiones: SesionDocenteService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const esPublica = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (esPublica) return true;

    const request = context.switchToHttp().getRequest();
    const [tipo, token] = (request.headers.authorization ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) throw new UnauthorizedException('Falta iniciar sesión');

    const claims = await this.verificador.verificar(token);
    request.docenteId = await this.sesiones.resolver(claims);
    return true;
  }
}
