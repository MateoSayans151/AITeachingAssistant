'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Cargando } from '@/app/components/Cargando';

/** La lista de cursos es el inicio (`/`): esta dirección queda solo para no romper links y favoritos viejos. */
export default function CursosPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/');
  }, [router]);
  return (
    <div className="page">
      <Cargando variante="cuadricula" />
    </div>
  );
}
