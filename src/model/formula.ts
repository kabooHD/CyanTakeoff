// Formula custom columns (Revu Markups List): arithmetic over other columns.
// Supports numbers, + - * / ^, parentheses, unary minus, column names
// (bare words, or [Names With Spaces]) and min/max/abs/round/sqrt.

type Tok = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string };

const FUNCS: Record<string, (...a: number[]) => number> = {
  min: Math.min, max: Math.max, abs: Math.abs, sqrt: Math.sqrt,
  round: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d,
};

function tokenize(src: string, names: string[]): Tok[] {
  const out: Tok[] = [];
  // Longest names first so "Unit Cost" wins over "Unit".
  const byLen = [...names].sort((a, b) => b.length - a.length);
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?/i.exec(src.slice(i))!;
      out.push({ k: 'num', v: Number(m[0]) }); i += m[0].length; continue;
    }
    if (c === '[') {
      const j = src.indexOf(']', i);
      if (j < 0) throw new Error('Missing ]');
      out.push({ k: 'id', v: src.slice(i + 1, j).trim() }); i = j + 1; continue;
    }
    if ('+-*/^(),'.includes(c)) { out.push({ k: 'op', v: c }); i++; continue; }
    const rest = src.slice(i);
    const name = byLen.find((n) => rest.toLowerCase().startsWith(n.toLowerCase()) && !/[A-Za-z0-9_]/.test(rest[n.length] ?? ''));
    if (name) { out.push({ k: 'id', v: name }); i += name.length; continue; }
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (!m) throw new Error(`Unexpected "${c}"`);
    out.push({ k: 'id', v: m[0] }); i += m[0].length;
  }
  return out;
}

/** Evaluate `expr` with variables looked up case-insensitively; NaN for errors or blanks. */
export function evaluate(expr: string, vars: Record<string, number | undefined>): number {
  const lookup = new Map(Object.entries(vars).map(([k, v]) => [k.toLowerCase(), v]));
  let toks: Tok[];
  try { toks = tokenize(expr, Object.keys(vars)); } catch { return NaN; }
  let pos = 0;
  const peek = () => toks[pos];
  const eat = (v?: string) => {
    const t = toks[pos];
    if (v && (!t || t.k !== 'op' || t.v !== v)) throw new Error(`Expected ${v}`);
    pos++;
    return t;
  };
  // expr := term (('+'|'-') term)*; term := power (('*'|'/') power)*; power := unary ('^' power)?
  const expr_ = (): number => {
    let v = term();
    while (peek()?.k === 'op' && (peek()!.v === '+' || peek()!.v === '-')) v = eat().v === '+' ? v + term() : v - term();
    return v;
  };
  const term = (): number => {
    let v = power();
    while (peek()?.k === 'op' && (peek()!.v === '*' || peek()!.v === '/')) v = eat().v === '*' ? v * power() : v / power();
    return v;
  };
  const power = (): number => {
    const b = unary();
    if (peek()?.k === 'op' && peek()!.v === '^') { eat(); return b ** power(); }
    return b;
  };
  const unary = (): number => {
    if (peek()?.k === 'op' && peek()!.v === '-') { eat(); return -unary(); }
    if (peek()?.k === 'op' && peek()!.v === '+') { eat(); return unary(); }
    return atom();
  };
  const atom = (): number => {
    const t = eat();
    if (!t) throw new Error('Unexpected end');
    if (t.k === 'num') return t.v;
    if (t.k === 'op' && t.v === '(') { const v = expr_(); eat(')'); return v; }
    if (t.k === 'id') {
      const fn = FUNCS[t.v.toLowerCase()];
      if (fn && peek()?.k === 'op' && peek()!.v === '(') {
        eat('(');
        const args = [expr_()];
        while (peek()?.k === 'op' && peek()!.v === ',') { eat(); args.push(expr_()); }
        eat(')');
        return fn(...args);
      }
      const v = lookup.get(t.v.toLowerCase());
      if (v === undefined) throw new Error(`Unknown column ${t.v}`);
      return v;
    }
    throw new Error('Syntax error');
  };
  try {
    const v = expr_();
    if (pos !== toks.length) return NaN;
    return v;
  } catch { return NaN; }
}

/** Whether an expression parses against the given column names (for the Add Column dialog). */
export function checkFormula(expr: string, names: string[]): string | null {
  const vars = Object.fromEntries(names.map((n) => [n, 1]));
  if (!expr.trim()) return 'Enter an expression';
  return Number.isNaN(evaluate(expr, vars)) ? 'The expression is not valid, or uses an unknown column' : null;
}
