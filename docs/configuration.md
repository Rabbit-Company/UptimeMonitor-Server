# Configuration Guide

Uptime Monitor uses a TOML configuration file. By default, it looks for `config.toml` in the current directory, or you can set the `CONFIG` environment variable to a custom path.

## Minimal Configuration

The smallest working configuration:

```toml
[clickhouse]
url = "http://uptime_user:uptime_password@clickhouse:8123/uptime_monitor"

[[monitors]]
id = "my-service"
name = "My Service"
token = "my-secret-token"
interval = 30
maxRetries = 0
resendNotification = 0

[[status_pages]]
id = "main"
name = "Status"
slug = "status"
items = ["my-service"]
```

## Configuration Sections

### ClickHouse Connection

```toml
[clickhouse]
url = "http://user:password@host:8123/database"
```

| Field | Required | Description                                |
| ----- | -------- | ------------------------------------------ |
| `url` | Yes      | ClickHouse connection URL with credentials |

### Server Settings

```toml
[server]
port = 3000
proxy = "direct"
reloadToken = "your-reload-token"
```

| Field         | Default        | Description                                                                                           |
| ------------- | -------------- | ----------------------------------------------------------------------------------------------------- |
| `port`        | `3000`         | HTTP server port                                                                                      |
| `proxy`       | `"direct"`     | IP extraction preset: `direct`, `cloudflare`, `aws`, `gcp`, `azure`, `vercel`, `nginx`, `development` |
| `reloadToken` | Auto-generated | Token for `/v1/reload/:token` endpoint                                                                |

### Logger

```toml
[logger]
level = 4
```

| Level | Name    |
| ----- | ------- |
| 0     | ERROR   |
| 1     | WARN    |
| 2     | AUDIT   |
| 3     | INFO    |
| 4     | HTTP    |
| 5     | DEBUG   |
| 6     | VERBOSE |
| 7     | SILLY   |

### Missing Pulse Detector

```toml
[missingPulseDetector]
interval = 5
```

| Field      | Default | Description                                        |
| ---------- | ------- | -------------------------------------------------- |
| `interval` | `5`     | How often (in seconds) to check for missing pulses |

### Self-Monitoring

Automatically backfills data when the monitor itself was down.

```toml
[selfMonitoring]
enabled = true
id = "self-monitor"
interval = 3
backfillOnRecovery = true
latencyStrategy = "last-known"
```

| Field                | Default          | Description                                                              |
| -------------------- | ---------------- | ------------------------------------------------------------------------ |
| `enabled`            | `false`          | Enable self-monitoring                                                   |
| `id`                 | `"self-monitor"` | ID for the self-monitor                                                  |
| `interval`           | `3`              | Health check interval in seconds                                         |
| `backfillOnRecovery` | `false`          | Generate synthetic pulses for monitors that were healthy before downtime |
| `latencyStrategy`    | `"last-known"`   | `"last-known"` uses previous latency, `"null"` leaves it empty           |

## Monitors

```toml
[[monitors]]
id = "api-prod"
name = "Production API"
token = "tk_prod_api_abc123"
interval = 30
maxRetries = 0
resendNotification = 12
groupId = "production"
notificationChannels = ["critical"]
pulseMonitors = ["US-WEST-1"]
```

| Field                  | Required | Default | Description                                         |
| ---------------------- | -------- | ------- | --------------------------------------------------- |
| `id`                   | Yes      | —       | Unique identifier                                   |
| `name`                 | Yes      | —       | Display name                                        |
| `token`                | Yes      | —       | Secret token for pulse authentication               |
| `interval`             | Yes      | —       | Expected pulse interval in seconds                  |
| `maxRetries`           | Yes      | —       | Missed pulses before marking down (0 = immediate)   |
| `resendNotification`   | Yes      | —       | Resend notification every N down checks (0 = never) |
| `groupId`              | No       | —       | Parent group ID                                     |
| `notificationChannels` | No       | `[]`    | Array of notification channel IDs                   |
| `pulseMonitors`        | No       | `[]`    | Array of PulseMonitor IDs for automated checking    |

### Custom Metrics

Each monitor can track up to 3 custom numeric values:

```toml
[[monitors]]
id = "game-server"
name = "Game Server"
token = "tk_game"
interval = 10
maxRetries = 0
resendNotification = 0

[monitors.custom1]
id = "players"
name = "Player Count"
unit = "players"

[monitors.custom2]
id = "tps"
name = "Ticks Per Second"
unit = "TPS"

[monitors.custom3]
id = "memory"
name = "Memory Usage"
unit = "MB"
```

