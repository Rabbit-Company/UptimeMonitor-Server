FROM oven/bun:1-alpine

RUN apk add curl

USER bun
WORKDIR /app

COPY --chown=bun:bun ./package.json ./
COPY --chown=bun:bun src/ ./src/

RUN mkdir -p /app/config

RUN bun i

EXPOSE 3000/tcp
ENTRYPOINT [ "bun", "run", "start" ]