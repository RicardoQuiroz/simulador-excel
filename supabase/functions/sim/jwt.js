// Firmas y verificación de mensajes LTI (JWT con RS256) usando la criptografía estándar
// del entorno (Web Crypto). Sin dependencias externas.

const ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const cod = new TextEncoder();

export function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function deB64url(t) {
  const s = atob(t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const aTexto = bytes => new TextDecoder().decode(bytes);

export function aleatorio(n = 24) { return b64url(crypto.getRandomValues(new Uint8Array(n))); }

export async function sha256(texto) {
  const h = await crypto.subtle.digest('SHA-256', cod.encode(texto));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function generarClave() {
  const par = await crypto.subtle.generateKey({ ...ALG, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify']);
  return {
    kid: aleatorio(9),
    privada: await crypto.subtle.exportKey('jwk', par.privateKey),
    publica: await crypto.subtle.exportKey('jwk', par.publicKey)
  };
}

export async function firmar(carga, privadaJwk, kid) {
  const llave = await crypto.subtle.importKey('jwk', privadaJwk, ALG, false, ['sign']);
  const base = b64url(cod.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }))) + '.' + b64url(cod.encode(JSON.stringify(carga)));
  return base + '.' + b64url(await crypto.subtle.sign(ALG, llave, cod.encode(base)));
}

// Comprueba la firma con el conjunto de llaves públicas del emisor y devuelve el contenido.
// obtenerJwks: función que devuelve { keys: [...] }.
export async function verificar(token, obtenerJwks) {
  const p = String(token || '').split('.');
  if (p.length !== 3) throw new Error('El mensaje no tiene el formato esperado');
  let cab, carga;
  try { cab = JSON.parse(aTexto(deB64url(p[0]))); carga = JSON.parse(aTexto(deB64url(p[1]))); }
  catch (_) { throw new Error('El mensaje no se pudo leer'); }
  if (cab.alg !== 'RS256') throw new Error('Tipo de firma no admitido');
  const jwks = await obtenerJwks();
  const candidatas = (jwks.keys || []).filter(k => k.kty === 'RSA' && (!cab.kid || k.kid === cab.kid));
  for (const k of candidatas) {
    const llave = await crypto.subtle.importKey('jwk', { kty: k.kty, n: k.n, e: k.e, alg: 'RS256', ext: true }, ALG, false, ['verify']);
    if (await crypto.subtle.verify(ALG, llave, deB64url(p[2]), cod.encode(p[0] + '.' + p[1]))) return carga;
  }
  throw new Error('La firma del mensaje no es válida');
}
