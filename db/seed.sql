-- =============================================================================
-- EcoSmart AI — Datos iniciales de demostración
-- Contraseña de todas las cuentas: EcoSmart2026 (guardada con bcrypt)
-- =============================================================================

-- Los archivos están en UTF-8 (tildes y ñ); evita errores con la consola de Windows
SET client_encoding = 'UTF8';

BEGIN;

INSERT INTO campus (id, nombre, dominio_institucional) VALUES
  (1, 'Campus principal', 'universidad.edu.ec');

INSERT INTO configuracion (campus_id, modelo_version, factor_impacto_version) VALUES
  (1, 'clip-vit-b32-q8-zs-1.0', 'FI-2026.1');

INSERT INTO usuario (id, campus_id, nombre, correo, facultad, rol, password_hash, verificado, consentimiento_privacidad) VALUES
  ('00000000-0000-0000-0000-000000000001', 1, 'Valeria Gómez',  'estudiante@universidad.edu.ec', 'Ingeniería',          'usuario',    crypt('EcoSmart2026', gen_salt('bf')), true, true),
  ('00000000-0000-0000-0000-000000000002', 1, 'Diego Paredes',  'diego.paredes@universidad.edu.ec', 'Ciencias Económicas', 'usuario', crypt('EcoSmart2026', gen_salt('bf')), true, true),
  ('00000000-0000-0000-0000-000000000003', 1, 'Carlos Mendoza', 'recolector@universidad.edu.ec', 'Servicios Generales', 'recolector', crypt('EcoSmart2026', gen_salt('bf')), true, true),
  ('00000000-0000-0000-0000-000000000004', 1, 'Rosa Vera',      'rosa.vera@universidad.edu.ec',  'Servicios Generales', 'recolector', crypt('EcoSmart2026', gen_salt('bf')), true, true),
  ('00000000-0000-0000-0000-000000000005', 1, 'Laura Ríos',     'admin@universidad.edu.ec',      'Gestión Ambiental',   'admin',      crypt('EcoSmart2026', gen_salt('bf')), true, true);

INSERT INTO categoria_residuo (id, nombre, descripcion, unidad, puntos_por_unidad, minimo, maximo, color, co2_kg_por_unidad, agua_l_por_unidad, energia_kwh_por_unidad) VALUES
  ('cat-pet',      'Plástico PET',      'Botellas de bebidas: agua, gaseosa, jugo',                                   'botella', 10, 1,   20, '#2f80c0', 0.08, 3.2, 0.21),
  ('cat-plastico', 'Otros plásticos',   'Tarrinas, vasos, envases de comida, tapas y frascos de limpieza (no bolsas)', 'envase',   5, 1,   15, '#8e5bb5', 0.06, 2.1, 0.16),
  ('cat-papel',    'Papel y cartón',    'Cajas, hojas, periódicos y cartón aplanado',                                 'kg',      15, 0.5,  5, '#a27a4b', 0.9,  26,  4.1),
  ('cat-vidrio',   'Vidrio',            'Botellas y frascos de vidrio',                                               'envase',   8, 1,   10, '#2e9a7a', 0.12, 1.1, 0.17),
  ('cat-lata',     'Latas de aluminio', 'Latas de bebidas de aluminio',                                               'lata',    12, 1,   20, '#7b7f8c', 0.15, 0.9, 0.42),
  ('cat-tetra',    'Tetra Pak',         'Cartones de leche y jugo',                                                   'envase',   6, 1,   15, '#c9862e', 0.05, 1.6, 0.09);

INSERT INTO punto_reciclaje (id, campus_id, nombre, ubicacion, codigo_qr, estado, mapa_x, mapa_y) VALUES
  ('p-biblioteca', 1, 'Biblioteca central',     'Planta baja, junto al ingreso principal', 'ECO-BIB-01', 'activo',        28, 34),
  ('p-cafeteria',  1, 'Cafetería principal',    'Patio de comidas, lado norte',            'ECO-CAF-02', 'activo',        62, 28),
  ('p-ingenieria', 1, 'Facultad de Ingeniería', 'Bloque B, pasillo de laboratorios',       'ECO-ING-03', 'activo',        74, 66),
  ('p-deportes',   1, 'Complejo deportivo',     'Entrada del coliseo',                     'ECO-DEP-04', 'mantenimiento', 22, 74);

