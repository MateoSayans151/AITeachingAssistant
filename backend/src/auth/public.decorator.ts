import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marca una ruta (o controller) como accesible sin login de docente. Todo lo demás exige token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
