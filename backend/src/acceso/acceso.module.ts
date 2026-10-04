import { Global, Module } from '@nestjs/common';
import { AccesoService } from './acceso.service';

@Global()
@Module({ providers: [AccesoService], exports: [AccesoService] })
export class AccesoModule {}
