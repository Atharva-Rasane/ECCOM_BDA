# Docker Setup Guide

This project is fully dockerized with PostgreSQL, MongoDB, and the Node.js application.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop) installed and running

## Quick Start

1. **Start all services** (first time will take a few minutes to download images):
   ```bash
   docker compose up
   ```

2. **Start in detached mode** (runs in background):
   ```bash
   docker compose up -d
   ```


3. **Stop all services**:
   ```bash
   docker compose down
   ```

5. **Stop and remove volumes** (deletes database data):
   ```bash
   docker compose down -v
   ```

## What's Included

- **PostgreSQL** (port 5432): Your main database
- **MongoDB** (port 27017): For session storage
- **Node.js App** (port 3000): Your application with hot reload
- **Portainer** (port 9000): Docker management UI - [http://localhost:9000](http://localhost:9000)

## Development Features

- **Hot Reload**: Code changes in `src/` automatically restart the server
- **Persistent Data**: Database data is preserved between restarts
- **Health Checks**: Services wait for databases to be ready before starting

## Running Commands Inside Containers

**Run database seed**:
```bash
docker-compose exec app npm run seed
```

**Access PostgreSQL**:
```bash
docker-compose exec postgres psql -U postgres -d ecommerce_dev
```

**Access MongoDB**:
```bash
docker-compose exec mongodb mongosh ecommerce_dev
```

**Install new npm packages**:
```bash
docker-compose exec app npm install <package-name>
# Then rebuild: docker-compose up --build
```

## Troubleshooting

**Port already in use**:
```bash
# Stop the conflicting service or change ports in docker-compose.yml
```

**Rebuild after dependency changes**:
```bash
docker-compose up --build
```

**Clean slate** (removes all data):
```bash
docker-compose down -v
docker-compose up --build
```

**View all containers**:
```bash
docker ps -a
```

## Environment Variables

The `docker-compose.yml` includes all necessary environment variables. You can override them by:
1. Creating a `.env` file in the project root
2. Editing the `environment` section in `docker-compose.yml`

## Production Build

To build for production:
```bash
docker build --target production -t ecommerce-app:latest .
```
