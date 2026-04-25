>[!CAUTION]
># CURRENT BRANCH STATUS: Might work. DO NOT USE IN PROD.

# Thermostart - Cloudless Thermosmart
Make your (currently) useless Thermosmart device cloud independent and get
your old scheduling functionality back.

Created with Flask technology and fully dockerized.

## Web UI: classic and v2

The application now ships two web interfaces. The legacy interface is the
default; users can opt in to the new responsive design from the top bar
("Try new design"), and switch back from inside it ("Classic UI"). The choice
is stored per browser in the `ts_ui` cookie — there is no database migration.

The new UI lives under `services/web/thermostart/templates/v2/` and uses
Tailwind CSS + Alpine.js, with no production Node dependency. The compiled
stylesheet `services/web/thermostart/static/css/v2.css` is committed so that
the dev image works out of the box. To rebuild it after editing templates or
the Tailwind source:

```
cd services/web/thermostart
npm install            # one-time
npm run build:css      # writes static/css/v2.css
# or, while iterating:
npm run watch:css
```

The production image rebuilds the bundle automatically through a `node:20`
build stage in `services/web/Dockerfile.prod`, so a stale committed bundle
cannot ship to prod.

## Flask commands

## Quick start: dockerize development
In the root folder, copy the `.env.example` file and name the new file `.env.dev`.
You may change the values as you need, especially it's a good practice to set
unique SECRET_KEY - at least change some characters there :)

After that stay in the root folder and use following commands:
```
# give permissions to your entrypoint.sh file
chmod +x services/web/entrypoint.sh

# build and run
docker-compose build
docker-compose up -d

# delete if not needed anymore
docker-compose down
```
To use the application visit http://localhost:3888 in your browser.

#### Additional useful commands
```
# RUN in DEBUG mode
python manage.py --app thermostart run --debug

# Open shell with app's data
flask --app thermostart shell

# Dynamically change the docker's base image
docker-compose -f docker-compose.prod.yml build --build-arg TS_IMAGE=python:3.12.2-slim-bookworm
```

## Docker compose related commands

```
# Docker running operations
docker-compose build
docker-compose build --no-cache
docker-compose up -d      # d makes in run in the background
docker-compose down       # remove existing container        | CAREFUL IN PRODUCTION!
docker-compose down -v    # include volume of sqlite data    | CAREFUL IN PRODUCTION!

# Docker check logs
docker-compose logs

# Stop containers
docker-compose stop
docker stop thermostart-web-1

# Start containers
docker-compose start
docker start thermostart-web-1
```

## Production
Basically it's the same way as dev server, but you need to use different files:
- create .env.prod for environment variables:
  - `APP_FOLDER=/home/app/web`
  - `DATABASE_URL= <URL with proper database data>`

And most importantly, to every docker command add the "-f" flag: `-f docker-compose.prod.yml`
to point to the file that you want to use to build images and run. Example:
```
docker-compose -f docker-compose.prod.yml build
```

## Support my work
Thank you for thinking about supporting my work.

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/wichers)
