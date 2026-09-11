import { Module } from '@nestjs/common';
import { MatricesRubricaController } from './matrices-rubrica.controller';
import { MatricesRubricaService } from './matrices-rubrica.service';

@Module({
  controllers: [MatricesRubricaController],
  providers: [MatricesRubricaService],
  exports: [MatricesRubricaService],
})
export class MatricesRubricaModule {}
