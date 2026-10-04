import { createClient } from '@supabase/supabase-js';

// El login, el registro y la recuperación de contraseña de los docentes los maneja Supabase Auth.
// Son valores públicos por diseño (la "anon"/"publishable" key va en el navegador); NUNCA poner acá la service_role.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigurado = Boolean(url && anonKey);

// Sin configuración el cliente se crea igual (con valores de relleno) para no romper la carga de la página;
// la pantalla de inicio avisa qué falta.
export const supabase = createClient(url || 'https://supabase-no-configurado.invalid', anonKey || 'sin-clave', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
