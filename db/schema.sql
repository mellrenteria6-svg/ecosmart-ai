-- =============================================================================
-- EcoSmart AI — Esquema de base de datos PostgreSQL (Fase 1)
-- Basado en la Especificación de requisitos v1.0.
-- Versión recomendada: PostgreSQL 18 (probado en 18.6). Compatible con 15 o superior.
--
-- Ejecutar:  psql -U postgres -d ecosmart -f db/schema.sql
-- Luego:     psql -U postgres -d ecosmart -f db/seed.sql
-- =============================================================================

-- Los archivos están en UTF-8 (tildes y ñ); evita errores con la consola de Windows
SET client_encoding = 'UTF8';

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid(), crypt()
CREATE EXTENSION IF NOT EXISTS citext;   -- correos sin distinguir mayúsculas

-- -----------------------------------------------------------------------------
-- Tipos enumerados
-- -----------------------------------------------------------------------------
CREATE TYPE rol_usuario       AS ENUM ('usuario', 'recolector', 'admin', 'aliado');
CREATE TYPE estado_punto      AS ENUM ('activo', 'inactivo', 'mantenimiento');
CREATE TYPE estado_reciclaje  AS ENUM ('pendiente', 'en_revision', 'validado', 'rechazado');
CREATE TYPE tipo_movimiento   AS ENUM ('reciclaje', 'canje', 'devolucion', 'ajuste');
CREATE TYPE tipo_recompensa   AS ENUM ('beneficio', 'sorteo', 'donacion');
CREATE TYPE estado_canje      AS ENUM ('pendiente', 'entregado', 'vencido', 'cancelado');
CREATE TYPE tipo_token        AS ENUM ('verificacion', 'restablecer', 'segundo_factor');
CREATE TYPE estado_alerta     AS ENUM ('abierta', 'resuelta', 'descartada');

-- -----------------------------------------------------------------------------
-- Campus y configuración
-- -----------------------------------------------------------------------------
CREATE TABLE campus (
  id                     SMALLSERIAL PRIMARY KEY,
  nombre                 TEXT        NOT NULL,
  dominio_institucional  CITEXT      NOT NULL UNIQUE,         -- RN01
  zona_horaria           TEXT        NOT NULL DEFAULT 'America/Guayaquil'
);

