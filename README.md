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

## 🚀 Quick Start

## 📋 Configuration

### Basic Configuration (config.toml)

```toml
# Database Configuration
[clickhouse]
url = "http://uptime_user:uptime_password@localhost:8123/uptime_monitor"

# Server Configuration
[server]
port = 3000

# Logging Configuration
[logger]
level = 4  # 0=silent, 7=verbose

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

# Monitor Definition
[[monitors]]
id = "api-prod"
name = "Production API"
token = "secure-random-token"
interval = 60  # Expect pulse every 60 seconds
maxRetries = 3
resendNotification = 5
notificationChannels = ["critical"]

# Monitor with Custom Metrics
[[monitors]]
id = "game-server"
name = "Game Server"
token = "tk_game_server_xyz999"
interval = 10
maxRetries = 0
resendNotification = 3
groupId = "production"
notificationChannels = []

# Define custom metric 1
[monitors.custom1]
id = "players"        # Used in API requests as query parameter name
name = "Player Count" # Human-readable display name
unit = "players"      # Optional unit for display

# Define custom metric 2
[monitors.custom2]
id = "tps"
name = "Ticks Per Second"
unit = "TPS"

# Define custom metric 3
[monitors.custom3]
id = "memory"
name = "Memory Usage"
unit = "MB"

# Group Definition
[[groups]]
id = "production"
name = "Production Services"
strategy = "any-up"  # UP if any child is up
degradedThreshold = 90
notificationChannels = ["critical"]

# Status Page
[[status_pages]]
id = "public"
name = "Service Status"
slug = "status"
items = ["production"]

# Notifications

# Critical Discord Notifications
[notifications.channels.critical]
id = "critical"
name = "Critical Production Alerts"
enabled = true

[notifications.channels.critical.discord]
enabled = true
webhookUrl = "https://discord.com/api/webhooks/YOUR_WEBHOOK_URL"
username = "🚨 Critical Alert Bot"

[notifications.channels.critical.discord.mentions]
everyone = true
roles = ["187949199596191745"]  # @DevOps role ID

# Critical Email Notifications
[notifications.channels.critical.email]
enabled = true
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
resendNotification = 3

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
