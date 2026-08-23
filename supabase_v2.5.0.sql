-- =============================================================================
-- FitLog v2.5.0 — Dos gimnasios (Entrena-T referencia / Fitness Park equivalente)
-- Ejecutar en el SQL Editor del proyecto Supabase.
-- La app funciona sin esto (reintenta sin la columna y guarda equivalencias en
-- local), pero el gimnasio de cada entreno y las equivalencias solo se
-- sincronizan entre móviles cuando existen.
-- =============================================================================

-- 1. Gimnasio de cada fila de entreno (NULL = Entrena-T). No modifica ninguna fila existente.
ALTER TABLE entrenos ADD COLUMN IF NOT EXISTS gimnasio text;

-- 2. Equivalencias por ejercicio: factor = kg de Entrena-T por cada kg en ese gimnasio
--    (p. ej. 100 kg ET = 80 kg FP → factor 1.25). Clave: nombre canónico del ejercicio.
CREATE TABLE IF NOT EXISTS equivalencias_gimnasio (
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  ejercicio  text NOT NULL,
  gimnasio   text NOT NULL,
  factor     double precision NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, ejercicio, gimnasio)
);
ALTER TABLE equivalencias_gimnasio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON equivalencias_gimnasio FOR ALL TO anon USING (true) WITH CHECK (true);
