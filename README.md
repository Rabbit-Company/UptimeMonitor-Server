# 🔍 Uptime Monitor

A powerful, enterprise-grade uptime monitoring system with granular notification control, group-based monitoring strategies, custom metrics tracking, and comprehensive alerting across multiple channels.

## ✨ Features

- 🔄 **Pulse-Based Monitoring** - Receive heartbeat signals from your services
- 📊 **Group-Based Strategies** - Organize monitors into hierarchical groups with flexible health strategies
- 📈 **Custom Metrics** - Track up to 3 custom decimal values per monitor (e.g., player count, memory usage, CPU load)
- 🔔 **Granular Notifications** - Channel-based notification system with per-monitor/group control
- 📈 **Real-Time Status Pages** - Multiple customizable status pages for different audiences
- ⚡ **High Performance** - Built with Bun and ClickHouse for maximum throughput
- 🔒 **Production Ready** - Comprehensive validation, error handling, and monitoring

## 🔗 Related Projects

| Project                                                                                | Description                                             |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [UptimeMonitor-StatusPage](https://github.com/Rabbit-Company/UptimeMonitor-StatusPage) | Self-hosted status page frontend with real-time updates |
| [PulseMonitor](https://github.com/Rabbit-Company/PulseMonitor)                         | Automated pulse sending client                          |

> **Note:** This repository contains only the backend server. To display a public status page, you'll also need to deploy [UptimeMonitor-StatusPage](https://github.com/Rabbit-Company/UptimeMonitor-StatusPage).

## 🚀 Quick Start

### Docker Compose (Recommended)

1. **Clone the repository and navigate to the project directory:**

   ```bash
   git clone https://github.com/Rabbit-Company/UptimeMonitor-Server.git
   cd UptimeMonitor-Server
   ```

2. **Edit your configuration file:**

   Edit `config.toml` with your monitors, notification channels, and other settings (see [Configuration](#-configuration) below).

3. **Start the services:**

   ```bash
   docker compose up -d
   ```

   This will start:
   - **Uptime Monitor** on port `3000`
   - **ClickHouse** database (internal, not exposed)

4. **Verify the deployment:**

   ```bash
   # Check service status
   docker compose ps

   # View logs
   docker compose logs -f uptimemonitor

   # Test the health endpoint
   curl http://localhost:3000/health
   ```

## 📋 Configuration

### Basic Configuration (config.toml)

```toml
# Uptime Monitor Configuration

[clickhouse]
url = "http://uptime_user:uptime_password@clickhouse:8123/uptime_monitor"

[server]
port = 3000
# Available options: "direct" (no proxy), "cloudflare", "aws", "gcp", "azure", "vercel", "nginx", "development"
proxy = "direct"
# Optional: Set your own reload token. If not provided, one will be auto-generated at startup.
#reloadToken = ""

[logger]
level = 7

[missingPulseDetector]
# Check interval in seconds for detecting missing pulses (default: 5)
# Lower values detect outages faster but increase CPU usage
interval = 5

[selfMonitoring]
# Enable self-monitoring and automatic backfill
enabled = true

# ID of the self-monitor
id = "self-monitor"

# Health check interval in seconds (default: 3)
# Lower values detect outages faster but increase database load
interval = 3

# Backfill synthetic pulses for monitors that were healthy before downtime
# This prevents false downtime reports when the monitoring system itself is down
backfillOnRecovery = true

# Strategy for synthetic pulse latency:
# - "last-known": Use the last latency from before the downtime
# - "null": Don't set latency for synthetic pulses
latencyStrategy = "last-known"

# PulseMonitor instances configuration (https://github.com/Rabbit-Company/PulseMonitor)
# Define all PulseMonitor instances that can be deployed to different regions
# Each PulseMonitor connects via WebSocket using its token to receive monitor configurations
[[PulseMonitors]]
id = "US-WEST-1"
name = "US West 1 (Oregon)"
token = "tk_pulse_monitor_us_west_1"

[[PulseMonitors]]
id = "US-EAST-1"
name = "US East 1 (Virginia)"
token = "tk_pulse_monitor_us_east_1"

[[PulseMonitors]]
id = "EU-CENTRAL-1"
name = "EU Central 1 (Frankfurt)"
token = "tk_pulse_monitor_eu_central_1"

# Monitor definitions
[[monitors]]
id = "api-prod"
name = "Production API"
token = "tk_prod_api_abc123"
interval = 30 # Expects pulse every 30s
maxRetries = 0 # Zero tolerance - mark down immediately
resendNotification = 12 # Resend notification every 12 down checks
groupId = "production"
notificationChannels = ["critical"]
# This monitor will be checked by PulseMonitors in US-WEST-1 and EU-CENTRAL-1
pulseMonitors = ["US-WEST-1", "EU-CENTRAL-1"]

# Pulse configuration - defines how PulseMonitor should check this service
# All available configuration parameters are defined in https://github.com/Rabbit-Company/PulseMonitor
[monitors.pulse.http]
method = "GET"
url = "https://api.example.com/health"
timeout = 10

[[monitors]]
id = "api-staging"
name = "Staging API"
token = "tk_staging_api_def456"
interval = 60
maxRetries = 0
resendNotification = 12
groupId = "staging"
notificationChannels = []

[[monitors]]
id = "web-prod"
name = "Production Website"
token = "tk_prod_web_ghi789"
interval = 30
maxRetries = 0
resendNotification = 12
groupId = "production"
notificationChannels = []

[[monitors]]
id = "db-prod"
name = "Production Database"
token = "tk_prod_db_jkl012"
interval = 60
maxRetries = 0
resendNotification = 12
groupId = "production"
notificationChannels = []

# Custom metrics for database connections and query count
[monitors.custom1]
id = "connections"
name = "Active Connections"
unit = "connections"

[monitors.custom2]
id = "queries"
name = "Queries/sec"
unit = "qps"

[[monitors]]
id = "cdn-global"
name = "Global CDN"
token = "tk_cdn_mno345"
interval = 120
maxRetries = 0
resendNotification = 12
groupId = "infrastructure"
notificationChannels = []

# Custom metric for cache hit rate
[monitors.custom1]
id = "cache_hit_rate"
name = "Cache Hit Rate"
unit = "%"

[[monitors]]
id = "payment-gateway"
name = "Payment Gateway"
token = "tk_payment_pqr678"
interval = 30
maxRetries = 0
resendNotification = 12
groupId = "third-party"
notificationChannels = []

[[monitors]]
id = "game-server"
name = "Game Server"
token = "tk_game_server_xyz999"
interval = 10
maxRetries = 0
resendNotification = 12
groupId = "production"
notificationChannels = []

# Custom metrics for game server
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

# Group definitions
[[groups]]
id = "production"
name = "Production Services"
parentId = "all-services"
strategy = "percentage"
degradedThreshold = 50  # percentage - if less than 50% of children are up, group is down
interval = 60
notificationChannels = []

[[groups]]
id = "staging"
name = "Staging Services"
parentId = "all-services"
strategy = "any-up"
degradedThreshold = 0  # staging can be fully down without affecting overall status
interval = 60
notificationChannels = []

[[groups]]
id = "infrastructure"
name = "Infrastructure"
parentId = "all-services"
strategy = "all-up"
degradedThreshold = 80  # infrastructure should mostly be up
interval = 60
notificationChannels = []

[[groups]]
id = "third-party"
name = "Third Party Services"
strategy = "percentage"
degradedThreshold = 70
interval = 60
notificationChannels = []

[[groups]]
id = "all-services"
name = "All Services"
strategy = "percentage"
degradedThreshold = 75  # overall health threshold
interval = 60
notificationChannels = []

# Status page definitions
[[status_pages]]
id = "public"
name = "Public Status Page"
slug = "status"
items = ["all-services", "third-party"]  # show main group and third-party services

[[status_pages]]
id = "internal"
name = "Internal Status Page"
slug = "internal"
items = ["production", "staging", "infrastructure", "third-party"]  # show all groups

[[status_pages]]
id = "production-only"
name = "Production Status"
slug = "production"
items = ["production"]  # show only production group

# Notification Channel definitions

# Critical Notification Channel Configuration
[notifications.channels.critical]
id = "critical"
name = "Critical Production Alerts"
description = "High-priority alerts for production outages - sent to #alerts channel"
enabled = false

# Discord webhook configuration for critical alerts
[notifications.channels.critical.discord]
enabled = false
webhookUrl = "YOUR_DISCORD_WEBHOOK_HERE"
username = "🚨 Critical Alert Bot"
avatarUrl = "https://rabbit-company.com/images/logo.png"

# Email configuration for critical alerts
[notifications.channels.critical.email]
enabled = false
from = '"Rabbit Company" <info@rabbit-company.com>'
to = [""]

[notifications.channels.critical.email.smtp]
host = "mail.rabbit-company.com"
port = 465
secure = true
user = "info@rabbit-company.com"
pass = ""
```

## 📡 Sending Pulses

### Manual Pulse Sending

The pulse endpoint (`/v1/push/:token`) accepts the following optional query parameters:

- **`latency`** - Response time in milliseconds (capped at 600000ms/10 minutes)
- **`startTime`** - When the check started (ISO format or Unix timestamp)
- **`endTime`** - When the check completed (ISO format or Unix timestamp)
- **Custom metric parameters** - Use the configured `id` value for each custom metric

#### Timing Logic

- If both `startTime` and `endTime` are provided, latency is calculated automatically
- If `startTime` and `latency` are provided, `endTime` is calculated
- If `endTime` and `latency` are provided, `startTime` is calculated
- If only `latency` is provided, `endTime` is set to current time and `startTime` is calculated
- If no parameters are provided, the pulse is recorded with the current timestamp

#### Examples

```bash
# Simple pulse with no timing data
curl -X GET http://localhost:3000/v1/push/:token

# Send a pulse with latency (milliseconds)
curl -X GET http://localhost:3000/v1/push/:token?latency=125.5

# RECOMMENDED: Send all three parameters for maximum accuracy
curl -X GET http://localhost:3000/v1/push/:token?startTime=2025-10-15T10:00:00Z&endTime=2025-10-15T10:00:01.500Z&latency=1500

# Send a pulse with start and end times (latency calculated automatically)
curl -X GET http://localhost:3000/v1/push/:token?startTime=2025-10-15T10:00:00Z&endTime=2025-10-15T10:00:01Z

# Send a pulse with Unix timestamps
curl -X GET http://localhost:3000/v1/push/:token?startTime=1736928000000&endTime=1736928001500

# Send a pulse with start time and latency (end time calculated)
curl -X GET http://localhost:3000/v1/push/:token?startTime=2025-10-15T10:00:00Z&latency=1500
```

### Sending Custom Metrics

Custom metrics allow you to track additional numeric values alongside your pulses. Each monitor can have up to 3 custom metrics configured.

#### Configuration

Define custom metrics in your monitor configuration:

```toml
[[monitors]]
id = "game-server"
name = "Game Server"
token = "tk_game_server_xyz999"
interval = 10
maxRetries = 0
resendNotification = 12

[monitors.custom1]
id = "players"        # Query parameter name
name = "Player Count" # Display name
unit = "players"      # Optional unit

[monitors.custom2]
id = "tps"
name = "Ticks Per Second"
unit = "TPS"

[monitors.custom3]
id = "memory"
name = "Memory Usage"
unit = "MB"
```

#### Sending Custom Metrics via API

Use the configured `id` as the query parameter name:

```bash
# Send pulse with player count
curl -X GET "http://localhost:3000/v1/push/tk_game_server_xyz999?players=30"

# Send pulse with latency and all custom metrics
curl -X GET "http://localhost:3000/v1/push/tk_game_server_xyz999?latency=50&players=30&tps=19.8&memory=2048.5"

# You can also use generic names (custom1, custom2, custom3)
curl -X GET "http://localhost:3000/v1/push/tk_game_server_xyz999?custom1=30&custom2=19.8&custom3=2048.5"
```

#### Response Format

Custom metrics are included in status page and history responses:

```json
{
	"id": "game-server",
	"type": "monitor",
	"name": "Game Server",
	"status": "up",
	"latency": 50,
	"custom1": {
		"config": {
			"id": "players",
			"name": "Player Count",
			"unit": "players"
		},
		"value": 30
	},
	"custom2": {
		"config": {
			"id": "tps",
			"name": "Ticks Per Second",
			"unit": "TPS"
		},
		"value": 19.8
	},
	"custom3": {
		"config": {
			"id": "memory",
			"name": "Memory Usage",
			"unit": "MB"
		},
		"value": 2048.5
	}
}
```

#### History Endpoints

Custom metrics are aggregated in history data with min, max, and avg values:

```json
{
	"monitorId": "game-server",
	"type": "hourly",
	"customMetrics": {
		"custom1": { "id": "players", "name": "Player Count", "unit": "players" },
		"custom2": { "id": "tps", "name": "Ticks Per Second", "unit": "TPS" },
		"custom3": { "id": "memory", "name": "Memory Usage", "unit": "MB" }
	},
	"data": [
		{
			"timestamp": "2025-01-08T14:00:00Z",
			"uptime": 100,
			"latency_min": 45,
			"latency_max": 120,
			"latency_avg": 67.5,
			"custom1_min": 10,
			"custom1_max": 150,
			"custom1_avg": 45.3,
			"custom2_min": 18.5,
			"custom2_max": 20.0,
			"custom2_avg": 19.7,
			"custom3_min": 1800,
			"custom3_max": 2500,
			"custom3_avg": 2100.5
		}
	]
}
```

### Use Cases for Custom Metrics

- **Game Servers**: Track player count, TPS, memory usage
- **Database Servers**: Track active connections, query rate, replication lag
- **Web Servers**: Track request rate, error rate, queue depth
- **CDN/Cache**: Track hit rate, bandwidth, origin requests
- **Message Queues**: Track queue depth, consumer lag, throughput
- **IoT Devices**: Track sensor readings, battery level, signal strength

### Automated Pulse Sending

For automated pulse sending we recommend using [PulseMonitor](https://github.com/Rabbit-Company/PulseMonitor).
