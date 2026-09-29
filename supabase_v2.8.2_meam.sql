-- v2.8.2 — MEAM: revisión de ejercicios sin uso (retirar / heredar / sigo usándolo).
-- Ejecutar una vez en el SQL Editor de Supabase. Idempotente. No borra ni modifica datos existentes.
ALTER TABLE meam_variants ADD COLUMN IF NOT EXISTS retirado    boolean NOT NULL DEFAULT false;  -- fuera del cálculo
ALTER TABLE meam_variants ADD COLUMN IF NOT EXISTS sucesor     text NULL;                       -- clave canónica del ejercicio que hereda su historial
ALTER TABLE meam_variants ADD COLUMN IF NOT EXISTS revisado_en date NULL;                       -- última decisión del usuario («sigo usándolo» vuelve a preguntar a las 16 semanas)
