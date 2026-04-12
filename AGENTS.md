# AGENTS.md

## Overview

Thermostart is a Flask app for running Thermosmart devices without the original cloud service. The main code lives in `services/web/thermostart`.

## Branching

- Base new work on `dev`, not `main`
- Use short-lived feature/chore branches
- Merge into `dev` first
- Promote `dev` to `main` only when stable

## Important Paths

- App code: `services/web/thermostart`
- Migrations: `services/web/migrations`
- Dev container: `docker-compose.yml`
- Prod container: `docker-compose.prod.yml`

## Dev vs Prod

### Dev
- Uses `docker-compose.yml`
- Mounts local `./services/web` into `/usr/src/app`
- Uses `.env.dev`
- Keep explicit image name: `thermostart-main-web_dev`

### Prod
- Uses `docker-compose.prod.yml`
- Runs baked image code from `/home/app/web`
- Uses `.env.prod`
- Local file edits do not affect the running prod container until rebuild/recreate

## Environment Files

- Keep env files out of Git
- Use `KEY=value` syntax with no spaces around `=`
- `APP_FOLDER`:
  - dev: `/usr/src/app`
  - prod: `/home/app/web`

## Migrations

- Current branch history uses:
  - `services/web/migrations/versions/2622e5a9fef8_create_parsed_messages_table.py`
- Do not reintroduce:
  - `2622e5a9fef8_create_parsed_messages_table_with_.py`
- When changing migrations, be explicit whether the change is for fresh installs, upgrades, or both

## Change Guidelines

- Check whether the target is dev or prod before editing Docker or env-related files
- Check Alembic revision and upgrade path before changing migrations
- Prefer separate commits for app logic, Docker/env changes, and migration changes

## Ignore / Local Artifacts

Keep these uncommitted:
- `.env`
- `.env.dev`
- `.env.prod`
- `instance/`
- `__pycache__/`
- `.backup-align-dev-*`