### Pulse Configuration (for [PulseMonitor](https://github.com/Rabbit-Company/PulseMonitor))

Define how PulseMonitor should check this service:

```toml
[[monitors]]
id = "web"
name = "Website"
token = "tk_web"
interval = 30
maxRetries = 0
resendNotification = 0
pulseMonitors = ["US-WEST-1"]

[monitors.pulse.http]
method = "GET"
url = "https://example.com/health"
timeout = 10
```

See [PulseMonitor Integration](pulsemonitor.md) for all supported protocols.

## Groups

Organize monitors hierarchically with health strategies:

```toml
[[groups]]
id = "production"
name = "Production Services"
strategy = "percentage"
degradedThreshold = 50
interval = 60
resendNotification = 12
parentId = "all-services"
notificationChannels = ["critical"]
```

| Field                  | Required | Default | Description                                      |
| ---------------------- | -------- | ------- | ------------------------------------------------ |
| `id`                   | Yes      | —       | Unique identifier                                |
| `name`                 | Yes      | —       | Display name                                     |
| `strategy`             | Yes      | —       | `"any-up"`, `"all-up"`, or `"percentage"`        |
| `degradedThreshold`    | Yes      | —       | Percentage threshold (0-100) for degraded status |
| `interval`             | Yes      | —       | Used for uptime calculations                     |
| `resendNotification`   | No       | `0`     | Resend notification every N down checks          |
| `parentId`             | No       | —       | Parent group ID for nesting                      |
| `notificationChannels` | No       | `[]`    | Array of notification channel IDs                |

### Strategy Reference

| Strategy     | UP              | DEGRADED       | DOWN              |
| ------------ | --------------- | -------------- | ----------------- |
| `any-up`     | ≥1 child up     | —              | All children down |
| `all-up`     | All children up | —              | Any child down    |
| `percentage` | 100% up         | ≥threshold% up | <threshold% up    |

## Status Pages

```toml
[[status_pages]]
id = "public"
name = "Public Status"
slug = "status"
items = ["production", "third-party"]
# password = "optional-password"
```

| Field      | Required | Description                                                         |
| ---------- | -------- | ------------------------------------------------------------------- |
| `id`       | Yes      | Unique identifier                                                   |
| `name`     | Yes      | Display name                                                        |
| `slug`     | Yes      | URL path (lowercase, hyphens, numbers only)                         |
| `items`    | Yes      | Array of monitor and/or group IDs                                   |
| `password` | No       | Optional password to protect the status page (minimum 8 characters) |

### Accessing Status Pages

```
GET /v1/status/:slug
GET /v1/status/:slug/summary
```

#### Public status pages

If no `password` is configured, the status page is publicly accessible and does not require authentication.

#### Password-protected status pages

If a `password` is configured, requests must include an `Authorization` header using a Bearer token.

The Bearer token must be the **BLAKE2b-512 hash of the password**.

## PulseMonitors

Define remote monitoring agents:

```toml
[[PulseMonitors]]
id = "US-WEST-1"
name = "US West (Oregon)"
token = "tk_pulse_us_west"

[[PulseMonitors]]
id = "EU-CENTRAL-1"
name = "EU Central (Frankfurt)"
token = "tk_pulse_eu_central"
```

| Field   | Required | Description                                |
| ------- | -------- | ------------------------------------------ |
| `id`    | Yes      | Unique identifier (referenced by monitors) |
| `name`  | Yes      | Display name                               |
| `token` | Yes      | WebSocket authentication token             |

## Notifications

See [Notifications Guide](notifications.md) for complete setup.

```toml
[notifications.channels.critical]
id = "critical"
name = "Critical Alerts"
enabled = true

[notifications.channels.critical.discord]
enabled = true
webhookUrl = "https://discord.com/api/webhooks/..."
```

## Hot Reloading

Reload configuration without restart:

```bash
curl http://localhost:3000/v1/reload/your-reload-token
```

The reload token is shown in logs at startup if not explicitly configured.

## Environment Variables

| Variable   | Description                                    |
| ---------- | ---------------------------------------------- |
| `CONFIG`   | Path to config file (default: `./config.toml`) |
| `NODE_ENV` | Set to `production` for production mode        |
| `TZ`       | Timezone (default: `UTC`)                      |

## Validation

The configuration is validated at startup. Common errors:

- **Duplicate IDs/tokens** — All IDs and tokens must be unique
- **Invalid references** — Group/notification channel IDs must exist
- **Circular references** — Groups cannot reference themselves as parents
- **Missing required fields** — All required fields must be present
