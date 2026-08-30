import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// @Global() para no tener que re-importar PrismaModule en cada feature module
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
