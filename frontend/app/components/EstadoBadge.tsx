import { EstadoEntrega } from '@/lib/api';

const LABELS: Record<EstadoEntrega, string> = {
  pendiente_correccion: 'Pendiente',
  corregido: 'Corregido por IA',
  revisado: 'Revisado por docente',
};

const CLASSES: Record<EstadoEntrega, string> = {
  pendiente_correccion: 'badge badge-pendiente',
  corregido: 'badge badge-corregido',
  revisado: 'badge badge-revisado',
};

export function EstadoBadge({ estado }: { estado: EstadoEntrega }) {
  return <span className={CLASSES[estado]}>{LABELS[estado]}</span>;
}
