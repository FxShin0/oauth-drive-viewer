# Drive Viewer — OAuth 2.0 + Google Drive

Proyecto académico educativo que implementa el flujo OAuth 2.0 Authorization Code manualmente con Node.js, sin Express, Passport ni paquetes OAuth. Usa APIs `http`, `crypto` y `fetch` incorporadas en Node.js.

## Funcionalidad

- Inicio de sesión con una cuenta de Google.
- Solicitud de scopes `openid`, `email`, `profile` y `drive.metadata.readonly`.
- Callback OAuth y validación de `state`.
- Intercambio del código de autorización por tokens desde el servidor.
- Consulta de nombre, correo y foto usando OpenID Connect UserInfo.
- Listado de metadatos de Google Drive mediante `files.list`.
- Búsqueda local, enlaces para abrir archivos en Drive, estado de sesión y cierre de sesión.
- Vista didáctica del flujo OAuth con los tres actores.
- Tokens guardados del lado del servidor (no se envían al navegador).

## Requisitos

- Node.js 20 o posterior.
- Una cuenta de Google.
- Un proyecto en Google Cloud con Google Drive API habilitada y una credencial OAuth 2.0 de tipo **Aplicación web**.

## Configuración de Google Cloud

1. Abrí Google Cloud Console y creá o elegí un proyecto.
2. En **APIs y servicios → Biblioteca**, habilitá **Google Drive API**.
3. Configurá la pantalla de consentimiento OAuth. Si la aplicación está en modo de prueba, agregá tu cuenta como usuario de prueba.
4. En **Credenciales**, creá un **ID de cliente OAuth → Aplicación web**.
5. Agregá esta URI exacta en **URIs de redireccionamiento autorizados**:
   `http://localhost:3000/oauth/callback`
6. Copiá el Client ID y Client Secret. No los pegues en `public/` ni los subas a Git.

Google puede pedir verificación o mostrar advertencias de aplicación no verificada dependiendo de los scopes y de la configuración del proyecto.

## Ejecutar localmente

### Windows PowerShell

```powershell
Copy-Item .env.example .env
```

Editá `.env` y completá las variables. Generá `SESSION_SECRET` con:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Para esta versión, Node no carga `.env` automáticamente en todas las instalaciones. Ejecutá el servidor con las variables de entorno definidas en tu terminal. Una alternativa práctica es usar Node 20.6+ con `--env-file=.env`:

```powershell
node --env-file=.env server.js
```

Abrí otra terminal si querés usar modo watch:

```powershell
node --env-file=.env --watch server.js
```

Luego abrí http://localhost:3000.

### Linux / macOS

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node --env-file=.env server.js
```

No necesita `npm install`: no hay dependencias externas.

## Scopes

- `openid`, `email`, `profile`: identidad básica del usuario.
- `https://www.googleapis.com/auth/drive.metadata.readonly`: permite leer metadatos de archivos de Drive sin modificar el contenido.

La app solicita `access_type=offline` y consentimiento para facilitar que Google pueda emitir un refresh token. Google no garantiza que devuelva uno en cada autorización; el código guarda el que se recibe, si lo hay. En este MVP no se implementa renovación automática: si vence el access token, se debe volver a iniciar sesión.

## Arquitectura del flujo

1. El navegador navega a `/auth/google`.
2. El servidor genera un `state` aleatorio y redirige a Google.
3. Google devuelve `code` y `state` a `/oauth/callback`.
4. El servidor valida el `state` y canjea el código en el token endpoint.
5. El servidor consulta UserInfo y crea una sesión firmada con cookie `HttpOnly`.
6. El frontend consulta `/api/me` y `/api/drive/files`; el token no sale del servidor.
7. `/api/logout` elimina la sesión de la memoria del servidor.

## Limitaciones deliberadas del MVP

- Sesiones y estados en memoria: al reiniciar el servidor se pierden; no es para producción ni para múltiples instancias.
- No hay renovación automática del access token ni paginación de Drive más allá de la primera página.
- La cookie usa `SameSite=Lax` y `HttpOnly`, pero no está marcada `Secure` porque el desarrollo local usa HTTP. En producción, usar HTTPS, cookie `Secure`, protección CSRF, gestión de sesiones persistente y controles adicionales.
- La app solicita metadatos de archivos; no descarga ni modifica contenido.
- El secreto de cliente debe permanecer solo en el servidor.
- La vista “Flujo OAuth” es didáctica; la autenticación real sucede en los endpoints.
- El proyecto evita bibliotecas que abstraen OAuth. La GUI usa HTML, CSS y JavaScript sin framework.

## Pruebas rápidas

- `http://localhost:3000/health` debe devolver `{"ok":true}`.
- Sin credenciales, la página de inicio muestra un mensaje al intentar autenticar.
- Con las credenciales correctas, el callback debe llevar al dashboard.
- Verificá que la lista refleje archivos reales de la cuenta autorizada y que el cierre de sesión vuelva a Inicio.

## Seguridad

Este proyecto es una base educativa, no una implementación auditada para producción. No compartas el archivo `.env`, tokens, capturas con información privada ni el Client Secret.
