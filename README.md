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

CORS solo está activo en el gateway. Configura en `services/gateway/.env` el origen del frontend (por defecto `http://localhost:5173`) y, si cambian, las URLs de los servicios; ver `services/gateway/.env.example`.

Para probar el login desde el frontend, arranca al menos `npm run dev:gateway` y `npm run dev:admin`.

## Bases de datos

Cada servicio tiene su propia base en PostgreSQL. Crea las bases y ejecuta el script de cada una (conectado a esa base):

| Base | Script |
| --- | --- |
| `admin_db` | `database/admin_db.sql` |
| `crew_db` | `database/crew_db.sql` |
| `flights_db` | `database/flights_db.sql` |
| `recommendation_db` | `database/recommendation_db.sql` |

Los scripts se pueden ejecutar varias veces sin error y no borran datos: **vuelve a ejecutarlos cada vez que bajes cambios**, porque agregan columnas nuevas. Configura `DB_NAME` en el `.env` de cada servicio con el nombre de su base.

### Datos de demo

```bash
npm run seed:demo
```

Carga 3 bases, 8 aeropuertos, 5 aeronaves, un supervisor (`camila.restrepo@aircrew.demo`), 17 tripulantes (`nombre.apellido@aircrew.demo`) y 12 vuelos en los próximos 7 días. Todos los usuarios de demo tienen la contraseña `AirCrewDemo2026`. Se puede ejecutar cuando quieras: borra solo los datos de demo y los vuelve a crear con fechas desde ese momento.

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
RESEND_API_KEY=...
RESEND_FROM_EMAIL=...
CREW_ACTIVATION_URL=http://localhost:3000/activar-cuenta
ACTIVATION_TOKEN_EXPIRES_MINUTES=1440
```

El remitente debe estar verificado en Resend. El enlace de activación debe llevar el token a la pantalla frontend, que envía `POST /auth/activate` con `token` y una contraseña de 12 a 72 bytes. Luego el tripulante inicia sesión en `POST /auth/login`. El token vence según la configuración y solo sirve una vez.

`CREW_SERVICE_KEY` debe coincidir en Admin y Crew. El registro `POST /crew-members` recibe `name`, `email`, `employeeCode` y `position`, sin contraseña. Si el envío del correo falla, la cuenta pendiente permanece en Admin y requerirá limpieza manual antes de reintentar con el mismo correo.
