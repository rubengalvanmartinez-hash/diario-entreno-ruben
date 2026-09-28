-- ============================================================================
-- Diario de entreno — v2.8.0 — Módulo MEAM (Motor de Evidencia de Adaptación Muscular, config 2.3.0-rc)
-- Ejecutar en el SQL Editor de Supabase (una sola vez). Idempotente: se puede repetir sin efectos.
-- La app funciona aunque este SQL no se haya ejecutado (reintenta sin las columnas nuevas y avisa por consola),
-- pero sin él no se guardan ni el tipo de sesión (descarga) ni los snapshots.
-- ============================================================================

-- 1) Tipo de sesión (descarga / rehab / test). NULL = normal.
ALTER TABLE entrenos ADD COLUMN IF NOT EXISTS tipo_sesion text
  CHECK (tipo_sesion IS NULL OR tipo_sesion IN ('normal', 'deload', 'rehab', 'test'));

-- 2) Duplicados. NO se crea índice único ni se borra nada automáticamente: la app permite el mismo ejercicio dos veces en una
--    sesión (números de serie repetidos) y la sincronización hace DELETE + INSERT no atómicos, así que un índice único podría
--    dejar sesiones sin filas (auditoría 6, C2). El motor MEAM deduplica por día y variante al calcular.
--    Consulta de diagnóstico (solo lectura): filas con las mismas 4 claves y contenido distinto.
--    SELECT usuario_id, sesion_id, ejercicio, serie, count(*)
--      FROM entrenos GROUP BY 1, 2, 3, 4
--    HAVING count(*) > 1 AND count(DISTINCT (reps, peso_kg, etiqueta)) > 1;

-- 3) Mapa de variantes revisado por el usuario (correcciones al mapa por palabras clave de src/meam/variants.ts).
CREATE TABLE IF NOT EXISTS meam_variants (
  usuario_id    uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  ejercicio     text NOT NULL,                       -- nombre canónico (utils/normalizar)
  musculo       text NOT NULL CHECK (musculo IN ('pecho','hombro','biceps','triceps','espalda','cuadriceps','femoral_gluteo','gemelo','abdomen','otros')),
  cluster       text NOT NULL,
  role          text NOT NULL DEFAULT 'DIRECT' CHECK (role IN ('DIRECT','SECONDARY','STABILIZER')),
  equipment     text NOT NULL DEFAULT 'compound_free' CHECK (equipment IN ('compound_free','isolation_machine','assisted','weighted_bodyweight')),
  es_asistencia boolean NOT NULL DEFAULT false,
  aislamiento   boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, ejercicio)
);
ALTER TABLE meam_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all ON meam_variants;
CREATE POLICY anon_all ON meam_variants FOR ALL TO anon USING (true) WITH CHECK (true);

-- 4) Snapshots append-only del motor (nunca UPDATE: una versión nueva por corte, modelo, config e input_hash).
CREATE TABLE IF NOT EXISTS meam_snapshots (
  id                    bigserial PRIMARY KEY,
  usuario_id            uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  semana                date NOT NULL,               -- lunes del corte (el corte incluye solo datos anteriores)
  musculo               text NOT NULL,
  model_version         text NOT NULL,
  config_version        text NOT NULL,
  input_hash            text NOT NULL,
  estado                text NOT NULL,               -- PROGRESANDO | ESTABLE | DECLINANDO | REGRESION_PROBABLE | INCONCLUYENTE
  etiqueta              text NOT NULL DEFAULT '',
  recuperacion          text NOT NULL,               -- NORMAL | FATIGA_SOSPECHADA | FATIGA_APOYADA | NO_ATRIBUIDA
  etiqueta_recuperacion text NOT NULL DEFAULT '',
  confianza             text NOT NULL,               -- ALTA | MEDIA | BAJA | INSUFICIENTE
  accion                text NOT NULL DEFAULT '',
  evidencia             jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (usuario_id, semana, musculo, model_version, config_version, input_hash)
);
CREATE INDEX IF NOT EXISTS meam_snapshots_usuario_musculo_semana ON meam_snapshots (usuario_id, musculo, semana DESC);
ALTER TABLE meam_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all ON meam_snapshots;
CREATE POLICY anon_all ON meam_snapshots FOR ALL TO anon USING (true) WITH CHECK (true);

-- Nota: la app usa autenticación propia con la clave anon (sin auth.uid()), por lo que estas políticas son las mismas
-- que en el resto de tablas. Los snapshots son legibles por cualquier usuario de la app (dos usuarios hoy).
