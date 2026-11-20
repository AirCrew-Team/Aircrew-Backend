# Backend Vuelos

Backend de AirCrew organizado en workspaces de Node.js. Cada servicio arranca como proceso independiente; el frontend entra siempre por el gateway.

## Servicios y puertos

| Servicio | Puerto predeterminado |
| --- | ---: |
| gateway | 3000 |
| flights | 3001 |
| crew | 3002 |
| recommendation | 3003 |
| notification | 3004 |
| admin | 3005 |

## Instalar y arrancar

Desde la raíz del proyecto:

```bash
npm install
npm run start:gateway
```

Para arrancar otro servicio, usa `npm run start:<servicio>`, por ejemplo `npm run start:crew`. En desarrollo están disponibles los comandos `npm run dev:<servicio>`.

## Gateway (entrada del frontend)

El frontend llama solo al gateway (`http://localhost:3000`), que reenvía cada petición al servicio según el prefijo:

| El frontend llama a | El gateway reenvía a |
| --- | --- |
| `/api/admin/...` | admin, por ejemplo `/api/admin/auth/login` → `http://localhost:3005/auth/login` |
| `/api/crew/...` | crew (3002) |
| `/api/flights/...` | flights (3001) |
| `/api/recommendation/...` | recommendation (3003) |
| `/api/notification/...` | notification (3004) |

El gateway no tiene lógica de negocio ni valida el token: reenvía el header `Authorization` y cada servicio lo verifica. Si un servicio está apagado, responde `502`.

### Sesión con cookie

- `POST /api/admin/auth/login` responde con el mismo body de siempre (`{ user, token }`) y además pone la cookie `aircrew_token`: `HttpOnly`, `SameSite=Lax`, `Path=/` y una duración igual a la que le queda al JWT. Lleva `Secure` solo con `NODE_ENV=production`.
- Si la petición trae la cookie `aircrew_token` y no trae `Authorization`, el gateway la convierte en `Authorization: Bearer <token>` antes de reenviarla. Si ya trae `Authorization`, se respeta.
- `POST /api/admin/auth/logout` borra la cookie y responde `204`, haya o no sesión.
- `GET /api/admin/auth/me` responde `401` si el token falta, no es válido o venció, o si el usuario ya no existe o está desactivado.

CORS solo está activo en el gateway, con credenciales (`credentials: true`) para que el navegador envíe la cookie. Con credenciales el navegador no acepta el origen `*`, así que `CORS_ORIGINS` debe listar los orígenes exactos del frontend, y el frontend debe hacer sus peticiones con credenciales (`withCredentials` en Axios). Configura en `services/gateway/.env` el origen del frontend (por defecto `http://localhost:5173`) y, si cambian, las URLs de los servicios; ver `services/gateway/.env.example`.

Para probar el login desde el frontend, arranca al menos `npm run dev:gateway` y `npm run dev:admin`.

## Bases de datos

Cada servicio tiene su propia base en PostgreSQL. Crea las bases y ejecuta el script de cada una (conectado a esa base):

| Base | Script |
| --- | --- |
| `admin_db` | `database/admin_db.sql` |
| `crew_db` | `database/crew_db.sql` |
| `flights_db` | `database/flights_db.sql` |

Los scripts se pueden ejecutar varias veces sin error. Configura `DB_NAME` en el `.env` de cada servicio con el nombre de su base.

## Documentación de la API (Swagger)

Admin, Crew y Flights publican su contrato OpenAPI con Swagger UI:

| Servicio | Swagger UI | Contrato JSON |
| --- | --- | --- |
| admin | http://localhost:3005/docs | http://localhost:3005/docs/openapi.json |
| crew | http://localhost:3002/docs | http://localhost:3002/docs/openapi.json |
| flights | http://localhost:3001/docs | http://localhost:3001/docs/openapi.json |

Cada contrato está en `services/<servicio>/src/adapters/inbound/http/docs/openapi.yaml`. Si cambias un endpoint, actualiza también ese archivo. Para probar rutas protegidas, inicia sesión en Admin (`POST /auth/login`), copia el `token` y pégalo en el botón **Authorize**.

## Invitación de tripulantes

Configura en `services/admin/.env`:

```env
CREW_ACTIVATION_URL=http://localhost:5173/activar-cuenta
ACTIVATION_TOKEN_EXPIRES_MINUTES=1440
# resend (por defecto) o smtp
EMAIL_PROVIDER=smtp
```

`CREW_ACTIVATION_URL` es la pantalla del frontend que activa la cuenta: el correo le agrega `?token=...`. Esa pantalla envía `POST /auth/activate` con `token` y una contraseña de 12 a 72 bytes. El token vence según la configuración y solo sirve una vez.

`POST /auth/activate/check` recibe `{ token }` y solo consulta: responde 200 si el enlace sirve y 400 si no es válido, venció o la cuenta ya está activa. No gasta el token. El frontend lo usa al abrir el enlace.

### Proveedor del correo

