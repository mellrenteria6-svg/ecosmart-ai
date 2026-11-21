# EcoSmart AI

Plataforma web de reciclaje inteligente para campus universitarios. El estudiante escanea el QR de un punto de reciclaje, fotografía el residuo, una IA lo clasifica y, cuando el recolector valida el lote, recibe **EcoPoints** que puede canjear por recompensas.

Proyecto de **Diseño de Sistemas / Ingeniería de Software II** (noviembre de 2026), basado en la *Especificación de requisitos y matriz de trazabilidad v1.0*.

**Equipo:** Pablo Andrés Perea Bohorquez · Mell Eunice Rentería Alcivar · César Emilio Regalado Sandoval

## Qué incluye (Fase 1)

| Rol | Funciones |
|---|---|
| Usuario | Registro con correo universitario, reciclaje con QR + foto + IA, saldo e historial, recompensas y canjes, EcoRanking, impacto ambiental, insignias, eliminar cuenta |
| Recolector | Puntos asignados, validación por lotes, revisión individual, corrección de cantidades con motivo |
| Aliado | Resumen de sus canjes, publicar sus recompensas, validar y entregar solo sus códigos |
| Administrador | Dashboard, puntos y QR imprimibles, asignaciones, categorías versionadas, recompensas, entrega de canjes, usuarios, universidades, 8 reportes (CSV/PDF), alertas antifraude, auditoría |

- **IA:** CLIP ViT-B/32 cuantizado que corre en el navegador (Web Worker), con clasificación *zero-shot* en 6 categorías.
- **Varias universidades:** DEMO, ESPOL, ECOTEC, UCSG y UEES, cada una con sus dominios de correo.
- **Sin conexión:** los reciclajes se guardan en una cola local y se sincronizan al volver la red.
- **Avisos push:** el usuario puede activar notificaciones del navegador; si no da permiso, los avisos siguen en la app.
- **Privacidad:** fotos visibles solo para el recolector y la administración, borradas a los 90 días; eliminación de cuenta con anonimización.

## Tecnologías

React 19 · TypeScript · Vite · Node.js + Express · PostgreSQL 18 · Transformers.js (CLIP) · Vitest

## Ejecutar

Requisitos: Node.js 24 y, para el modo con base de datos, PostgreSQL 18.

```bash
npm install
```

**Modo demostración** (los datos viven en el navegador, sin servidor):

```bash
npm run dev
```

**Modo base de datos** (PostgreSQL):

```bash
powershell -ExecutionPolicy Bypass -File db\instalar.ps1      # crea la base "ecosmart"
powershell -ExecutionPolicy Bypass -File server\configurar.ps1 # guarda la clave en server/.env
npm run servidor:dev                                           # API en http://localhost:3001/api
npm run dev:bd                                                 # página en http://localhost:5173
```

En Windows, si PowerShell bloquea `npm`, usa `npm.cmd`.

Cuentas de demostración (contraseña `EcoSmart2026`): `estudiante@universidad.edu.ec`, `recolector@universidad.edu.ec`, `admin@universidad.edu.ec` y `aliado@universidad.edu.ec`. El administrador y el aliado usan segundo factor: el código aparece en la *Bandeja de correo simulada* (`/#/correo`).

## Pruebas

```bash
npm test            # 56 pruebas: reglas de negocio, base de datos y API
npm run verificar   # lint + tipos + pruebas + construcción
```

Las pruebas de integración usan PostgreSQL en memoria (PGlite) y no tocan la base real. GitHub Actions ejecuta la verificación completa en cada cambio.

## Estructura

```
src/data/       Modelo, reglas de negocio (store.ts), reportes y pruebas unitarias
src/pages/      Pantallas por rol
src/lib/        IA (CLIP), imágenes, enrutador y formato
server/         API Express sobre PostgreSQL, autenticación y pruebas de integración
db/             Esquema, datos iniciales, migraciones e instalador
```

Más detalles de la base de datos en [db/README.md](db/README.md).

Verificación de accesibilidad WCAG 2.2 AA y responsive: [docs/accesibilidad-y-responsive.md](docs/accesibilidad-y-responsive.md).
