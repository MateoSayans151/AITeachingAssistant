import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Id del docente autenticado (lo pone AuthGuard a partir del token; nunca viene del body). */
export const DocenteId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  return ctx.switchToHttp().getRequest().docenteId;
});
