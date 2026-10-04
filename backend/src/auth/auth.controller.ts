import { Controller, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { DocenteId } from './docente-id.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Get('me')
  me(@DocenteId() docenteId: string) {
    return this.service.me(docenteId);
  }
}
