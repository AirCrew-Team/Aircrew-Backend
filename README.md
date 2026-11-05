# Backend Vuelos

Backend mínimo de AirCrew organizado en workspaces de Node.js. Cada servicio arranca como proceso independiente y muestra su puerto; la lógica de negocio y el enrutamiento del gateway quedan para etapas posteriores.

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

El gateway responde `gateway activo` en el puerto 3000 y todavía no reenvía solicitudes. No se requiere PostgreSQL mientras los servicios no se conecten a sus bases de datos.

## Documentación de la API (Swagger)

Admin, Crew y Flights publican su contrato OpenAPI con Swagger UI:

| Servicio | Swagger UI | Contrato JSON |
| --- | --- | --- |
| admin | http://localhost:3005/docs | http://localhost:3005/docs/openapi.json |
| crew | http://localhost:3002/docs | http://localhost:3002/docs/openapi.json |
| flights | http://localhost:3001/docs | http://localhost:3001/docs/openapi.json |

Cada contrato está en `services/<servicio>/src/adapters/inbound/http/docs/openapi.yaml`. Si cambias un endpoint, actualiza también ese archivo. Para probar rutas protegidas, inicia sesión en Admin (`POST /auth/login`), copia el `token` y pégalo en el botón **Authorize**.

## Invitación de tripulantes

La tabla `users` de `admin_db` necesita las columnas de activación. Si creas la base desde cero, ejecuta en `admin_db`:

```sql
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS activation_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS activation_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS users_activation_token_hash_unique
  ON public.users (activation_token_hash)
  WHERE activation_token_hash IS NOT NULL;
```

Sin estas columnas la invitación y la activación fallan. Pendiente: agregar al repositorio los scripts de creación de tablas de cada servicio.

Configura en `services/admin/.env`:

```env
RESEND_API_KEY=...
RESEND_FROM_EMAIL=...
CREW_ACTIVATION_URL=http://localhost:3000/activar-cuenta
ACTIVATION_TOKEN_EXPIRES_MINUTES=1440
```

El remitente debe estar verificado en Resend. El enlace de activación debe llevar el token a la pantalla frontend, que envía `POST /auth/activate` con `token` y una contraseña de 12 a 72 bytes. Luego el tripulante inicia sesión en `POST /auth/login`. El token vence según la configuración y solo sirve una vez.

`CREW_SERVICE_KEY` debe coincidir en Admin y Crew. El registro `POST /crew-members` recibe `name`, `email`, `employeeCode` y `position`, sin contraseña. Si el envío del correo falla, la cuenta pendiente permanece en Admin y requerirá limpieza manual antes de reintentar con el mismo correo.
