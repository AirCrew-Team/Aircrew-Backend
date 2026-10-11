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
