"""Exporta ficheros dorados (escenarios S1–S13 + extras) para el port TypeScript: entradas exactas y snapshots de referencia."""
import json, math, sys
import numpy as np
from meam_core import CONFIG, Exposure
from meam_engine import VariantDef, run_weekly, simulate
from meam_verify2 import pool_rho

RHO = pool_rho(0.0)
V = lambda ex, cl="C1", eq="compound_free": VariantDef(ex, cl, eq)


def ex_json(exps):
    return [[float(e.t), repr(float(e.y)), e.session_type, bool(e.excluded_from_noise), int(e.reps_typical), float(e.load_kg), e.stratum] for e in exps]


def rows_json(rows):
    out = []
    for r in rows:
        d = dict(week=r.week, n_exp=r.n_exp, tier=r.tier, n_err=r.n_err, sigma_pct=r.sigma_pct, DCT_pct=r.DCT_pct, D=r.D, T=r.T, eff=r.eff,
                 adaptation=r.adaptation, adapt_label=r.adapt_label, recovery=r.recovery, rec_label=r.rec_label, flags=r.flags, rho=r.rho, mds=r.mds)
        out.append({k: (None if isinstance(v, float) and not np.isfinite(v) else v) for k, v in d.items()})
    return out


cases = []
def add(name, variants, weeks, ctx=frozenset(), start_week=6, vol=()):
    rows = run_weekly(variants, weeks, context_high_weeks=set(ctx), volume_reduction_ts=list(vol), start_week=start_week, rho_fixed=RHO)
    cases.append(dict(name=name, weeks=weeks, start_week=start_week, context_high_weeks=sorted(ctx), volume_reduction_ts=list(vol), rho_fixed=RHO,
                      variants={k: dict(exps=ex_json(vd.exps), cluster=vd.cluster, equipment_class=vd.equipment_class, role=vd.role,
                                        protocol_breaks=list(vd.protocol_breaks)) for k, vd in variants.items()},
                      rows=rows_json(rows)))

add("S1 progreso +0.3%/sem", {"v": V(simulate(22, 2, 0.3, 2.0, seed=1))}, 22)
add("S2 estancado", {"v": V(simulate(22, 2, 0.0, 2.0, seed=2))}, 22)
ep = [{"a": 12, "b": 15, "level_pct": -5.0}, {"a": 15, "b": 16, "level_pct": -12.0, "session_type": "deload"}]
add("S3 fatiga + deload + rebote", {"v": V(simulate(22, 2, 0.3, 2.0, seed=3, episodes=ep))}, 22, ctx=set(range(12, 16)))
e1 = simulate(10, 2, 0.3, 2.0, seed=4); e2 = simulate(14, 2, -0.6, 2.0, seed=44, y0=math.log(100) + math.log(1.003) * 10, start_week=10)
add("S4 declive lento", {"v": V(e1 + e2)}, 24)
e1 = simulate(12, 2, 0.0, 2.0, seed=5); e2 = simulate(12, 2, 0.0, 2.0, seed=55, y0=math.log(100), start_week=16, episodes=[{"a": 0, "b": 3, "level_pct": -4.0}])
add("S5 vacacion 28d", {"v": V(e1 + e2)}, 28)
ex = simulate(18, 2, 0.3, 2.0, seed=6); k = [i for i, x in enumerate(ex) if 10 <= x.t < 10.5][0]; ex[k].y += math.log(0.90)
add("S6 outlier", {"v": V(ex)}, 18)
add("S10 deloads declarados", {"v": V(simulate(22, 2, 0.0, 2.0, seed=61, deload_every=6, deload_drop_pct=-12.0))}, 22)
add("S11 escalon -6%", {"v": V(simulate(26, 2, 0.0, 2.0, seed=62, episodes=[{"a": 12, "b": 26, "level_pct": -6.0}]))}, 26)
e1 = simulate(14, 2, 0.4, 2.0, seed=63); e2 = simulate(14, 2, 0.0, 2.0, seed=64, y0=math.log(100) + math.log(1.004) * 14, start_week=14)
add("S12 meseta", {"v": V(e1 + e2)}, 28)
pec = V(simulate(20, 2, 0.4, 1.0, seed=8), "ADDUCTION", "isolation_machine"); ben = V(simulate(20, 2, 0.0, 3.5, seed=88), "PRESS"); inc = V(simulate(20, 2, 0.1, 2.5, seed=888), "PRESS")
add("S8 agregacion 3 variantes 2 clusters", {"pec": pec, "banca": ben, "incl": inc}, 20)
add("S13 1/sem estancado", {"v": V(simulate(40, 1, 0.0, 2.0, seed=65, skip_p=0.1))}, 40)
# extras: doble progresión cuantizada (canal largo), cambio de rango 5→10 (estratos), duplicados, contexto 100 % con escalón (NO_ATRIBUIDA → cierre)
sys.argv = [sys.argv[0]]
import audit4_adversarial as A
add("E8 doble progresion cuantizada", {"v": V(A.gen_double_prog(45, 1000, bias=0.0))}, 45)
rng = np.random.default_rng(5); ts = np.array(A.times(40)); eps = A.ar1(len(ts), 0.3, 0.02, rng)
reps = np.where(ts < 20, 5, 10); bias = np.where(ts < 20, 0.0, math.log(1.05))
add("R1 cambio de rango 5->10", {"v": V(A.exps_from(ts, math.log(100) + eps + bias, reps=reps))}, 40)
add("E5 duplicados", {"v": V(A.dup(simulate(30, 2, 0.0, 2.0, seed=7)))}, 30)
add("escalon -6% contexto 100%", {"v": V(simulate(44, 2, 0.0, 2.0, seed=9, episodes=[{"a": 12, "b": 44, "level_pct": -6.0}]))}, 44, ctx=set(range(45)))
add("fatiga con reduccion de volumen", {"v": V(simulate(30, 2, 0.2, 2.0, seed=11, episodes=[{"a": 14, "b": 18, "level_pct": -5.0}]))}, 30, ctx=set(range(14, 19)), vol=(18.0,))

json.dump(dict(config_version=CONFIG["config_version"], cases=cases), open(sys.argv[1] if len(sys.argv) > 1 else "golden.json", "w"))
print(len(cases), "casos;", sum(len(c["rows"]) for c in cases), "snapshots; rho_fixed =", RHO)
