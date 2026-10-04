import { Module } from '@nestjs/common';
import { InvitacionesController } from './invitaciones.controller';
import { InvitacionesService } from './invitaciones.service';
import { MailModule } from './mail.module';

// Prisma, ConfigService y AccesoService son globales (app.module.ts). Va en un módulo propio, registrado en AppModule, para no
// tocar el controller de exámenes: las rutas `examenes/:id/invitaciones` no chocan con las de ExamenesController.
@Module({
  imports: [MailModule],
  controllers: [InvitacionesController],
  providers: [InvitacionesService],
})
export class InvitacionesModule {}
