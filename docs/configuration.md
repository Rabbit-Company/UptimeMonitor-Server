# Configuration Guide

Uptime Monitor uses a TOML configuration file. By default, it looks for `config.toml` in the current directory, or you can set the `CONFIG` environment variable to a custom path.

## Visual Configuration Editor

The easiest way to create or edit your configuration is using the [Visual Configuration Editor](https://uptime-monitor.org/configurator).

The Visual Configuration Editor allows you to:

- Start from scratch or import an existing config.toml
- Visually add monitors, groups, and status pages
- Configure custom metrics and notification channels
- Export your configuration back to TOML format

## Manual Configuration

If you prefer to edit the TOML file directly, here's the complete reference:

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

### Admin API

Enable REST API endpoints for managing monitors, groups, status pages, notification channels, and pulse monitors programmatically. All changes are persisted to `config.toml` and auto-reloaded. See the [Admin API Reference](admin-api.md) for complete endpoint documentation.

```toml
[adminAPI]
enabled = true
token = "your-admin-token"
```

| Field     | Required | Description                                          |
| --------- | -------- | ---------------------------------------------------- |
| `enabled` | Yes      | Set to `true` to activate admin endpoints            |
| `token`   | Yes      | Bearer token used to authenticate all admin requests |

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

## Monitors

Define the services you want to track:

```toml
[[monitors]]
id = "api-prod"
name = "Production API"
token = "secret-token"
interval = 30
maxRetries = 2
resendNotification = 12
children = ["sub-service-1", "sub-service-2"]
notificationChannels = ["critical"]
pulseMonitors = ["US-WEST-1"]
# dependencies = ["database"]        # Suppress notifications if dependency is down
```

| Field                  | Required | Default | Description                                                                                                                                |
| ---------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                   | Yes      | -       | Unique identifier                                                                                                                          |
| `name`                 | Yes      | -       | Display name                                                                                                                               |
| `token`                | Yes      | -       | Secret token for sending pulses (must be unique)                                                                                           |
| `interval`             | Yes      | -       | Pulse interval in seconds (see [Pulses](pulses.md))                                                                                        |
| `maxRetries`           | Yes      | -       | Missed pulses before marking down (see [Pulses](pulses.md))                                                                                |
| `resendNotification`   | Yes      | -       | Resend notification every N down checks (0 = never)                                                                                        |
| `children`             | No       | `[]`    | Array of child monitor/group IDs held by this monitor                                                                                      |
| `notificationChannels` | No       | `[]`    | Array of notification channel IDs                                                                                                          |
| `pulseMonitors`        | No       | `[]`    | Array of PulseMonitor IDs for automated checking                                                                                           |
| `dependencies`         | No       | `[]`    | Array of monitor/group IDs. If any dependency is down, notifications for this monitor are suppressed (see [Dependencies](dependencies.md)) |

### Dependency-Based Notification Suppression

Monitors and groups can declare dependencies on other monitors or groups using the `dependencies` array.
When any dependency is down, notifications for the dependent entity are suppressed - preventing
notification storms when upstream infrastructure fails. See [Dependencies](dependencies.md) for full documentation.

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

Organize monitors and other groups hierarchically with health strategies. Structure is defined **top-down** - each group lists its children:

```toml
[[groups]]
id = "production"
name = "Production Services"
strategy = "percentage"
degradedThreshold = 50
interval = 60
resendNotification = 12
children = ["api-prod", "web-prod", "db-prod"]
notificationChannels = ["critical"]
# dependencies = ["network"]       # Suppress notifications if dependency is down
```

| Field                  | Required | Default | Description                                                                                                                              |
| ---------------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | Yes      | -       | Unique identifier                                                                                                                        |
| `name`                 | Yes      | -       | Display name                                                                                                                             |
| `strategy`             | Yes      | -       | `"any-up"`, `"all-up"`, or `"percentage"`                                                                                                |
| `degradedThreshold`    | Yes      | -       | Percentage threshold (0-100) for degraded status                                                                                         |
| `interval`             | Yes      | -       | Used for uptime calculations                                                                                                             |
| `resendNotification`   | No       | `0`     | Resend notification every N down checks                                                                                                  |
| `children`             | No       | `[]`    | Array of child monitor/group IDs held by this group                                                                                      |
| `notificationChannels` | No       | `[]`    | Array of notification channel IDs                                                                                                        |
| `dependencies`         | No       | `[]`    | Array of monitor/group IDs. If any dependency is down, notifications for this group are suppressed (see [Dependencies](dependencies.md)) |

See [Groups & Strategies](groups.md) for detailed documentation on strategies, nested groups, and uptime calculation.

## Status Pages

```toml
[[status_pages]]
id = "public"
name = "Public Status"
slug = "status"
items = ["production", "infrastructure"]
# leafItems = ["europe"]
# password = "optional-password"
# reports = false
```

| Field       | Required | Description                                                                |
| ----------- | -------- | -------------------------------------------------------------------------- |
| `id`        | Yes      | Unique identifier                                                          |
| `name`      | Yes      | Display name                                                               |
| `slug`      | Yes      | URL path (lowercase, hyphens)                                              |
| `items`     | Yes      | Array of monitor/group IDs to display                                      |
| `leafItems` | No       | Array of IDs to treat as leaf nodes (children not expanded on status page) |
| `password`  | No       | Password to protect the page (minimum 8 characters)                        |
| `reports`   | No       | Enable report export endpoints for this status page                        |

## Notification Channels

```toml
[notifications.channels.critical]
id = "critical"
name = "Critical Alerts"
enabled = true

[notifications.channels.critical.discord]
enabled = true
webhookUrl = "https://discord.com/api/webhooks/..."
```

See [Notifications](notifications.md) for all provider configurations.

## PulseMonitors

```toml
[[PulseMonitors]]
id = "US-WEST-1"
name = "US West (Oregon)"
token = "tk_pulse_us_west"
```

See [PulseMonitor Integration](pulsemonitor.md) for setup and protocol configuration.

## Self-Monitoring

```toml
[selfMonitoring]
enabled = true
id = "self-monitor"
interval = 3
backfillOnRecovery = true
latencyStrategy = "last-known"
```

| Field                | Default        | Description                                                |
| -------------------- | -------------- | ---------------------------------------------------------- |
| `enabled`            | `false`        | Enable self-monitoring                                     |
| `id`                 | `self-monitor` | Monitor ID for self-checks                                 |
| `interval`           | `3`            | Check interval in seconds                                  |
| `backfillOnRecovery` | `true`         | Backfill synthetic pulses after recovery                   |
| `latencyStrategy`    | `last-known`   | Strategy for synthetic pulse latency: `last-known`, `null` |

## Missing Pulse Detector

```toml
[missingPulseDetector]
interval = 5
```

| Field      | Default | Description                            |
| ---------- | ------- | -------------------------------------- |
| `interval` | `5`     | Check interval in seconds (default: 5) |

## Environment Variables

| Variable   | Description                                    |
| ---------- | ---------------------------------------------- |
| `CONFIG`   | Path to config file (default: `./config.toml`) |
| `NODE_ENV` | Set to `production` for production mode        |
| `TZ`       | Timezone (default: `UTC`)                      |

## Validation

The configuration is validated at startup. Common errors:

- **Duplicate IDs/tokens** - All IDs and tokens must be unique
- **Invalid references** - Group/notification channel IDs must exist
- **Circular references** - Groups cannot reference themselves as parents
- **Missing required fields** - All required fields must be present
