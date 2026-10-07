# Backend Vuelos

Backend de AirCrew con cinco servicios independientes en Node.js y Express. La estructura está lista para avanzar por servicios; la base de datos y RabbitMQ quedan para etapas posteriores.

## Iniciar el backend mínimo

Desde la raíz del proyecto:

```bash
npm start
```

Esto inicia el servidor Node.js de la raíz en el puerto `3000` (o en el puerto indicado por la variable `PORT`). El servidor responde para comprobar que el backend está activo. Este comando no inicia los servicios ni requiere PostgreSQL o RabbitMQ.

## Servicios

| Servicio | Puerto predeterminado |
| --- | ---: |
| flights | 3001 |
| crew | 3002 |
| recommendation | 3003 |
| notification | 3004 |
| admin | 3005 |

Cada servicio organiza su código en configuración, rutas, controladores, servicios y middlewares cuando aplica. `shared/` contiene componentes comunes; los servicios no se importan entre sí.

Para instalar dependencias y arrancar un servicio desde la raíz:

```bash
npm install
npm run start:flights
```

Para iniciar otro servicio, usa `npm run start:crew`, `npm run start:recommendation`, `npm run start:notification` o `npm run start:admin`. En desarrollo están disponibles los comandos `npm run dev:<servicio>`.
