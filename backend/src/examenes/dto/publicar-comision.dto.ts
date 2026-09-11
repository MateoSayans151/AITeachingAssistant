import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class PublicarComisionDto {
  @IsUUID()
  comisionId: string;

  @IsDateString()
  @IsOptional()
  fechaInicio?: string;

  @IsDateString()
  @IsOptional()
  fechaFin?: string;
}
