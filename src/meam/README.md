# MEAM — Motor de Evidencia de Adaptación Muscular (v2.3.1-rc) en la app

Port a TypeScript de la implementación de referencia Python (`meam_core.py`, `meam_engine.py`), auditada externamente
(5 auditorías + contraopinión; ver `MEAM_v2_3_especificacion.md` en el expediente del proyecto). El motor mide **rendimiento**
(e1RM del top set, en ln), nunca "músculo", y evalúa cada músculo **a fecha de corte** (lunes) usando solo datos anteriores.

## Ficheros

| Fichero | Qué es | Origen |
|---|---|---|
| `config.ts` | Constantes versionadas (`config_version` 2.3.0-rc). Ninguna constante fuera de aquí | `CONFIG` de meam_core.py |
| `mathx.ts` | Cuantiles normal y t de Student, mediana, percentil, correlación… sin dependencias | numpy/scipy |
| `core.ts` | Theil-Sen estratificado con IC de Sen y Hamed-Rao finito, estratos por rango de reps con histéresis, escala causal, D, cluster con ρ̂, músculo, máquinas de estado (adaptación y recuperación), canal largo piloto | meam_core.py |
| `engine.ts` | `runSnapshots`: orquestación a fecha de corte, exclusiones derivadas versionadas, driver de recuperación, evidencia | meam_engine.py |
| `exposure.ts` | Capa P0–P3: series de la app → exposiciones (calentamiento, top set, errata, deload inferido, RIR, asistidos, volumen semanal) | spec P0–P3 (solo TypeScript) |
| `variants.ts` | Mapa ejercicio → músculo/cluster/rol/equipo por palabras clave + correcciones de `meam_variants` | — |
| `run.ts` | `ejecutarMeam`: informe por músculo (estado, confianza P14, acción P10, texto, evidencia, `input_hash`) | — |
| `services.ts` | Supabase: `meam_variants`, `meam_snapshots` (append-only) | — |
| `meam.worker.ts` | Web Worker: el cálculo (≈1 s en Node para 18 meses; 3–6× en móvil) va fuera del hilo principal y solo se repite si cambia el contenido del historial | — |
| `../pages/MeamPage.tsx` | Pantalla «Evidencia de adaptación» (ruta `/meam`, desde Tendencias) | — |

## Verificación

```bash
npm run test:meam    # 381 snapshots dorados (tests/meam_golden.json) comparados con la referencia Python + tests P0–P3
npm run test:logic   # tests previos de la app
npm run build        # tsc -b && vite build (obligatorio antes de subir)
```

Los ficheros dorados se generan con `export_golden.py` en el repositorio de referencia; si cambia `config_version` hay que regenerarlos.
Igualdad exigida: estados, etiquetas, banderas y tiers exactos; T, D, σ, ρ, MDS con tolerancia 1e-7.

## Base de datos

Ejecutar `supabase_v2.8.0_meam.sql` una vez: `entrenos.tipo_sesion`, `meam_variants` y `meam_snapshots`. Sin índices únicos ni borrados
(la app permite el mismo ejercicio dos veces por sesión; el motor deduplica por día). La app funciona sin el SQL (reintenta sin columnas nuevas y avisa por consola).

## Decisiones fijadas en esta versión

- Canal canónico: `e1RM_raw` siempre; el RIR se guarda pero no cambia la variable (contraopinión 6.1).
- Canal largo de 26 semanas: **piloto**, solo etiqueta (`PROGRESO_LENTO_26S` / `DECLIVE_LENTO_26S`) en «¿Por qué?»; nunca cambia el estado.
- Exclusiones de ruido solo por episodio confirmado (evento exógeno + rebote), con tope de 10 semanas/52 (`EXCLUSION_EXCESIVA`).
- Contexto de carga alta: en la app solo hay volumen (≥ P70 personal); RPE/sueño/estrés/dolor no se registran todavía.
- Confianza BAJA y sin acción mientras `RUIDO_NO_CALIBRADO` (hacen falta ≥ 3 ejercicios con ≥ 20 exposiciones en ventana).
- `deload_inferido`: series de trabajo ≤ 60 % y carga top ≤ 90 % de la mediana de las sesiones normales de los 28 días previos (mín. 3); una descarga no se evalúa como errata.
- Errata: |ln e1RM − mediana de las 5 previas| > 0,22 ⇒ excluida; **tres seguidas del mismo signo = nuevo nivel** (se readmiten, ruptura de protocolo propuesta, referencia nueva).
- Dominadas/fondos sin asistencia: `weighted_bodyweight` (W = BW_ref + lastre; a 0 kg cuenta el peso corporal); asistidos: W = BW_ref − asistencia; BW_ref = mediana de 7 d (o último ≤ 21 d).
- Cortes solo de semanas completas (lunes en curso); volumen, reducciones y contexto no usan la semana parcial; confianza con histéresis de 2 snapshots.
- Caché por (variante, corte, exclusiones) y errores rolling-origin incrementales dentro de una ejecución: idéntico al cálculo completo (comprobado con los 812 snapshots de las dos baterías).

## Pendiente (F3: backtest con el histórico real)

Calibrar α_T, κ y ρ̂ sobre los cortes semanales reales; medir la tasa de etiquetas y la prevalencia de φ>0,3; decidir si el canal largo
entra en la máquina de estados; validar `deload_inferido` y el mapa de variantes sobre el histórico (nombres sin asignar); RIR como
corroboración (`ESFUERZO_CAMBIADO`) sigue especificado, no implementado.
