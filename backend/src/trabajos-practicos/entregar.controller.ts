import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { IntentosTpService } from './intentos-tp.service';
import { EnviarEntregaDto, GuardarBorradorEntregaDto, IniciarEntregaDto } from './dto/entregar.dto';
import { EventoIntegridadDto } from '../respuestas-examen/dto/intento.dto';
import { Public } from '../auth/public.decorator';

// El otro controller público (junto con RendirController): para el alumno que entra desde el link de
// un trabajo práctico. El link solo muestra datos generales; la consigna se entrega al iniciar (y, con
// modo seguro, aceptando el aviso). Nunca devuelve correcciones ni notas.
//
// @SkipThrottle: un aula entera comparte IP, así que el límite por IP del ThrottlerGuard bloquearía a
// los alumnos entre sí (autoguardado cada pocos segundos). El link es un secreto de 96 bits.
@Public()
@SkipThrottle()
@Controller('entregar/:slug')
export class EntregarController {
  constructor(private readonly service: IntentosTpService) {}

  @Get()
  info(@Param('slug') slug: string) {
    return this.service.info(slug);
  }

  @Post('iniciar')
  iniciar(@Param('slug') slug: string, @Body() dto: IniciarEntregaDto) {
    return this.service.iniciar(slug, dto);
  }

  // Retomar tras un refresh: devuelve consigna + borrador + vencimiento del intento.
  @Get('intento')
  async intento(@Param('slug') slug: string, @Headers('authorization') auth?: string) {
    const intentoId = await this.service.intentoDeToken(auth, slug);
    return this.service.estadoIntento(intentoId, slug);
  }

  @Put('borrador')
  async borrador(@Param('slug') slug: string, @Body() dto: GuardarBorradorEntregaDto, @Headers('authorization') auth?: string) {
    const intentoId = await this.service.intentoDeToken(auth, slug);
    return this.service.guardarBorrador(intentoId, dto.texto);
  }

  @Post('eventos')
  @HttpCode(200)
  async evento(@Param('slug') slug: string, @Body() dto: EventoIntegridadDto, @Headers('authorization') auth?: string) {
    const intentoId = await this.service.intentoDeToken(auth, slug);
    return this.service.registrarEvento(intentoId, dto);
  }

  @Post('enviar')
  async enviar(@Param('slug') slug: string, @Body() dto: EnviarEntregaDto, @Headers('authorization') auth?: string) {
    const intentoId = await this.service.intentoDeToken(auth, slug);
    return this.service.entregar(intentoId, dto.texto);
  }
}
