// Motor de cálculo. Recalcula todo el libro tras cada cambio (las hojas son pequeñas),
// con memoria por generación y detección de referencias circulares.

import { analizar, serializar, crearDialecto, CANON, recorrer, ErrorFormula, dir } from './analizador.js';
import { FUNCIONES, Err, esc, num, bool, compara } from './funciones.js';

const preciso = x => (typeof x === 'number' && isFinite(x)) ? parseFloat(x.toPrecision(15)) : x;

export function crearMotor(libro, reg) {
  const dl = crearDialecto(reg);
  let gen = 0;

  const ctx = {
    texto: v => v === null ? ''
      : typeof v === 'boolean' ? reg.logicos[v ? 'TRUE' : 'FALSE']
      : typeof v === 'number' ? String(preciso(v)).replace('.', reg.sepDec)
      : v
  };

  const hojaPorNombre = n => { const u = n.toLowerCase(); return libro.hojas.find(h => h.nombre.toLowerCase() === u); };
  const hojaDe = (n, hoja) => {
    if (!n.hoja) return hoja;
    const h = hojaPorNombre(n.hoja);
    if (!h) throw new Err('#REF!');
    return h;
  };

  function valor(hoja, c, f) {
    const cel = hoja.celdas.get(dir(c, f));
    if (!cel) return null;
    if (!cel.ast) return cel.v;
    if (cel._g !== gen || cel._s !== 2) calcular(cel, hoja);
    return cel.r;
  }

  function calcular(cel, hoja) {
    if (cel._g === gen && cel._s === 1) throw new Err('#CIRC!');
    cel._g = gen; cel._s = 1;
    let r;
    try {
      r = esc(ev(cel.ast, hoja));
      if (r === null) r = 0;
      if (typeof r === 'number' && !isFinite(r)) r = new Err('#NUM!');
    } catch (e) {
      if (!(e instanceof Err)) throw e;
      r = e;
    }
    cel.r = r; cel._s = 2;
  }

  function matriz(hoja, a, b) {
    const c1 = Math.min(a.c, b.c), c2 = Math.max(a.c, b.c), f1 = Math.min(a.f, b.f), f2 = Math.max(a.f, b.f);
    const out = [];
    for (let f = f1; f <= f2; f++) {
      const fila = [];
      for (let c = c1; c <= c2; c++) fila.push(valor(hoja, c, f));
      out.push(fila);
    }
    return out;
  }

  // Las referencias se entregan como matrices; el resto, como escalares.
  function ev(n, hoja) {
    switch (n.t) {
      case 'num': case 'str': case 'bool': return n.v;
      case 'err': throw new Err(n.v);
      case 'vacio': return null;
      case 'ref': return [[valor(hojaDe(n, hoja), n.c, n.f)]];
      case 'rango': return matriz(hojaDe(n.a, hoja), n.a, n.b);
      case 'nombre': {
        const d = libro.nombres.get(n.v.toLowerCase());
        if (!d) throw new Err('#NAME?');
        const h = hojaPorNombre(d.hoja);
        if (!h) throw new Err('#REF!');
        return matriz(h, { c: d.c1, f: d.f1 }, { c: d.c2, f: d.f2 });
      }
      case 'par': return ev(n.a, hoja);
      case 'un': { const v = num(ev(n.a, hoja)); return n.op === '-' ? -v : v; }
      case 'pct': return num(ev(n.a, hoja)) / 100;
      case 'bin': return binario(n, hoja);
      case 'fn': return funcion(n, hoja);
    }
    throw new Err('#VALUE!');
  }

  function binario(n, hoja) {
    const a = esc(ev(n.a, hoja)), b = esc(ev(n.b, hoja));
    switch (n.op) {
      case '+': return preciso(num(a) + num(b));
      case '-': return preciso(num(a) - num(b));
      case '*': return preciso(num(a) * num(b));
      case '/': { const x = num(a), d = num(b); if (d === 0) throw new Err('#DIV/0!'); return preciso(x / d); }
      case '^': { const r = Math.pow(num(a), num(b)); if (!isFinite(r)) throw new Err('#NUM!'); return preciso(r); }
      case '&': return ctx.texto(a) + ctx.texto(b);
    }
    const k = compara(a, b);
    switch (n.op) {
      case '=': return k === 0;
      case '<>': return k !== 0;
      case '<': return k < 0;
      case '>': return k > 0;
      case '<=': return k <= 0;
      case '>=': return k >= 0;
    }
    throw new Err('#VALUE!');
  }

  function funcion(n, hoja) {
    if (n.n === 'IF') {
      const c = bool(ev(n.args[0], hoja));
      const rama = n.args[c ? 1 : 2];
      if (!rama) return c ? 0 : false;
      return ev(rama, hoja);
    }
    if (n.n === 'IFERROR') {
      try { return esc(ev(n.args[0], hoja)); }
      catch (e) { if (e instanceof Err) return ev(n.args[1], hoja); throw e; }
    }
    const d = FUNCIONES[n.n];
    if (!d) throw new Err('#NAME?');
    return d[2](n.args.map(a => ev(a, hoja)), ctx);
  }

  function comprobar(ast) {
    recorrer(ast, n => {
      if (n.t !== 'fn') return;
      const d = FUNCIONES[n.n];
      if (d && (n.args.length < d[0] || n.args.length > d[1])) throw new ErrorFormula('argumentos', dl.nombreFn(n.n));
    });
    return ast;
  }

  return {
    dialecto: dl,
    ctx,
    analizarLocal: t => comprobar(analizar(t, dl)),
    analizarCanon: t => analizar(t, CANON),
    aLocal: ast => serializar(ast, dl),
    aCanon: ast => serializar(ast, CANON),
    recalcular() {
      gen++;
      for (const hoja of libro.hojas)
        for (const cel of hoja.celdas.values())
          if (cel.ast && (cel._g !== gen || cel._s !== 2)) {
            try { calcular(cel, hoja); } catch (e) { if (!(e instanceof Err)) throw e; cel.r = e; cel._s = 2; }
          }
    }
  };
}
