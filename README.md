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
- **Varias universidades:** DEMO, ESPOL, ECOTEC, UCSG y UEES, cada una con sus dominios de correo. Cualquier otro correo se registra en el grupo **Invitados** (también debe verificarse); si la administración lo desactiva, solo se aceptan correos universitarios.
- **Sin conexión:** los reciclajes se guardan en una cola local y se sincronizan al volver la red.
- **Avisos push:** el usuario puede activar notificaciones del navegador; si no da permiso, los avisos siguen en la app.
- **Privacidad:** fotos visibles solo para su titular, el recolector asignado y la administración, borradas a los 90 días; eliminación de cuenta con anonimización.
- **Capacidad y seguridad:** probado con 5009 cuentas y 100 usuarios simultáneos (0 % de errores, p95 < 1 s); fotos validadas en el servidor, cabeceras de seguridad, respaldos verificables y monitoreo de disponibilidad.

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

En Windows, si PowerShell bloquea `npm`, usa `npm.cmd`. También puedes dar doble clic a **`Iniciar EcoSmart.cmd`**: prende el servidor y la página y abre el navegador.

**Correos reales** (verificación, código de acceso y recuperación de contraseña): sin configurar, llegan a la bandeja simulada. Para enviarlos de verdad desde Gmail (con [contraseña de aplicación](https://myaccount.google.com/apppasswords)) o desde [Brevo](https://www.brevo.com) (gratis, 300 al día, sin contraseña de aplicación):

```bash
powershell -ExecutionPolicy Bypass -File server\configurar-correo.ps1
npm run db:migrar
```

`/api/salud` muestra `"correoReal": true` cuando está activo, y la página deja de mostrar la bandeja simulada. Las cuentas de demostración (`@universidad.edu.ec`) no tienen buzón propio: sus correos llegan al buzón del proyecto (el remitente, o `CORREO_DEMO_DESTINO`) con el asunto `[Demo: cuenta]`. Cada correo guarda si salió, los intentos y el último error.

**Administrador principal** (modo base de datos): crea tu cuenta con una contraseña al azar que se guarda en `%USERPROFILE%\EcoSmart-privadodministrador.txt`, fuera del proyecto y de OneDrive, legible solo por tu usuario de Windows:

```bash
node --env-file=server/.env scripts/crear-admin.mjs
```

Desde el panel de administración (*Usuarios*) cambias el rol de cualquier persona y, con **Crear cuenta**, reservas un correo interno con el dominio de su rol (por defecto `@eco.smart.com`, `@recolector.eco.smart.com`, `@aliado.eco.smart.com` y `@administrador.eco.smart.com`, configurables en *Dominios*). La persona entra a *Regístrate* con ese correo y pone su propia contraseña; nadie puede registrarse con un correo interno que la administración no creó.

**Códigos:** registrarse e iniciar sesión no piden código ni enlace de verificación (decisión del equipo, se aparta de RF01 y RNF13). El único código de 6 dígitos es el de **cambiar la contraseña**; el de las cuentas internas y de demostración llega al correo del proyecto. La pantalla de ingreso ya no muestra las cuentas de demostración en este modo.

Cuentas de demostración (contraseña `EcoSmart2026`; en la pantalla de ingreso solo aparecen en el modo sin servidor): `estudiante@universidad.edu.ec`, `recolector@universidad.edu.ec`, `admin@universidad.edu.ec` y `aliado@universidad.edu.ec`. Sin correo real, el código para cambiar la contraseña aparece en la *Bandeja de correo simulada* (`/#/correo`).

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
server/         API Express sobre PostgreSQL, autenticación, validación y pruebas de integración
db/             Esquema, migraciones, instalador, respaldos y tareas programadas
scripts/        Prueba de carga, monitoreo de disponibilidad y herramientas de la IA
ia/evaluacion/  Conjunto de prueba de la IA (las fotos se guardan fuera de Git)
docs/           Accesibilidad, continuidad y capacidad, y evidencias
```

### IA (RNF11)

```bash
npm run ia:entrenar     # aprende de las fotos de práctica (ia/entrenamiento/) y estima la calidad
npm run ia:evaluar      # examen: F1 macro, recall por categoría y matriz de confusión sobre ia/evaluacion/
npm run ia:embeddings   # regenera las descripciones de cada categoría (al cambiar de versión)
```

Más detalles de la base de datos en [db/README.md](db/README.md).

Verificación de accesibilidad WCAG 2.2 AA y responsive: [docs/accesibilidad-y-responsive.md](docs/accesibilidad-y-responsive.md).

**Publicar en internet** (Render + Neon, gratis): guía paso a paso en [docs/publicar.md](docs/publicar.md).

Respaldos, recuperación, disponibilidad, prueba de carga y seguridad (RNF02, RNF04, RNF06, RNF09, RNF11, RNF12): [docs/continuidad-y-capacidad.md](docs/continuidad-y-capacidad.md).
