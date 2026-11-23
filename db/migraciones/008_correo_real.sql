-- =============================================================================
-- Migración 008 — Envío real de correos (RF01, RF02, RNF13)
-- Los correos se siguen guardando en correo_simulado (bandeja de demostración) y el
-- servidor los envía por SMTP cuando está configurado, anotando el resultado.
-- =============================================================================
SET client_encoding = 'UTF8';

BEGIN;

ALTER TABLE correo_simulado
  ADD COLUMN enviado_en TIMESTAMPTZ,                              -- cuándo salió (NULL = pendiente)
  ADD COLUMN intentos   INT  NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  ADD COLUMN error      TEXT;                                     -- último error del servidor de correo

-- Los correos anteriores ya no se envían: sus códigos y enlaces están vencidos
UPDATE correo_simulado SET enviado_en = creado_en, error = 'Anterior al envío real' WHERE enviado_en IS NULL;

CREATE INDEX ix_correo_pendiente ON correo_simulado (creado_en) WHERE enviado_en IS NULL;

INSERT INTO auditoria (actor_id, accion, entidad, entidad_id, detalle) VALUES
  (NULL, 'Migración 008', 'CORREO', '*', 'Envío real de correos por SMTP');

COMMIT;