- **`EMAIL_PROVIDER=smtp` (recomendado sin dominio propio):** envía desde una cuenta de Gmail a cualquier destinatario, hasta unos 500 correos al día.
  1. En la cuenta de Google, activa la **verificación en 2 pasos**.
  2. En **Seguridad → Contraseñas de aplicación**, crea una para «AirCrew» y copia los 16 caracteres sin espacios.
  3. Rellena `SMTP_USER` (la dirección de Gmail), `SMTP_PASS` (la contraseña de aplicación, no la de la cuenta) y `SMTP_FROM` (p. ej. `AirCrew <tu dirección de Gmail>`). Gmail envía siempre desde la cuenta autenticada: si `SMTP_FROM` usa otra dirección, la reemplaza.
  4. `SMTP_HOST`, `SMTP_PORT` y `SMTP_SECURE` ya traen los valores de Gmail en `.env.example`: 465 con `SMTP_SECURE=true`. Para el 587 (STARTTLS) usa `SMTP_SECURE=false`. Si `SMTP_SECURE` no está definido, se deduce del puerto.
- **`EMAIL_PROVIDER=resend`:** usa `RESEND_API_KEY` y `RESEND_FROM_EMAIL`. Sin un dominio verificado en Resend, solo entrega al correo del dueño de la cuenta de Resend.

Si el envío falla, la API responde 502 con un mensaje genérico, y si falta configuración del correo responde 503. En los dos casos, el detalle queda en el log del servicio admin y la cuenta pendiente se borra, así que se puede reintentar con el mismo correo.

`CREW_SERVICE_KEY` debe coincidir en Admin y Crew. El registro `POST /crew-members` recibe `name`, `email`, `employeeCode` y `position`, sin contraseña.

### Recuperación de contraseña

Usa el mismo proveedor de correo. Configura en `services/admin/.env`:

```env
PASSWORD_RESET_URL=http://localhost:5173/restablecer-contrasena
```

- `POST /auth/forgot-password` recibe `{ email }` y responde siempre el mismo mensaje, exista o no la cuenta. Si es una cuenta activa, envía en segundo plano un enlace `PASSWORD_RESET_URL?token=...` que vence a los 10 minutos y sirve una sola vez. Pedir otro enlace anula el anterior. Las cuentas pendientes de activación o desactivadas no lo reciben.
- `POST /auth/reset-password/check` recibe `{ token }` y solo consulta: responde 200 si el enlace sirve, 400 si no es válido o venció y 429 si se alcanzó el límite de cambios. No gasta el token. El frontend lo usa al abrir el enlace.
- `POST /auth/reset-password` recibe `{ token, password }` (12 a 72 bytes) y cambia la contraseña. No inicia sesión.
- Límites por cuenta en las últimas 24 horas: 3 cambios de contraseña, 2 minutos entre solicitudes y 5 solicitudes. Al superarlos responde 429 con un mensaje para la persona. Son reglas del producto, fijas en el código.
- Si falta `PASSWORD_RESET_URL` o la configuración del correo, responde 503 antes de buscar la cuenta. Si el envío falla, la respuesta no cambia y el error queda en el log.
- Requiere las columnas `password_reset_*` y la tabla `password_reset_events` de `database/admin_db.sql`, que se puede volver a ejecutar sobre una base existente.

## Ausencias (servicio crew)

Las ausencias se reportan por fechas, sin vuelo. El contrato completo está en el Swagger de crew.

- `POST /absences` (solo `crew`) recibe `{ start_date, end_date, reason, notes?, attachment? }`, con las fechas en `AAAA-MM-DD` y `attachment` como `{ file_name, mime_type, data_base64 }`.
  - Validaciones: el inicio puede ser como mucho de ayer, que es el margen por la zona horaria; el fin es igual o posterior al inicio, con 30 días como máximo entre ambas; las observaciones tienen hasta 500 caracteres.
  - El comprobante es un PDF, PNG o JPG de hasta 10 MB, ya decodificado, y sus primeros bytes deben coincidir con el tipo. Es obligatorio si el motivo es `illness`.
  - Responde `409` si el tripulante ya tiene una ausencia cuyas fechas se cruzan. La comprobación y el guardado van en una transacción con el tripulante bloqueado (`pg_advisory_xact_lock`), así que dos envíos simultáneos no crean ausencias que se cruzan.
  - Esta ruta acepta un body JSON de hasta 15 MB, por el base64, y lo lee después de comprobar la sesión. Las demás rutas de crew siguen con 100 kB.
- `GET /absences` y `GET /absences/:id` (supervisor y super_admin) incluyen `start_date`, `end_date` y `attachment: { file_name, mime_type, size_bytes } | null`, nunca los bytes.
- `GET /absences/:id/attachment` (supervisor y super_admin) descarga el comprobante con su `Content-Type`, `Content-Disposition: attachment` y `X-Content-Type-Options: nosniff`. Responde `404` si la ausencia no existe o no tiene comprobante.
- Recommendation responde `409` («Esta ausencia no tiene un vuelo asociado.») si se piden reemplazos para una ausencia sin vuelo.
- El comprobante se guarda en la tabla `absence_attachments` (`BYTEA`) de `database/crew_db.sql`. El script también deja opcionales las columnas del vuelo y añade `start_date` y `end_date`, y se puede volver a ejecutar sobre una base existente.
- Tests: `npm test -w @vuelos/crew`, y lo mismo con `@vuelos/notification` y `@vuelos/recommendation`.
