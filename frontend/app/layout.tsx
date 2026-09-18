import type { Metadata } from 'next';
import './globals.css';
import { TopNav } from './components/TopNav';

export const metadata: Metadata = {
  title: 'AI Teaching Assistant',
  description: 'Asistente de corrección con IA para docentes — UADE, Tecnología e Innovación',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <TopNav />
        {children}
      </body>
    </html>
  );
}
