// Sonidos de apoyo generados con Web Audio: no se descarga ningún archivo.
export function crearSonidos(defs) {
  let ctx = null, mudo = false;
  function tocar(id) {
    if (mudo || !defs[id]) return;
    try {
      const Clase = window.AudioContext || window.webkitAudioContext;
      if (!Clase) return;
      if (!ctx) ctx = new Clase();
      if (ctx.state === 'suspended') ctx.resume();
      const t0 = ctx.currentTime + 0.01;
      for (const [frec, dur, ini = 0, onda = 'sine'] of defs[id]) {
        const osc = ctx.createOscillator(), gan = ctx.createGain();
        osc.type = onda; osc.frequency.value = frec;
        gan.gain.setValueAtTime(0.0001, t0 + ini);
        gan.gain.exponentialRampToValueAtTime(0.16, t0 + ini + 0.015);
        gan.gain.exponentialRampToValueAtTime(0.0001, t0 + ini + dur);
        osc.connect(gan); gan.connect(ctx.destination);
        osc.start(t0 + ini); osc.stop(t0 + ini + dur + 0.03);
      }
    } catch (_) { /* sin audio: las señales visuales siguen funcionando */ }
  }
  return { tocar, silenciar: v => { mudo = !!v; }, mudo: () => mudo };
}
