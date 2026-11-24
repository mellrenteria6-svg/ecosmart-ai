# Publicar EcoSmart AI en internet (gratis)

La página queda en una dirección como `https://ecosmart-ai.onrender.com`, con HTTPS (necesario
para usar la cámara del celular), funcionando aunque tu laptop esté apagada.

- **Neon** guarda la base de datos (PostgreSQL).
- **Render** corre la página y la API.

Ambos son gratis. Limitación del plan gratis de Render: si nadie entra por 15 minutos, la página
"se duerme" y la siguiente visita tarda cerca de 1 minuto en abrir; después va normal.

Tiempo total: unos 30 minutos. Ten a mano el archivo `server\.env` (ahí están tus datos de Brevo).

---

## Paso 1 — Base de datos en Neon

1. Entra a <https://neon.tech> y haz clic en **Sign up**. Regístrate con **GitHub** (la cuenta del proyecto).
2. Crea un proyecto:
   - **Project name:** `ecosmart`
   - **Postgres version:** la más nueva que ofrezca.
   - **Region:** **AWS US East (N. Virginia)** (queda cerca de Render).
3. En el panel del proyecto, botón **Connect**. Copia la **Connection string**. Se ve así:
   `postgresql://neondb_owner:XXXXXXXX@ep-algo-123456-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require`
   Es secreta (incluye la clave): no la compartas ni la pegues en el chat. Guárdala un momento en
   el Bloc de notas.

No hace falta crear tablas: la página las crea sola la primera vez que arranca.

## Paso 2 — Claves de los avisos push

En la carpeta del proyecto, abre PowerShell (clic en la barra de arriba, escribe `powershell`,
Enter) y corre:

```powershell
npm.cmd run nube:claves
```

Aparecen `VAPID_PUBLICA` y `VAPID_PRIVADA`. Déjalas en pantalla para el paso 3.

## Paso 3 — Página en Render

1. Entra a <https://render.com>, **Get Started**, y regístrate con **GitHub** (la misma cuenta).
   Si te pide permiso para ver tus repositorios, autoriza **ecosmart-ai**.
2. Arriba: **New** → **Blueprint**. Elige el repositorio **ecosmart-ai** y dale **Connect**.
   Render lee el archivo `render.yaml` y te muestra un servicio llamado `ecosmart-ai`.
3. Te pide estos valores (los demás ya vienen listos):

   | Variable | Qué pegar |
   |---|---|
   | `DATABASE_URL` | La Connection string de Neon (paso 1) |
   | `URL_PUBLICA` | `https://ecosmart-ai.onrender.com/` (si Render te da otro nombre, ponlo en el paso 4) |
   | `SMTP_USUARIO` | De `server\.env`, la línea `SMTP_USUARIO=` (termina en `@smtp-brevo.com`) |
   | `SMTP_CLAVE` | De `server\.env`, la línea `SMTP_CLAVE=` |
   | `CORREO_REMITENTE` | `EcoSmart AI <ecosmartia@gmail.com>` |
   | `VAPID_PUBLICA` y `VAPID_PRIVADA` | Las del paso 2 |

4. Dale **Apply** (o **Deploy Blueprint**). Espera de 5 a 10 minutos: en **Logs** verás
   `Base vacía: cargando esquema...` y al final `EcoSmart AI API en ...`.
5. Arriba del servicio aparece la dirección real (por ejemplo `https://ecosmart-ai-x1y2.onrender.com`).
   Si no es la que pusiste en `URL_PUBLICA`, corrígela en **Environment** (con `/` al final) y guarda:
   Render reinicia solo. Esa dirección es la que va en los enlaces de los correos.

Las cuentas de demostración quedan **bloqueadas** en la nube (su contraseña está en GitHub).

## Paso 4 — Tu administradora en la nube

En PowerShell, desde la carpeta del proyecto (pega tu Connection string entre las comillas):

```powershell
$env:DATABASE_URL = "PEGA_AQUI_LA_CONNECTION_STRING"
node scripts/crear-admin.mjs
Remove-Item Env:DATABASE_URL
```

Te pregunta tu correo y tu nombre. La contraseña queda en
`C:\Users\ASUS\EcoSmart-privado\administrador-nube.txt` (solo tu usuario de Windows puede abrirla;
la de tu PC sigue en `administrador.txt`).

## Paso 5 — Probar

1. Abre la dirección de Render en el celular y en la computadora (la primera vez tarda ~1 minuto).
2. Entra con tu administradora: el código de la primera vez llega a tu correo.
3. Crea una cuenta de estudiante con otro correo, verifícala y prueba **Reciclar** con la cámara.
4. Comprueba la salud: `https://TU-DIRECCION/api/salud` debe decir `"ok":true` y `"correoReal":true`.

## Después

- **Actualizaciones:** cada vez que se sube un cambio a GitHub, Render vuelve a publicar solo.
- **Monitoreo (RNF06):** para medir la página publicada en vez de la de tu PC, vuelve a registrar
  la tarea con la nueva dirección:
  `powershell -ExecutionPolicy Bypass -File db\programar-tareas.ps1 -UrlSalud https://TU-DIRECCION/api/salud`
- **Respaldos:** Neon guarda un historial corto de la base para recuperarla. Antes de cada entrega,
  descarga un respaldo desde el panel de Neon (Backup & Restore) o pide que adaptemos `db\respaldo.ps1`.
