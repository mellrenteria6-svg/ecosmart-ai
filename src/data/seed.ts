import type { CategoriaResiduo, Db, Institucion, Reciclaje, MovimientoPuntos } from './types'

// Datos de demostración. Contraseña de todas las cuentas demo: EcoSmart2026
export const DEMO_PASSWORD = 'EcoSmart2026'
export const DEMO_CUENTAS = [
  { correo: 'estudiante@universidad.edu.ec', rol: 'Usuario' },
  { correo: 'recolector@universidad.edu.ec', rol: 'Recolector' },
  { correo: 'admin@universidad.edu.ec', rol: 'Administrador' },
  { correo: 'aliado@universidad.edu.ec', rol: 'Aliado' },
]

const DIA = 24 * 60 * 60 * 1000

function hoyMas(dias: number) {
  const d = new Date(Date.now() + dias * DIA)
  return d.toISOString().slice(0, 10)
}

export function fotoPlaceholder(texto: string, color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="${color}"/><circle cx="160" cy="110" r="52" fill="rgba(255,255,255,.35)"/><text x="160" y="200" font-family="sans-serif" font-size="22" font-weight="700" fill="#fff" text-anchor="middle">${texto}</text></svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

export const CATEGORIAS_SEMILLA: CategoriaResiduo[] = [
  { id: 'cat-pet', nombre: 'Plástico PET', descripcion: 'Botellas de bebidas: agua, gaseosa, jugo', unidad: 'botella', puntosPorUnidad: 10, minimo: 1, maximo: 20, version: 1, color: '#2f80c0', activa: true, impacto: { co2Kg: 0.08, aguaL: 3.2, energiaKwh: 0.21 } },
  { id: 'cat-papel', nombre: 'Papel y cartón', descripcion: 'Cajas, hojas, periódicos y cartón aplanado', unidad: 'kg', puntosPorUnidad: 15, minimo: 0.5, maximo: 5, version: 1, color: '#a27a4b', activa: true, impacto: { co2Kg: 0.9, aguaL: 26, energiaKwh: 4.1 } },
  { id: 'cat-vidrio', nombre: 'Vidrio', descripcion: 'Botellas y frascos de vidrio', unidad: 'envase', puntosPorUnidad: 8, minimo: 1, maximo: 10, version: 1, color: '#2e9a7a', activa: true, impacto: { co2Kg: 0.12, aguaL: 1.1, energiaKwh: 0.17 } },
  { id: 'cat-lata', nombre: 'Latas de aluminio', descripcion: 'Latas de bebidas de aluminio', unidad: 'lata', puntosPorUnidad: 12, minimo: 1, maximo: 20, version: 1, color: '#7b7f8c', activa: true, impacto: { co2Kg: 0.15, aguaL: 0.9, energiaKwh: 0.42 } },
  { id: 'cat-tetra', nombre: 'Tetra Pak', descripcion: 'Cartones de leche y jugo', unidad: 'envase', puntosPorUnidad: 6, minimo: 1, maximo: 15, version: 1, color: '#c9862e', activa: true, impacto: { co2Kg: 0.05, aguaL: 1.6, energiaKwh: 0.09 } },
  { id: 'cat-plastico', nombre: 'Otros plásticos', descripcion: 'Tarrinas, vasos, envases de comida, tapas y frascos de limpieza (no bolsas)', unidad: 'envase', puntosPorUnidad: 5, minimo: 1, maximo: 15, version: 1, color: '#8e5bb5', activa: true, impacto: { co2Kg: 0.06, aguaL: 2.1, energiaKwh: 0.16 } },
]

// Dominios de ejemplo: confirmar con cada universidad antes del piloto.
export const INSTITUCIONES_SEMILLA: Institucion[] = [
  { id: 'inst-demo', nombre: 'Universidad Demo', siglas: 'DEMO', dominios: ['universidad.edu.ec'], activa: true },
  { id: 'inst-espol', nombre: 'Escuela Superior Politécnica del Litoral', siglas: 'ESPOL', dominios: ['espol.edu.ec'], activa: true },
  { id: 'inst-ecotec', nombre: 'Universidad Tecnológica ECOTEC', siglas: 'ECOTEC', dominios: ['ecotec.edu.ec', 'est.ecotec.edu.ec'], activa: true },
  { id: 'inst-ucsg', nombre: 'Universidad Católica de Santiago de Guayaquil', siglas: 'UCSG', dominios: ['ucsg.edu.ec', 'cu.ucsg.edu.ec'], activa: true },
  { id: 'inst-uees', nombre: 'Universidad Espíritu Santo', siglas: 'UEES', dominios: ['uees.edu.ec'], activa: true },
]

export function crearDbSemilla(): Db {
  const ahora = Date.now()
  const cat = (id: string) => CATEGORIAS_SEMILLA.find((c) => c.id === id)!

  const reciclajeBase = (
    id: string,
    catId: string,
    cantidad: number,
    puntoId: string,
    diasAtras: number,
    estado: Reciclaje['estado'],
    extra: Partial<Reciclaje> = {},
  ): Reciclaje => {
    const c = cat(catId)
    return {
      id,
      idempotencyKey: 'seed-' + id,
      usuarioId: 'u-estudiante',
      puntoId,
      categoriaId: catId,
      categoriaIa: catId,
      confianzaIa: 0.91,
      modeloVersion: 'eco-clf-1.0-sim',
      corregidoPorUsuario: false,
      cantidadReportada: cantidad,
      unidad: c.unidad,
      puntosPorUnidad: c.puntosPorUnidad,
      categoriaVersion: c.version,
      puntosEstimados: Math.round(cantidad * c.puntosPorUnidad),
      estado,
      foto: fotoPlaceholder(c.nombre, c.color),
      fotoHash: 'seed' + id.padEnd(12, '0'),
      creadoEn: ahora - diasAtras * DIA,
      ...extra,
    }
  }

  const reciclajes: Reciclaje[] = [
    reciclajeBase('r-001', 'cat-pet', 4, 'p-biblioteca', 6, 'validado', { cantidadFinal: 4, validadoEn: ahora - 5 * DIA, validadoPor: 'u-recolector', loteId: 'l-001' }),
    reciclajeBase('r-002', 'cat-papel', 2, 'p-biblioteca', 4, 'validado', { cantidadFinal: 2, validadoEn: ahora - 3 * DIA, validadoPor: 'u-recolector', loteId: 'l-002' }),
    reciclajeBase('r-003', 'cat-lata', 3, 'p-cafeteria', 3, 'rechazado', { motivoRechazo: 'Las latas contenían líquido.', validadoEn: ahora - 2 * DIA, validadoPor: 'u-recolector', loteId: 'l-003' }),
    reciclajeBase('r-004', 'cat-pet', 6, 'p-biblioteca', 0.2, 'pendiente'),
    reciclajeBase('r-005', 'cat-vidrio', 2, 'p-biblioteca', 0.1, 'en_revision', {
      categoriaIa: 'cat-pet',
      confianzaIa: 0.58,
      corregidoPorUsuario: true,
      motivoRevision: 'Categoría corregida por el usuario y confianza baja.',
    }),
    {
      ...reciclajeBase('r-006', 'cat-tetra', 5, 'p-ingenieria', 0.3, 'pendiente'),
      usuarioId: 'u-diego',
      idempotencyKey: 'seed-r-006',
    },
  ]

  const movimientos: MovimientoPuntos[] = [
    { id: 'm-001', usuarioId: 'u-estudiante', tipo: 'reciclaje', puntos: 40, referenciaId: 'r-001', descripcion: 'Reciclaje validado: 4 botella de Plástico PET', creadoEn: ahora - 5 * DIA },
    { id: 'm-002', usuarioId: 'u-estudiante', tipo: 'reciclaje', puntos: 30, referenciaId: 'r-002', descripcion: 'Reciclaje validado: 2 kg de Papel y cartón', creadoEn: ahora - 3 * DIA },
    { id: 'm-003', usuarioId: 'u-estudiante', tipo: 'ajuste', puntos: 50, referenciaId: 'bono-bienvenida', descripcion: 'Ajuste: bono de bienvenida del piloto', creadoEn: ahora - 7 * DIA },
    { id: 'm-005', usuarioId: 'u-andrea', tipo: 'reciclaje', puntos: 180, referenciaId: 'hist-a1', descripcion: 'Reciclaje validado: 12 lata de Latas de aluminio', creadoEn: ahora - 4 * DIA },
    { id: 'm-006', usuarioId: 'u-andrea', tipo: 'reciclaje', puntos: 45, referenciaId: 'hist-a2', descripcion: 'Reciclaje validado: 3 kg de Papel y cartón', creadoEn: ahora - 12 * DIA },
    { id: 'm-007', usuarioId: 'u-jorge', tipo: 'reciclaje', puntos: 90, referenciaId: 'hist-j1', descripcion: 'Reciclaje validado: 9 botella de Plástico PET', creadoEn: ahora - 2 * DIA },
    { id: 'm-008', usuarioId: 'u-diego', tipo: 'reciclaje', puntos: 60, referenciaId: 'hist-d1', descripcion: 'Reciclaje validado: 10 envase de Tetra Pak', creadoEn: ahora - 9 * DIA },
    { id: 'm-004', usuarioId: 'u-diego', tipo: 'ajuste', puntos: 50, referenciaId: 'bono-bienvenida', descripcion: 'Ajuste: bono de bienvenida del piloto', creadoEn: ahora - 7 * DIA },
  ]

  return {
    version: 2,
    config: {
      topeDiario: 10,
      umbralConfianza: 0.7,
      horasVencimientoCanje: 72,
      diasRetencionFotos: 90,
      modeloVersion: 'clip-vit-b32-q8-zs-1.0',
      factorImpactoVersion: 'FI-2026.1',
    },
    instituciones: INSTITUCIONES_SEMILLA.map((i) => ({ ...i, dominios: [...i.dominios] })),
    usuarios: [
      { id: 'u-estudiante', nombre: 'Valeria Gómez', correo: 'estudiante@universidad.edu.ec', institucionId: 'inst-demo', facultad: 'Ingeniería', rol: 'usuario', passwordHash: 'd303431fc6d7cafecba57c9441ea8520a14779be1b12989a497b63f5a390d248', verificado: true, bloqueado: false, intentosFallidos: 0, sesionVersion: 1, creadoEn: ahora - 30 * DIA, consentimientoPrivacidad: true },
      { id: 'u-diego', nombre: 'Diego Paredes', correo: 'diego.paredes@universidad.edu.ec', institucionId: 'inst-demo', facultad: 'Ciencias Económicas', rol: 'usuario', passwordHash: '4d3fd7a2047a93b69a0b68af92da2760e16d047a1d43b3a13aa16995960894e2', verificado: true, bloqueado: false, intentosFallidos: 0, sesionVersion: 1, creadoEn: ahora - 20 * DIA, consentimientoPrivacidad: true },
      { id: 'u-recolector', nombre: 'Carlos Mendoza', correo: 'recolector@universidad.edu.ec', institucionId: 'inst-demo', facultad: 'Servicios Generales', rol: 'recolector', passwordHash: 'f196ca5d520c2f5fe11b551855b1b05b218cfd8c7c17974ce294ae471c0a75d5', verificado: true, bloqueado: false, intentosFallidos: 0, sesionVersion: 1, creadoEn: ahora - 60 * DIA, consentimientoPrivacidad: true },
      { id: 'u-rosa', nombre: 'Rosa Vera', correo: 'rosa.vera@universidad.edu.ec', institucionId: 'inst-demo', facultad: 'Servicios Generales', rol: 'recolector', passwordHash: '0e92cb90ed3bf024c2a9fbab2dba28c27f8ede1ef0a2d196022aa11613234f71', verificado: true, bloqueado: false, intentosFallidos: 0, sesionVersion: 1, creadoEn: ahora - 60 * DIA, consentimientoPrivacidad: true },
      { id: 'u-andrea', nombre: 'Andrea Salazar', correo: 'andrea.salazar@universidad.edu.ec', institucionId: 'inst-demo', facultad: 'Ciencias de la Salud', rol: 'usuario', passwordHash: 'd488cf0ccff2ba39cabd3095ca0829def1732dceedafa07c6152bc6886c75641', verificado: true, bloqueado: false, intentosFallidos: 0, sesionVersion: 1, creadoEn: ahora - 25 * DIA, consentimientoPrivacidad: true },
      { id: 'u-jorge', nombre: 'Jorge Mora', correo: 'jorge.mora@universidad.edu.ec', institucionId: 'inst-demo', facultad: 'Ingeniería', rol: 'usuario', passwordHash: '192e94c4f02c4f1f4a601b91fcf2129d65a3253761d9bc3065a4990a40e3c274', verificado: true, bloqueado: false, intentosFallidos: 0, sesionVersion: 1, creadoEn: ahora - 18 * DIA, consentimientoPrivacidad: true, rankingAnonimo: true },
      { id: 'u-aliado', nombre: 'Cafetería El Roble', correo: 'aliado@universidad.edu.ec', institucionId: 'inst-demo', facultad: 'Aliado del campus', rol: 'aliado', passwordHash: '51422b7f8f9bfb04a2177113f766d49f4124efa82dcd52eb7a0d139206093fb5', verificado: true, bloqueado: false, intentosFallidos: 0, sesionVersion: 1, creadoEn: ahora - 40 * DIA, consentimientoPrivacidad: true },
      { id: 'u-admin', nombre: 'Laura Ríos', correo: 'admin@universidad.edu.ec', institucionId: 'inst-demo', facultad: 'Gestión Ambiental', rol: 'admin', passwordHash: '8a4de7fba71259029a7a945c829e795b3ab6c64f7da2dcbb466e3e4a6a494363', verificado: true, bloqueado: false, intentosFallidos: 0, sesionVersion: 1, creadoEn: ahora - 90 * DIA, consentimientoPrivacidad: true },
    ],
    puntos: [
      { id: 'p-biblioteca', nombre: 'Biblioteca central', ubicacion: 'Planta baja, junto al ingreso principal', codigoQr: 'ECO-BIB-01', categorias: ['cat-pet', 'cat-plastico', 'cat-papel', 'cat-vidrio', 'cat-tetra'], estado: 'activo', visible: true, mapa: { x: 28, y: 34 } },
      { id: 'p-cafeteria', nombre: 'Cafetería principal', ubicacion: 'Patio de comidas, lado norte', codigoQr: 'ECO-CAF-02', categorias: ['cat-pet', 'cat-plastico', 'cat-lata', 'cat-tetra', 'cat-vidrio'], estado: 'activo', visible: true, mapa: { x: 62, y: 28 } },
      { id: 'p-ingenieria', nombre: 'Facultad de Ingeniería', ubicacion: 'Bloque B, pasillo de laboratorios', codigoQr: 'ECO-ING-03', categorias: ['cat-pet', 'cat-plastico', 'cat-papel', 'cat-lata'], estado: 'activo', visible: true, mapa: { x: 74, y: 66 } },
      { id: 'p-deportes', nombre: 'Complejo deportivo', ubicacion: 'Entrada del coliseo', codigoQr: 'ECO-DEP-04', categorias: ['cat-pet', 'cat-lata'], estado: 'mantenimiento', visible: true, mapa: { x: 22, y: 74 } },
    ],
    categorias: CATEGORIAS_SEMILLA.map((c) => ({ ...c })),
    historialCategorias: CATEGORIAS_SEMILLA.map((c) => ({ ...c })),
    reciclajes,
    movimientos,
    asignaciones: [
      { id: 'a-001', recolectorId: 'u-recolector', puntoId: 'p-biblioteca', desde: hoyMas(-30), hasta: hoyMas(60), horario: 'Lun a Vie, 08:00 a 16:00', activa: true },
      { id: 'a-002', recolectorId: 'u-recolector', puntoId: 'p-cafeteria', desde: hoyMas(-30), hasta: hoyMas(60), horario: 'Lun a Vie, 10:00 a 18:00', activa: true },
      { id: 'a-003', recolectorId: 'u-rosa', puntoId: 'p-ingenieria', desde: hoyMas(-10), hasta: hoyMas(80), horario: 'Lun a Sáb, 07:00 a 13:00', activa: true },
    ],
    lotes: [],
    recompensas: [
      { id: 'rw-cafe', nombre: 'Café americano', descripcion: 'Un café americano en la cafetería principal.', costo: 60, stock: 25, vigenciaDesde: hoyMas(-30), vigenciaHasta: hoyMas(90), responsable: 'Cafetería El Roble', activa: true, emoji: '☕', procedencia: 'Aliado: Cafetería El Roble', tipo: 'beneficio', aliadoId: 'u-aliado' },
      { id: 'rw-termo', nombre: 'Termo reutilizable', descripcion: 'Termo de acero con el logo del campus.', costo: 250, stock: 8, vigenciaDesde: hoyMas(-30), vigenciaHasta: hoyMas(120), responsable: 'Administración', activa: true, emoji: '🧴', procedencia: 'Gestión Ambiental del campus', tipo: 'beneficio' },
      { id: 'rw-impresion', nombre: '20 impresiones', descripcion: 'Crédito de 20 impresiones en la biblioteca.', costo: 90, stock: 40, vigenciaDesde: hoyMas(-30), vigenciaHasta: hoyMas(60), responsable: 'Administración', activa: true, emoji: '🖨️', procedencia: 'Biblioteca central', tipo: 'beneficio' },
      { id: 'rw-bolsa', nombre: 'Bolsa de tela', descripcion: 'Bolsa reutilizable de algodón.', costo: 120, stock: 0, vigenciaDesde: hoyMas(-30), vigenciaHasta: hoyMas(60), responsable: 'Administración', activa: true, emoji: '👜', procedencia: 'Gestión Ambiental del campus', tipo: 'beneficio' },
      { id: 'rw-sorteo', nombre: 'Sorteo: bicicleta urbana', descripcion: 'Cada boleto es una participación. El sorteo se realiza al cerrar la campaña.', costo: 40, stock: 200, vigenciaDesde: hoyMas(-10), vigenciaHasta: hoyMas(20), responsable: 'Administración', activa: true, emoji: '🚲', procedencia: 'Campaña interna de reciclaje', tipo: 'sorteo' },
      { id: 'rw-arbol', nombre: 'Donar: siembra de un árbol', descripcion: 'Tus EcoPoints financian la siembra de un árbol nativo en el campus.', costo: 50, stock: 500, vigenciaDesde: hoyMas(-30), vigenciaHasta: hoyMas(180), responsable: 'Club de Ecología', activa: true, emoji: '🌳', procedencia: 'Proyecto ambiental del Club de Ecología', tipo: 'donacion' },
    ],
    canjes: [],
    notificaciones: [
      { id: 'n-001', usuarioId: 'u-estudiante', titulo: 'Reciclaje validado', mensaje: 'Tu reciclaje de Papel y cartón sumó 30 EcoPoints.', leida: false, creadoEn: ahora - 3 * DIA },
      { id: 'n-002', usuarioId: 'u-estudiante', titulo: 'Reciclaje rechazado', mensaje: 'Motivo: Las latas contenían líquido.', leida: true, creadoEn: ahora - 2 * DIA },
    ],
    auditoria: [
      { id: 'au-001', actorId: 'u-admin', actorNombre: 'Laura Ríos', accion: 'Crear configuración inicial', entidad: 'CONFIGURACION', entidadId: 'config', detalle: 'Tope diario 10, umbral 70 %, vencimiento 72 h.', creadoEn: ahora - 90 * DIA },
    ],
    correos: [],
    tokens: [],
    alertas: [
      { id: 'al-001', regla: 'Ráfaga de registros', evidencia: '3 registros en menos de 10 minutos en Biblioteca central.', usuarioId: 'u-diego', estado: 'abierta', creadoEn: ahora - 1 * DIA },
    ],
  }
}
