# ---------- Build stage ----------
FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json ./
RUN bun install

COPY src/ ./src/
RUN mkdir -p config

# ---------- Runtime stage ----------
FROM oven/bun:1-distroless

WORKDIR /app

COPY --from=builder /app /app

EXPOSE 3000/tcp
CMD ["src/index.ts"]