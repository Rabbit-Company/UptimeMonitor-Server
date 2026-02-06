# Uptime Monitor

A high-performance uptime monitoring system built with Bun and ClickHouse. Receive heartbeat pulses from your services, organize them into groups, track custom metrics, and get notified when things go down.

## Features

- **Pulse-Based Monitoring** — Services send heartbeats; missing pulses trigger alerts
- **Hierarchical Groups** — Organize monitors with flexible health strategies (any-up, all-up, percentage)
- **Custom Metrics** — Track up to 3 numeric values per monitor (player count, connections, etc.)
- **Multi-Channel Notifications** — Discord, Email, and Ntfy support with per-monitor control
- **Real-Time Status Pages** — WebSocket-powered live updates
- **Self-Healing** — Automatic backfill when the monitor itself recovers from downtime

## Quick Start

### 1. Start the Services

```bash
wget https://github.com/Rabbit-Company/UptimeMonitor-Server/releases/latest/download/uptime-monitor.tar.xz
tar -xf uptime-monitor.tar.xz
cd uptime-monitor

sudo docker compose up -d
```

This starts:

- **Uptime Monitor** on port `3000`
- **ClickHouse** database (internal)

### 2. Configure Your Monitors

**Option A: Visual Configuration Editor (Recommended)**

Visit https://uptime-monitor.org/configurator to visually create and edit your configuration with a user-friendly interface. You can:

- Import your existing config.toml file
- Visually create monitors, groups, and status pages
- Configure custom metrics and notification channels
- Export your configuration back to TOML format

**Option B: Manual Configuration**

Edit `config.toml` to add your monitors:

```toml
[[monitors]]
id = "my-api"
name = "My API"
token = "secret-token-here"
interval = 30              # Expect pulse every 30 seconds
maxRetries = 0             # Mark down immediately on miss
resendNotification = 0     # Don't resend notifications
```

### 3. Send Pulses

From your service, send a GET request when healthy:

```bash
curl http://localhost:3000/v1/push/secret-token-here
```

Or with latency tracking:

```bash
curl "http://localhost:3000/v1/push/secret-token-here?latency=125"
```

### 4. Check Status

```bash
curl http://localhost:3000/v1/status/:slug
```

## Documentation

| Document                                                               | Description                                |
| ---------------------------------------------------------------------- | ------------------------------------------ |
| [Configuration Guide](docs/configuration.md)                           | Complete config.toml reference             |
| [API Reference](docs/api.md)                                           | All endpoints and WebSocket events         |
| [Notifications](docs/notifications.md)                                 | Setting up Discord, Email, Ntfy            |
| [Groups & Strategies](docs/groups.md)                                  | Organizing monitors hierarchically         |
| [Custom Metrics](docs/custom-metrics.md)                               | Tracking additional data points            |
| [PulseMonitor Integration](docs/pulsemonitor.md)                       | Automated monitoring from multiple regions |
| [Visual Configuration Editor](https://uptime-monitor.org/configurator) | Web-based UI for configuring monitors      |

## Related Projects

- [UptimeMonitor-StatusPage](https://github.com/Rabbit-Company/UptimeMonitor-StatusPage) - Frontend status page
- [PulseMonitor](https://github.com/Rabbit-Company/PulseMonitor) - Automated pulse sender for multiple protocols
- [Visual Configuration Editor](https://uptime-monitor.org/configurator) - Web-based UI for configuring monitors

## Architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────┐
│  Your Services  │─────▶│  Uptime Monitor  │─────▶│  ClickHouse │
│  (send pulses)  │      │   (Bun server)   │      │  (storage)  │
└─────────────────┘      └──────────────────┘      └─────────────┘
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │    Notifications     │
                       │  Discord/Email/Ntfy  │
                       └──────────────────────┘
```

## License

[GPL-3.0](https://github.com/Rabbit-Company/UptimeMonitor-Server/blob/main/LICENSE)