INSERT INTO punto_categoria (punto_id, categoria_id) VALUES
  ('p-biblioteca', 'cat-pet'), ('p-biblioteca', 'cat-plastico'), ('p-biblioteca', 'cat-papel'), ('p-biblioteca', 'cat-vidrio'), ('p-biblioteca', 'cat-tetra'),
  ('p-cafeteria',  'cat-pet'), ('p-cafeteria',  'cat-plastico'), ('p-cafeteria',  'cat-lata'),  ('p-cafeteria',  'cat-tetra'),  ('p-cafeteria',  'cat-vidrio'),
  ('p-ingenieria', 'cat-pet'), ('p-ingenieria', 'cat-plastico'), ('p-ingenieria', 'cat-papel'), ('p-ingenieria', 'cat-lata'),
  ('p-deportes',   'cat-pet'), ('p-deportes',   'cat-lata');

INSERT INTO asignacion_recolector (recolector_id, punto_id, desde, hasta, horario) VALUES
  ('00000000-0000-0000-0000-000000000003', 'p-biblioteca', CURRENT_DATE - 30, CURRENT_DATE + 60, 'Lun a Vie, 08:00 a 16:00'),
  ('00000000-0000-0000-0000-000000000003', 'p-cafeteria',  CURRENT_DATE - 30, CURRENT_DATE + 60, 'Lun a Vie, 10:00 a 18:00'),
  ('00000000-0000-0000-0000-000000000004', 'p-ingenieria', CURRENT_DATE - 10, CURRENT_DATE + 80, 'Lun a Sáb, 07:00 a 13:00');

INSERT INTO recompensa (id, nombre, descripcion, costo, stock, vigencia_desde, vigencia_hasta, responsable, procedencia, tipo, emoji) VALUES
  ('rw-cafe',      'Café americano',            'Un café americano en la cafetería principal.',          60,  25, CURRENT_DATE - 30, CURRENT_DATE + 90,  'Cafetería El Roble', 'Aliado: Cafetería El Roble',              'beneficio', '☕'),
  ('rw-termo',     'Termo reutilizable',        'Termo de acero con el logo del campus.',               250,   8, CURRENT_DATE - 30, CURRENT_DATE + 120, 'Administración',     'Gestión Ambiental del campus',            'beneficio', '🧴'),
  ('rw-impresion', '20 impresiones',            'Crédito de 20 impresiones en la biblioteca.',           90,  40, CURRENT_DATE - 30, CURRENT_DATE + 60,  'Administración',     'Biblioteca central',                      'beneficio', '🖨️'),
  ('rw-sorteo',    'Sorteo: bicicleta urbana',  'Cada boleto es una participación.',                     40, 200, CURRENT_DATE - 10, CURRENT_DATE + 20,  'Administración',     'Campaña interna de reciclaje',            'sorteo',    '🚲'),
  ('rw-arbol',     'Donar: siembra de un árbol','Tus EcoPoints financian la siembra de un árbol nativo.', 50, 500, CURRENT_DATE - 30, CURRENT_DATE + 180, 'Club de Ecología',   'Proyecto ambiental del Club de Ecología', 'donacion',  '🌳');

-- Bono de bienvenida: ejemplo de movimiento de tipo ajuste
INSERT INTO movimiento_puntos (usuario_id, tipo, puntos, referencia_id, descripcion) VALUES
  ('00000000-0000-0000-0000-000000000001', 'ajuste', 50, 'bono-bienvenida', 'Ajuste: bono de bienvenida del piloto'),
  ('00000000-0000-0000-0000-000000000002', 'ajuste', 50, 'bono-bienvenida', 'Ajuste: bono de bienvenida del piloto');

INSERT INTO auditoria (actor_id, accion, entidad, entidad_id, detalle) VALUES
  ('00000000-0000-0000-0000-000000000005', 'Crear configuración inicial', 'CONFIGURACION', '1', 'Tope diario 10, umbral 70 %, vencimiento 72 h.');

COMMIT;
