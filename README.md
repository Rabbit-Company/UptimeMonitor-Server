# 🔍 Uptime Monitor

A powerful, enterprise-grade uptime monitoring system with granular notification control, group-based monitoring strategies, and comprehensive alerting across multiple channels.

## ✨ Features

- 🔄 **Pulse-Based Monitoring** - Receive heartbeat signals from your services
- 📊 **Group-Based Strategies** - Organize monitors into hierarchical groups with flexible health strategies
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

```bash
# Send a pulse with latency
curl -X GET http://localhost:3000/v1/push/:token?latency=15.10
```

### Automated Pulse Sending

For automated pulse sending we recommend using [PulseMonitor](https://github.com/Rabbit-Company/PulseMonitor).
