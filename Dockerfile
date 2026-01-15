# ---------- Build stage ----------
FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json ./
RUN bun install

COPY src/ ./src/

RUN bun build src/index.ts --outfile uptime-monitor --target bun --compile --production

# ---------- Runtime stage ----------
FROM gcr.io/distroless/base-nossl-debian13

WORKDIR /app

COPY --from=builder /app/uptime-monitor /app/

EXPOSE 3000/tcp
CMD ["/app/uptime-monitor"]