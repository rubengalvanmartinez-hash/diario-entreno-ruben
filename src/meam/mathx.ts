/**
 * MEAM — utilidades numéricas sin dependencias (equivalentes a numpy/scipy para lo que usa el motor).
 * Todas las funciones son puras y deterministas.
 */

export const NaN_ = Number.NaN
export const isFin = (x: number): boolean => Number.isFinite(x)

export function mean(a: readonly number[]): number {
  if (a.length === 0) return NaN_
  let s = 0
  for (const v of a) s += v
  return s / a.length
}

/** Desviación típica poblacional (ddof = 0), como numpy.std. */
export function std(a: readonly number[]): number {
  if (a.length === 0) return NaN_
  const m = mean(a)
  let s = 0
  for (const v of a) s += (v - m) * (v - m)
  return Math.sqrt(s / a.length)
}

export function sorted(a: readonly number[]): number[] {
  return [...a].sort((x, y) => x - y)
}

/** Mediana como numpy.median (media de los dos centrales si n es par). */
export function median(a: readonly number[]): number {
  const n = a.length
  if (n === 0) return NaN_
  const s = sorted(a)
  const h = n >> 1
  return n % 2 === 1 ? s[h] : (s[h - 1] + s[h]) / 2
}

/** Percentil con interpolación lineal (numpy.percentile por defecto). p en [0, 100]. */
export function percentile(a: readonly number[], p: number): number {
  const n = a.length
  if (n === 0) return NaN_
  const s = sorted(a)
  const idx = (n - 1) * (p / 100)
  const lo = Math.floor(idx)
  const hi = Math.min(lo + 1, n - 1)
  const frac = idx - lo
  return s[lo] + (s[hi] - s[lo]) * frac
}

export function diff(a: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < a.length; i++) out.push(a[i] - a[i - 1])
  return out
}

/** Valores únicos ordenados (numpy.unique sobre números). */
export function uniqueSorted(a: readonly number[]): number[] {
  const s = sorted(a)
  const out: number[] = []
  for (const v of s) if (out.length === 0 || out[out.length - 1] !== v) out.push(v)
  return out
}

/** Recuento por valor exacto (numpy.unique(return_counts=True)). */
export function valueCounts(a: readonly number[]): number[] {
  const m = new Map<number, number>()
  for (const v of a) m.set(v, (m.get(v) ?? 0) + 1)
  return [...m.values()]
}

/** Correlación de Pearson (numpy.corrcoef[0,1]). */
export function corrcoef(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length)
  const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n))
  let sab = 0, saa = 0, sbb = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb
    sab += da * db; saa += da * da; sbb += db * db
  }
  return sab / Math.sqrt(saa * sbb)
}

export function clip(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi)
}

export function sign(x: number): number {
  return x > 0 ? 1 : x < 0 ? -1 : 0
}

export function argsort(a: readonly number[]): number[] {
  return a.map((_, i) => i).sort((i, j) => a[i] - a[j] || i - j)
}

/** Redondeo a `d` decimales (numpy.round: half-to-even sobre el valor escalado). */
export function roundTo(x: number, d: number): number {
  const f = Math.pow(10, d)
  const y = x * f
  const r = Math.round(y)
  // half-to-even como numpy cuando la parte fraccionaria es exactamente 0,5
  if (Math.abs(y - Math.trunc(y)) === 0.5) {
    const t = Math.trunc(y)
    return (t % 2 === 0 ? t : t + Math.sign(y)) / f
  }
  return r / f
}

// ---------------------------------------------------------------------------
// Funciones especiales (Numerical Recipes): gammln, gammp (erf), betai (t de Student)
// ---------------------------------------------------------------------------
const LANCZOS = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]

export function gammln(xx: number): number {
  let x = xx, y = xx
  let tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (let j = 0; j < 6; j++) ser += LANCZOS[j] / ++y
  return -tmp + Math.log(2.5066282746310005 * ser / x)
}

const ITMAX = 500
const EPS = 3e-16
const FPMIN = 1e-300

function gser(a: number, x: number): number {
  const gln = gammln(a)
  if (x <= 0) return 0
  let ap = a, sum = 1 / a, del = sum
  for (let n = 1; n <= ITMAX; n++) {
    ap += 1; del *= x / ap; sum += del
    if (Math.abs(del) < Math.abs(sum) * EPS) break
  }
  return sum * Math.exp(-x + a * Math.log(x) - gln)
}

function gcf(a: number, x: number): number {
  const gln = gammln(a)
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d
  for (let i = 1; i <= ITMAX; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return Math.exp(-x + a * Math.log(x) - gln) * h
}

/** Función gamma incompleta regularizada P(a, x). */
export function gammp(a: number, x: number): number {
  if (x < 0 || a <= 0) return NaN_
  return x < a + 1 ? gser(a, x) : 1 - gcf(a, x)
}

export function erf(x: number): number {
  return x < 0 ? -gammp(0.5, x * x) : gammp(0.5, x * x)
}

export function erfc(x: number): number {
  return x < 0 ? 1 + gammp(0.5, x * x) : 1 - gammp(0.5, x * x)
}

/** Φ(x): función de distribución normal estándar. */
export function normCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2)
}

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

/** Φ⁻¹(p) (scipy.stats.norm.ppf): algoritmo de Acklam refinado con dos pasos de Newton. */
export function normPpf(p: number): number {
  if (!(p > 0 && p < 1)) return p <= 0 ? -Infinity : p >= 1 ? Infinity : NaN_
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01]
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00]
  const plow = 0.02425, phigh = 1 - plow
  let x: number
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p))
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  } else if (p <= phigh) {
    const q = p - 0.5, r = q * q
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  for (let i = 0; i < 2; i++) {
    const e = normCdf(x) - p
    x -= e / normPdf(x)
  }
  return x
}

function betacf(a: number, b: number, x: number): number {
  const qab = a + b, qap = a + 1, qam = a - 1
  let c = 1, d = 1 - qab * x / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= ITMAX; m++) {
    const m2 = 2 * m
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2))
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d; h *= d * c
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}

/** Función beta incompleta regularizada I_x(a, b). */
export function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(gammln(a + b) - gammln(a) - gammln(b) + a * Math.log(x) + b * Math.log(1 - x))
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b
}

/** Función de distribución de la t de Student con ν grados de libertad. */
export function tCdf(x: number, nu: number): number {
  const ib = betai(nu / 2, 0.5, nu / (nu + x * x))
  return x >= 0 ? 1 - 0.5 * ib : 0.5 * ib
}

/** Cuantil de la t de Student (scipy.stats.t.ppf) por bisección sobre tCdf. */
export function tPpf(p: number, nu: number): number {
  if (!(p > 0 && p < 1)) return p <= 0 ? -Infinity : p >= 1 ? Infinity : NaN_
  let lo = -1e3, hi = 1e3
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2
    if (tCdf(mid, nu) < p) lo = mid; else hi = mid
    if (hi - lo < 1e-14 * Math.max(1, Math.abs(mid))) break
  }
  return (lo + hi) / 2
}
