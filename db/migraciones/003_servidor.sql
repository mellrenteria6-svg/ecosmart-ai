-- =============================================================================
-- Migración 003 — Soporte para el servidor de la aplicación
--   * Sesiones con token (se guarda solo su hash SHA-256)
--   * Bandeja de correo simulada para la demostración (verificación, 2FA)
-- =============================================================================
SET client_encoding = 'UTF8';

BEGIN;

ALTER TABLE sesion ADD COLUMN token_hash TEXT NOT NULL UNIQUE;
CREATE INDEX ix_sesion_usuario ON sesion (usuario_id);

CREATE TABLE correo_simulado (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  para       CITEXT      NOT NULL,
  asunto     TEXT        NOT NULL,
  cuerpo     TEXT        NOT NULL,
  enlace     TEXT,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
