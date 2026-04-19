COMPOSE ?= docker compose
BACKEND  = $(COMPOSE) exec backend
FRONTEND = $(COMPOSE) exec frontend

.DEFAULT_GOAL := help

.PHONY: help up up-build down restart stop ps logs logs-backend logs-frontend logs-caddy \
        build rebuild pull \
        shell-backend shell-frontend shell-db \
        migrate makemigrations superuser collectstatic \
        test test-backend test-frontend lint \
        frontend-install frontend-dev frontend-build \
        reindex clean-volumes prune

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z0-9_-]+:.*?## / {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

## --- Stack lifecycle ---------------------------------------------------------

up: ## Start the stack in the background
	$(COMPOSE) up -d

up-build: ## Rebuild images and start the stack
	$(COMPOSE) up -d --build

down: ## Stop and remove containers (keeps volumes)
	$(COMPOSE) down

restart: ## Restart all services
	$(COMPOSE) restart

stop: ## Stop containers without removing them
	$(COMPOSE) stop

ps: ## Show service status
	$(COMPOSE) ps

build: ## Build all images
	$(COMPOSE) build

rebuild: ## Build images without cache
	$(COMPOSE) build --no-cache

pull: ## Pull upstream images
	$(COMPOSE) pull

## --- Logs --------------------------------------------------------------------

logs: ## Tail logs for all services
	$(COMPOSE) logs -f --tail=200

logs-backend: ## Tail backend logs
	$(COMPOSE) logs -f --tail=200 backend

logs-frontend: ## Tail frontend logs
	$(COMPOSE) logs -f --tail=200 frontend

logs-caddy: ## Tail caddy logs
	$(COMPOSE) logs -f --tail=200 caddy

## --- Shells ------------------------------------------------------------------

shell-backend: ## Open a shell in the backend container
	$(BACKEND) bash

shell-frontend: ## Open a shell in the frontend container
	$(FRONTEND) sh

shell-db: ## Open a psql shell in the db container
	$(COMPOSE) exec db sh -c 'psql -U $$POSTGRES_USER $$POSTGRES_DB'

## --- Django ------------------------------------------------------------------

migrate: ## Apply database migrations
	$(BACKEND) python manage.py migrate

makemigrations: ## Create new migrations (app=search_engine)
	$(BACKEND) python manage.py makemigrations $(app)

superuser: ## Create a Django superuser
	$(BACKEND) python manage.py createsuperuser

collectstatic: ## Collect Django static files
	$(BACKEND) python manage.py collectstatic --noinput

reindex: ## Rebuild Elasticsearch indexes
	$(BACKEND) python manage.py search_index --rebuild -f

## --- Tests & lint ------------------------------------------------------------

test: test-backend test-frontend ## Run all tests

test-backend: ## Run backend Django tests (sqlite)
	$(BACKEND) sh -c 'USE_SQLITE_FOR_TESTS=true python manage.py test'

test-frontend: ## Run frontend unit tests
	$(FRONTEND) npm run test

lint: ## Lint frontend
	$(FRONTEND) npm run lint

## --- Frontend (host) ---------------------------------------------------------

frontend-install: ## Install frontend deps on host
	cd frontend && npm install

frontend-dev: ## Run frontend dev server on host
	cd frontend && npm run dev

frontend-build: ## Build frontend on host
	cd frontend && npm run build

## --- Cleanup -----------------------------------------------------------------

clean-volumes: ## Stop stack and remove all volumes (DESTRUCTIVE)
	$(COMPOSE) down -v

prune: ## Prune dangling Docker resources
	docker system prune -f
