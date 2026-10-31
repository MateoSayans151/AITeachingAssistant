import type { Metadata } from 'next';
import './globals.css';
import { SideNav } from './components/SideNav';
import { ConfirmarProvider } from './components/Confirmar';

export const metadata: Metadata = {
  title: 'AI Teaching Assistant',
  description: 'Asistente de corrección con IA para docentes — UADE, Tecnología e Innovación',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <ConfirmarProvider>
          <div className="app-shell">
            <SideNav />
            <main className="app-main">{children}</main>
          </div>
        </ConfirmarProvider>
      </body>
    </html>
  );
}
