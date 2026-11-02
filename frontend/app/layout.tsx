import type { Metadata } from 'next';
import './globals.css';
import { SideNav } from './components/SideNav';
import { ConfirmarProvider } from './components/Confirmar';
import { RecorridoProvider } from './components/Recorrido';

export const metadata: Metadata = {
  title: 'AI Teaching Assistant',
  description: 'Asistente de corrección con IA para docentes — UADE, Tecnología e Innovación',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <ConfirmarProvider>
          <RecorridoProvider>
            <div className="app-shell">
              <SideNav />
              <main className="app-main">{children}</main>
            </div>
          </RecorridoProvider>
        </ConfirmarProvider>
      </body>
    </html>
  );
}