-- Parámetros de la línea base (sección 12 del documento)
CREATE TABLE configuracion (
  campus_id               SMALLINT     PRIMARY KEY REFERENCES campus(id),
  tope_diario             SMALLINT     NOT NULL DEFAULT 10   CHECK (tope_diario >= 1),
  umbral_confianza        NUMERIC(3,2) NOT NULL DEFAULT 0.70 CHECK (umbral_confianza > 0 AND umbral_confianza < 1),
  horas_vencimiento_canje SMALLINT     NOT NULL DEFAULT 72   CHECK (horas_vencimiento_canje >= 1),
  dias_retencion_fotos    SMALLINT     NOT NULL DEFAULT 90   CHECK (dias_retencion_fotos >= 1),
  modelo_version          TEXT         NOT NULL,
  factor_impacto_version  TEXT         NOT NULL,
  actualizado_en          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Usuarios, sesiones y tokens (RF01, RF02, RF25, RNF13)
-- -----------------------------------------------------------------------------
CREATE TABLE usuario (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id                SMALLINT    NOT NULL REFERENCES campus(id),
  nombre                   TEXT        NOT NULL CHECK (length(trim(nombre)) > 0),
  correo                   CITEXT      NOT NULL UNIQUE,
  facultad                 TEXT        NOT NULL,
  rol                      rol_usuario NOT NULL DEFAULT 'usuario',
  password_hash            TEXT        NOT NULL,              -- bcrypt: crypt(clave, gen_salt('bf'))
  verificado               BOOLEAN     NOT NULL DEFAULT false,
  bloqueado                BOOLEAN     NOT NULL DEFAULT false, -- RN11: conserva historial
  intentos_fallidos        SMALLINT    NOT NULL DEFAULT 0,
  bloqueo_temporal_hasta   TIMESTAMPTZ,                        -- 5 intentos → bloqueo temporal
  sesion_version           INTEGER     NOT NULL DEFAULT 1,     -- incrementar revoca sesiones
  ranking_anonimo          BOOLEAN     NOT NULL DEFAULT false,
  consentimiento_privacidad BOOLEAN    NOT NULL,
  creado_en                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE token (
  token       TEXT        PRIMARY KEY,
  usuario_id  UUID        NOT NULL REFERENCES usuario(id),
  tipo        tipo_token  NOT NULL,
  vence_en    TIMESTAMPTZ NOT NULL,
  usado       BOOLEAN     NOT NULL DEFAULT false               -- un solo uso
);
CREATE INDEX ix_token_usuario ON token (usuario_id, tipo) WHERE NOT usado;

CREATE TABLE sesion (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id      UUID        NOT NULL REFERENCES usuario(id),
  sesion_version  INTEGER     NOT NULL,                        -- debe coincidir con usuario.sesion_version
  creada_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_en       TIMESTAMPTZ NOT NULL
);

-- -----------------------------------------------------------------------------
-- Categorías de residuo con versiones (RF16, RF29, RN04, RN12)
-- -----------------------------------------------------------------------------
CREATE TABLE categoria_residuo (
  id                  TEXT         PRIMARY KEY,               -- ej. 'cat-pet'
  nombre              TEXT         NOT NULL UNIQUE,
  descripcion         TEXT,
  unidad              TEXT         NOT NULL,
  puntos_por_unidad   NUMERIC(8,2) NOT NULL CHECK (puntos_por_unidad > 0),
  minimo              NUMERIC(8,2) NOT NULL CHECK (minimo > 0),
  maximo              NUMERIC(8,2) NOT NULL,
  version             INTEGER      NOT NULL DEFAULT 1,
  color               TEXT         NOT NULL DEFAULT '#2f5d46',
  activa              BOOLEAN      NOT NULL DEFAULT true,     -- una categoría usada se desactiva, no se borra
  co2_kg_por_unidad   NUMERIC(8,3) NOT NULL DEFAULT 0,        -- factores de impacto (RF22)
  agua_l_por_unidad   NUMERIC(8,3) NOT NULL DEFAULT 0,
  energia_kwh_por_unidad NUMERIC(8,3) NOT NULL DEFAULT 0,
  CHECK (maximo >= minimo)
);

-- Cada cambio genera una fila nueva; las anteriores no se modifican
CREATE TABLE categoria_version (
  categoria_id        TEXT         NOT NULL REFERENCES categoria_residuo(id),
  version             INTEGER      NOT NULL,
  unidad              TEXT         NOT NULL,
  puntos_por_unidad   NUMERIC(8,2) NOT NULL,
  minimo              NUMERIC(8,2) NOT NULL,
  maximo              NUMERIC(8,2) NOT NULL,
  vigente_desde       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  creado_por          UUID         REFERENCES usuario(id),
  PRIMARY KEY (categoria_id, version)
);

-- -----------------------------------------------------------------------------
-- Puntos de reciclaje y asignación de recolectores (RF04–RF07, RF28, RN14)
-- -----------------------------------------------------------------------------
CREATE TABLE punto_reciclaje (
  id          TEXT         PRIMARY KEY,                        -- ej. 'p-biblioteca'
  campus_id   SMALLINT     NOT NULL REFERENCES campus(id),
  nombre      TEXT         NOT NULL,
  ubicacion   TEXT         NOT NULL DEFAULT '',
  codigo_qr   TEXT         NOT NULL UNIQUE,                    -- RF05: no contiene datos personales
  estado      estado_punto NOT NULL DEFAULT 'activo',
  visible     BOOLEAN      NOT NULL DEFAULT true,
  mapa_x      NUMERIC(5,2) CHECK (mapa_x BETWEEN 0 AND 100),
  mapa_y      NUMERIC(5,2) CHECK (mapa_y BETWEEN 0 AND 100)
);

CREATE TABLE punto_categoria (
  punto_id      TEXT NOT NULL REFERENCES punto_reciclaje(id) ON DELETE CASCADE,
  categoria_id  TEXT NOT NULL REFERENCES categoria_residuo(id),
  PRIMARY KEY (punto_id, categoria_id)
);

CREATE TABLE asignacion_recolector (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recolector_id  UUID        NOT NULL REFERENCES usuario(id),
  punto_id       TEXT        NOT NULL REFERENCES punto_reciclaje(id),
  desde          DATE        NOT NULL,
  hasta          DATE        NOT NULL,
  horario        TEXT        NOT NULL,
  activa         BOOLEAN     NOT NULL DEFAULT true,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (hasta >= desde)
);
-- Solo una asignación activa por recolector y punto
CREATE UNIQUE INDEX ux_asignacion_activa ON asignacion_recolector (recolector_id, punto_id) WHERE activa;

-- -----------------------------------------------------------------------------
-- Reciclaje y validación por lotes (RF08–RF14, RF29, RF30, RN02–RN06, RN09, RN13)
-- -----------------------------------------------------------------------------
CREATE TABLE lote_validacion (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  punto_id       TEXT        NOT NULL REFERENCES punto_reciclaje(id),
  recolector_id  UUID        NOT NULL REFERENCES usuario(id),
  validados      INTEGER     NOT NULL DEFAULT 0,
  rechazados     INTEGER     NOT NULL DEFAULT 0,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reciclaje (
  id                   UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key      TEXT             NOT NULL UNIQUE,        -- RNF03, RN16
  usuario_id           UUID             NOT NULL REFERENCES usuario(id),
  punto_id             TEXT             NOT NULL REFERENCES punto_reciclaje(id),
  categoria_id         TEXT             NOT NULL REFERENCES categoria_residuo(id),
  categoria_ia         TEXT             NOT NULL REFERENCES categoria_residuo(id),
  confianza_ia         NUMERIC(4,3)     NOT NULL CHECK (confianza_ia BETWEEN 0 AND 1),
  modelo_version       TEXT             NOT NULL,              -- RNF11
  corregido_por_usuario BOOLEAN         NOT NULL DEFAULT false,
  cantidad_reportada   NUMERIC(8,2)     NOT NULL CHECK (cantidad_reportada > 0),
  cantidad_final       NUMERIC(8,2)     CHECK (cantidad_final > 0),
  motivo_cantidad      TEXT,
  -- Tarifa congelada al crear el registro (RN04)
  unidad               TEXT             NOT NULL,
  puntos_por_unidad    NUMERIC(8,2)     NOT NULL,
  categoria_version    INTEGER          NOT NULL,
  puntos_estimados     INTEGER          NOT NULL CHECK (puntos_estimados >= 0),
  estado               estado_reciclaje NOT NULL DEFAULT 'pendiente',
  motivo_revision      TEXT,
  motivo_rechazo       TEXT,
  foto_url             TEXT             NOT NULL,              -- almacenamiento privado (URL firmada)
  foto_hash            CHAR(16)         NOT NULL,              -- huella perceptual (RN05)
  creado_en            TIMESTAMPTZ      NOT NULL DEFAULT now(),
  validado_en          TIMESTAMPTZ,
  validado_por         UUID             REFERENCES usuario(id),
  lote_id              UUID             REFERENCES lote_validacion(id),
  FOREIGN KEY (categoria_id, categoria_version) REFERENCES categoria_version (categoria_id, version),
  CHECK (estado <> 'rechazado' OR motivo_rechazo IS NOT NULL),                                    -- RF13
  CHECK (cantidad_final IS NULL OR cantidad_final = cantidad_reportada OR motivo_cantidad IS NOT NULL) -- RN13
);
CREATE INDEX ix_reciclaje_usuario_fecha ON reciclaje (usuario_id, creado_en DESC);  -- tope diario e historial
CREATE INDEX ix_reciclaje_punto_estado  ON reciclaje (punto_id, estado);            -- pendientes del recolector
CREATE INDEX ix_reciclaje_fecha         ON reciclaje (creado_en);                   -- reportes

-- -----------------------------------------------------------------------------
-- Libro de EcoPoints: movimientos inmutables (RF15, RN07)
-- -----------------------------------------------------------------------------
CREATE TABLE movimiento_puntos (
  id             UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     UUID            NOT NULL REFERENCES usuario(id),
  tipo           tipo_movimiento NOT NULL,
  puntos         INTEGER         NOT NULL CHECK (puntos <> 0),
  referencia_id  TEXT            NOT NULL,
  descripcion    TEXT            NOT NULL,
  creado_en      TIMESTAMPTZ     NOT NULL DEFAULT now()
);
CREATE INDEX ix_movimiento_usuario ON movimiento_puntos (usuario_id, creado_en DESC);
-- Un reciclaje acredita una sola vez
CREATE UNIQUE INDEX ux_movimiento_reciclaje ON movimiento_puntos (referencia_id) WHERE tipo = 'reciclaje';
-- Una devolución por canje ocurre una sola vez (RN15)
CREATE UNIQUE INDEX ux_movimiento_devolucion ON movimiento_puntos (referencia_id) WHERE tipo = 'devolucion';

-- -----------------------------------------------------------------------------
-- Recompensas y canjes (RF17–RF20, RN08, RN15)
-- -----------------------------------------------------------------------------
CREATE TABLE recompensa (
  id                 TEXT            PRIMARY KEY,
  nombre             TEXT            NOT NULL,
  descripcion        TEXT            NOT NULL DEFAULT '',
  costo              INTEGER         NOT NULL,
  stock              INTEGER         NOT NULL CHECK (stock >= 0),
  vigencia_desde     DATE            NOT NULL,
  vigencia_hasta     DATE            NOT NULL,
  responsable        TEXT            NOT NULL,
  procedencia        TEXT            NOT NULL,
  tipo               tipo_recompensa NOT NULL DEFAULT 'beneficio',
  aliado_id          UUID            REFERENCES usuario(id),     -- Fase 2
  activa             BOOLEAN         NOT NULL DEFAULT true,
  sorteo_realizado   BOOLEAN         NOT NULL DEFAULT false,
  emoji              TEXT            NOT NULL DEFAULT '🎁',
  CHECK (vigencia_hasta >= vigencia_desde),
  CHECK (NOT activa OR costo > 0)                                -- RF17
);

CREATE TABLE canje (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key  TEXT         NOT NULL UNIQUE,                -- petición repetida no crea dos canjes
  usuario_id       UUID         NOT NULL REFERENCES usuario(id),
  recompensa_id    TEXT         NOT NULL REFERENCES recompensa(id),
  codigo           TEXT         NOT NULL UNIQUE,                -- código de un solo uso
  costo            INTEGER      NOT NULL CHECK (costo > 0),
  estado           estado_canje NOT NULL DEFAULT 'pendiente',
  creado_en        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  vence_en         TIMESTAMPTZ  NOT NULL,
  entregado_en     TIMESTAMPTZ,
  entregado_por    UUID         REFERENCES usuario(id),
  devuelto         BOOLEAN      NOT NULL DEFAULT false,
  ganador          BOOLEAN,
  CHECK (estado <> 'entregado' OR entregado_en IS NOT NULL)
);
CREATE INDEX ix_canje_usuario ON canje (usuario_id, creado_en DESC);
CREATE INDEX ix_canje_vencimiento ON canje (vence_en) WHERE estado = 'pendiente';

-- -----------------------------------------------------------------------------
-- Notificaciones, alertas antifraude y auditoría (RF23, RF26, RN10, RNF07)
-- -----------------------------------------------------------------------------
CREATE TABLE notificacion (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  UUID        NOT NULL REFERENCES usuario(id),
  titulo      TEXT        NOT NULL,
  mensaje     TEXT        NOT NULL,
  leida       BOOLEAN     NOT NULL DEFAULT false,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_notificacion_usuario ON notificacion (usuario_id, leida, creado_en DESC);

CREATE TABLE alerta_fraude (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  regla         TEXT          NOT NULL,
  evidencia     TEXT          NOT NULL,
  usuario_id    UUID          NOT NULL REFERENCES usuario(id),
  reciclaje_id  UUID          REFERENCES reciclaje(id),
  estado        estado_alerta NOT NULL DEFAULT 'abierta',
  resolucion    TEXT,
  resuelto_por  UUID          REFERENCES usuario(id),
  creado_en     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  resuelto_en   TIMESTAMPTZ,
  CHECK (estado = 'abierta' OR resolucion IS NOT NULL)
);

CREATE TABLE auditoria (
  id          BIGSERIAL   PRIMARY KEY,
  actor_id    UUID        REFERENCES usuario(id),               -- NULL = sistema
  accion      TEXT        NOT NULL,
  entidad     TEXT        NOT NULL,
  entidad_id  TEXT        NOT NULL,
  detalle     TEXT        NOT NULL DEFAULT '',
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_auditoria_entidad ON auditoria (entidad, creado_en DESC);

-- -----------------------------------------------------------------------------
-- Inmutabilidad: el libro de puntos y la auditoría no se editan ni se borran
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_impedir_cambios() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es inmutable: usa un ajuste o un nuevo registro', TG_TABLE_NAME;
END $$;

CREATE TRIGGER tg_movimiento_inmutable BEFORE UPDATE OR DELETE ON movimiento_puntos
  FOR EACH ROW EXECUTE FUNCTION fn_impedir_cambios();
CREATE TRIGGER tg_auditoria_inmutable BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION fn_impedir_cambios();
CREATE TRIGGER tg_categoria_version_inmutable BEFORE UPDATE OR DELETE ON categoria_version
  FOR EACH ROW EXECUTE FUNCTION fn_impedir_cambios();

-- Un reciclaje validado o rechazado es final
CREATE FUNCTION fn_reciclaje_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado IN ('validado', 'rechazado') THEN
    RAISE EXCEPTION 'El reciclaje % ya tiene un estado final (%)', OLD.id, OLD.estado;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_reciclaje_final BEFORE UPDATE ON reciclaje
  FOR EACH ROW EXECUTE FUNCTION fn_reciclaje_final();

-- Al versionar una categoría se guarda la versión nueva automáticamente
CREATE FUNCTION fn_versionar_categoria() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (NEW.unidad, NEW.puntos_por_unidad, NEW.minimo, NEW.maximo)
                     IS DISTINCT FROM (OLD.unidad, OLD.puntos_por_unidad, OLD.minimo, OLD.maximo) THEN
    IF TG_OP = 'UPDATE' THEN NEW.version := OLD.version + 1; END IF;
    INSERT INTO categoria_version (categoria_id, version, unidad, puntos_por_unidad, minimo, maximo)
    VALUES (NEW.id, NEW.version, NEW.unidad, NEW.puntos_por_unidad, NEW.minimo, NEW.maximo);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_versionar_categoria_ins AFTER INSERT ON categoria_residuo
  FOR EACH ROW EXECUTE FUNCTION fn_versionar_categoria();
CREATE TRIGGER tg_versionar_categoria_upd BEFORE UPDATE ON categoria_residuo
  FOR EACH ROW EXECUTE FUNCTION fn_versionar_categoria();

-- -----------------------------------------------------------------------------
-- Vistas de consulta
-- -----------------------------------------------------------------------------
-- RF03/RF15: el saldo es la suma del libro; pendientes = estimados aún no validados
CREATE VIEW v_saldo_usuario AS
SELECT u.id AS usuario_id,
       u.nombre,
       COALESCE((SELECT SUM(m.puntos) FROM movimiento_puntos m WHERE m.usuario_id = u.id), 0) AS saldo_confirmado,
       COALESCE((SELECT SUM(r.puntos_estimados) FROM reciclaje r
                 WHERE r.usuario_id = u.id AND r.estado IN ('pendiente', 'en_revision')), 0) AS puntos_pendientes
FROM usuario u;

-- RF07/RF21: EcoRanking del mes (solo puntos ganados por reciclaje)
CREATE VIEW v_ecoranking_mes AS
SELECT u.id AS usuario_id,
       CASE WHEN u.ranking_anonimo THEN 'Reciclador anónimo' ELSE u.nombre END AS nombre_publico,
       u.facultad,
       SUM(m.puntos) AS puntos,
       COUNT(*)      AS reciclajes,
       RANK() OVER (ORDER BY SUM(m.puntos) DESC, COUNT(*) DESC) AS posicion
FROM movimiento_puntos m
JOIN usuario u ON u.id = m.usuario_id
WHERE m.tipo = 'reciclaje' AND m.creado_en >= now() - INTERVAL '30 days' AND NOT u.bloqueado
GROUP BY u.id;

-- Reporte 02: material recuperado por categoría
CREATE VIEW v_material_por_categoria AS
SELECT c.nombre AS categoria,
       c.unidad,
       COUNT(r.id)                                              AS registros,
       COUNT(r.id) FILTER (WHERE r.estado = 'validado')         AS validados,
       COALESCE(SUM(r.cantidad_final) FILTER (WHERE r.estado = 'validado'), 0) AS cantidad_validada,
       COALESCE(SUM(r.puntos_estimados) FILTER (WHERE r.estado = 'validado'), 0) AS ecopoints
FROM categoria_residuo c
LEFT JOIN reciclaje r ON r.categoria_id = c.id
GROUP BY c.id;

COMMIT;
