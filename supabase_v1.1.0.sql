-- =============================================================================
-- FitLog v1.1.0 — Migración Supabase
-- Ejecutar en el SQL Editor del proyecto: https://fxhkzstvxljlohrlgyyc.supabase.co
-- =============================================================================

-- ── 1. Tabla de ejercicios por usuario ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS ejercicios_usuario (
  id                 text        PRIMARY KEY,          -- nanoid generado por la app
  usuario_id         uuid        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre             text        NOT NULL,
  dia                smallint    NOT NULL,             -- 1, 2 o 3
  orden              int         NOT NULL DEFAULT 0,
  series_por_defecto smallint    NOT NULL DEFAULT 3,
  notas_fijas        text        NOT NULL DEFAULT '',
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ejercicios_usuario_usuario
  ON ejercicios_usuario(usuario_id);

-- ── 2. Tabla de plantilla base (ejercicios por defecto de Rubén) ─────────────

CREATE TABLE IF NOT EXISTS plantilla_ejercicios (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre             text        NOT NULL,
  dia                smallint    NOT NULL,
  orden              int         NOT NULL DEFAULT 0,
  series_por_defecto smallint    NOT NULL DEFAULT 3,
  notas_fijas        text        NOT NULL DEFAULT ''
);

-- ── 3. Insertar la plantilla base (los 18 ejercicios por defecto) ─────────────
-- Solo insertar si la tabla está vacía

INSERT INTO plantilla_ejercicios (nombre, dia, orden, series_por_defecto)
SELECT nombre, dia, orden, 3
FROM (VALUES
  -- Día 1
  ('Jalón al pecho',     1, 0),
  ('Peso muerto',        1, 1),
  ('Remo',               1, 2),
  ('Bíceps',             1, 3),
  ('Oblicuos',           1, 4),
  ('Polea Bíceps',       1, 5),
  -- Día 2
  ('Press de pecho',     2, 0),
  ('Press militar',      2, 1),
  ('Tríceps francés',    2, 2),
  ('Cruces en polea',    2, 3),
  ('Oblicuos en polea',  2, 4),
  ('Mariposa',           2, 5),
  ('Hip Thrust',         2, 6),
  -- Día 3
  ('Dominadas',          3, 0),
  ('Pecho inclinado',    3, 1),
  ('Bíceps martillo',    3, 2),
  ('Tríceps con soga',   3, 3),
  ('Vuelos laterales',   3, 4)
) AS t(nombre, dia, orden)
WHERE NOT EXISTS (SELECT 1 FROM plantilla_ejercicios LIMIT 1);

-- ── 4. RLS (Row Level Security) — opcional pero recomendado ─────────────────
-- Si tienes RLS activado en tu proyecto, añade policies adecuadas.
-- Por ahora se asume acceso mediante la clave publishable (service role off).
