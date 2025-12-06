.PHONY: up down logs ps clean restart

# Start all services
up:
	docker-compose --env-file .env.dev up -d

# Stop all services
down:
	docker-compose --env-file .env.dev down

# View logs
logs:
	docker-compose --env-file .env.dev logs -f

# View logs for a specific service
logs-%:
	docker-compose --env-file .env.dev logs -f $*

# List running containers
ps:
	docker-compose --env-file .env.dev ps

# Stop and remove containers, networks, and volumes
clean:
	docker-compose --env-file .env.dev down -v

# Restart all services
restart:
	docker-compose --env-file .env.dev restart

# Build services (if needed in future)
build:
	docker-compose --env-file .env.dev build

