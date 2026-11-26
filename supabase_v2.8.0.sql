-- =============================================================================
-- FitLog v2.8.0 — Ejercicios en suspenso, ejercicios "cada lado por separado"
-- y repeticiones del lado izquierdo.
-- Ejecutar en el SQL Editor del proyecto Supabase (pegar y pulsar Run).
-- La app funciona sin esto (guarda sin estas columnas), pero hasta ejecutarlo
-- «En suspenso», «Cada lado por separado» y las reps del lado izquierdo solo
-- quedan en el móvil y no se sincronizan.
-- No modifica ni borra ninguna fila existente.
-- =============================================================================

-- 1. Reps del lado IZQUIERDO en ejercicios unilaterales (reps = lado derecho).
--    NULL = serie normal (un solo número de reps).
ALTER TABLE entrenos ADD COLUMN IF NOT EXISTS reps_izq integer;

-- 2. Ejercicio fuera de la rutina pero conservado (se recupera desde Ajustes).
ALTER TABLE ejercicios_usuario ADD COLUMN IF NOT EXISTS suspendido boolean NOT NULL DEFAULT false;

-- 3. Ejercicio que se registra por lados (derecho / izquierdo).
ALTER TABLE ejercicios_usuario ADD COLUMN IF NOT EXISTS unilateral boolean NOT NULL DEFAULT false;

-- 4. Que la API vea las columnas nuevas al momento.
NOTIFY pgrst, 'reload schema';
