// Función de Supabase "sim": puerta de entrada del servidor del simulador.
// Debe desplegarse con la verificación de JWT de Supabase APAGADA ("Verify JWT" desactivado),
// porque Moodle llama a esta función sin las llaves de Supabase. La función hace su propia
// comprobación de identidad (firma de Moodle y pase de sesión).
import { crearNucleo } from './nucleo.js';
import { crearDb } from './db.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
// Llave de servicio: Supabase la entrega sola a la función. Si algún día retira el nombre
// antiguo, se usa la llave secreta nueva (viene como JSON: {"default":"sb_secret_..."}).
function llaveServicio(): string {
  const vieja = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (vieja) return vieja;
  try { return String(Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'))[0] || ''); } catch (_) { return ''; }
}
// Asistente del editor de lecciones. Se activa solo si existe el secreto ANTHROPIC_API_KEY
// en la configuración de las funciones de Supabase. El modelo y el esfuerzo se eligen en la
// tabla "ajustes" (ia_modelo, ia_esfuerzo).
let ia = null;
if (Deno.env.get('ANTHROPIC_API_KEY')) {
  const { default: Anthropic } = await import('npm:@anthropic-ai/sdk');
  const cliente = new Anthropic();
  ia = async ({ sistema, texto, modelo, esfuerzo }: { sistema: string; texto: string; modelo: string; esfuerzo: string }) => {
    const flujo = cliente.beta.messages.stream({
      model: modelo,
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // si el modelo declina el pedido, el servidor de Anthropic prueba con otro
      output_config: { effort: esfuerzo },
      system: sistema,
      messages: [{ role: 'user', content: texto }]
    } as any);
    const m: any = await flujo.finalMessage();
    const t = (m.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    return { texto: t, motivo: m.stop_reason, modelo: m.model };
  };
}

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
