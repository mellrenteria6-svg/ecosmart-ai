-- =============================================================================
-- Migración 009 — Equipos de confianza (RNF13)
-- Administrador y aliado usan segundo factor, pero solo la primera vez en cada equipo:
-- después ese navegador queda recordado 30 días. Se guarda solo la huella SHA-256 del
-- identificador del equipo. Cambiar la contraseña, el rol o bloquear la cuenta los borra.
-- =============================================================================
SET client_encoding = 'UTF8';

BEGIN;

CREATE TABLE equipo_confianza (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  UUID        NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,
  agente      TEXT,                                   -- navegador, para reconocer el equipo
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  vence_en    TIMESTAMPTZ NOT NULL,
  usado_en    TIMESTAMPTZ
);
CREATE INDEX ix_equipo_confianza_usuario ON equipo_confianza (usuario_id);

INSERT INTO auditoria (actor_id, accion, entidad, entidad_id, detalle) VALUES
  (NULL, 'Migración 009', 'EQUIPO_CONFIANZA', '*', 'Segundo factor una vez por equipo (30 días)');

COMMIT;
