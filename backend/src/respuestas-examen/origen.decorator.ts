import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Origen } from './intentos.service';

/** IP, navegador e id de pestaña del pedido (ver `IntentosService.seguirOrigen`). */
export const OrigenPedido = createParamDecorator((_data: unknown, ctx: ExecutionContext): Origen => {
  const req = ctx.switchToHttp().getRequest();
  const cabecera = (n: string) => {
    const v = req.headers?.[n];
    return typeof v === 'string' ? v : undefined;
  };
  return { ip: req.ip, userAgent: cabecera('user-agent'), clienteId: cabecera('x-cliente-id') };
});
