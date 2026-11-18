// Función de Supabase "sim": puerta de entrada del servidor del simulador.
// Debe desplegarse con la verificación de JWT de Supabase APAGADA ("Verify JWT" desactivado),
// porque Moodle llama a esta función sin las llaves de Supabase. La función hace su propia
// comprobación de identidad (firma de Moodle y pase de sesión).
import { crearNucleo, crearIA } from './nucleo.js';
import { crearDb } from './db.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
// Llave de servicio: Supabase la entrega sola a la función. Si algún día retira el nombre
// antiguo, se usa la llave secreta nueva (viene como JSON: {"default":"sb_secret_..."}).
function llaveServicio(): string {
  const vieja = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (vieja) return vieja;
  try { return String(Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'))[0] || ''); } catch (_) { return ''; }
}
// Asistente del editor de lecciones. Se activa solo si existe el secreto IA_API_KEY en la
// configuración de las funciones de Supabase (por defecto, una clave gratuita de Google Gemini).
// El servicio y los modelos se eligen en la tabla "ajustes" (ia_url, ia_modelo, ia_modelo_respaldo).
const claveIA = Deno.env.get('IA_API_KEY');
const ia = claveIA ? crearIA({ clave: claveIA }) : null;

const nucleo = crearNucleo({
  db: crearDb(SUPABASE_URL, llaveServicio()),
  urlBase: SUPABASE_URL + '/functions/v1/sim',
  ia
});

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const ruta = url.pathname.replace(/^.*?\/sim(?=\/|$)/, '') || '/';
  let cuerpo: Record<string, unknown> | null = null;
  if (req.method === 'POST') {
    const texto = await req.text();
    const tipo = req.headers.get('content-type') || '';
    try {
      cuerpo = tipo.includes('application/x-www-form-urlencoded')
        ? Object.fromEntries(new URLSearchParams(texto))
        : (texto ? JSON.parse(texto) : {});
    } catch (_) { cuerpo = {}; }
  }
  const r = await nucleo.atender({
    metodo: req.method, ruta, cuerpo,
    consulta: Object.fromEntries(url.searchParams),
    auth: req.headers.get('authorization'),
    origen: req.headers.get('origin')
  });
  const cabeceras = new Headers(r.cabeceras || {});
  if (r.redirigir) { cabeceras.set('Location', r.redirigir); return new Response(null, { status: r.estado, headers: cabeceras }); }
  if (r.cuerpo === undefined) return new Response(null, { status: r.estado, headers: cabeceras });
  cabeceras.set('Content-Type', 'application/json; charset=utf-8');
  cabeceras.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(r.cuerpo), { status: r.estado, headers: cabeceras });
});
