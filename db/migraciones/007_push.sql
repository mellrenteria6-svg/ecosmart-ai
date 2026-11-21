-- =============================================================================
-- Migración 007 — Notificaciones push (RF23)
-- Cada dispositivo donde el usuario activa los avisos guarda una suscripción.
-- Si el usuario no da permiso, los avisos siguen disponibles dentro de la app.
-- =============================================================================
SET client_encoding = 'UTF8';

BEGIN;

CREATE TABLE suscripcion_push (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  UUID        NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  endpoint    TEXT        NOT NULL UNIQUE CHECK (endpoint LIKE 'https://%'),
  p256dh      TEXT        NOT NULL,
  auth        TEXT        NOT NULL,
  agente      TEXT,                                   -- navegador, para que el usuario reconozca el dispositivo
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_suscripcion_usuario ON suscripcion_push (usuario_id);

INSERT INTO auditoria (actor_id, accion, entidad, entidad_id, detalle) VALUES
  (NULL, 'Migración 007', 'SUSCRIPCION_PUSH', '*', 'Suscripciones para notificaciones push');

COMMIT;
