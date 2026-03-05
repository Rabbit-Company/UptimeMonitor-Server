# PulseMonitor Integration

[PulseMonitor](https://github.com/Rabbit-Company/PulseMonitor) is a lightweight agent that automatically sends pulses to Uptime Monitor. Deploy it in multiple regions for distributed monitoring.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  PulseMonitor   │     │  PulseMonitor   │     │  PulseMonitor   │
│   US-WEST-1     │     │   US-EAST-1     │     │  EU-CENTRAL-1   │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │    WebSocket          │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │    Uptime Monitor      │
                    │       Server           │
                    └────────────────────────┘
```

## Server Configuration

### 1. Define PulseMonitor Instances

```toml
[[PulseMonitors]]
id = "US-WEST-1"
name = "US West (Oregon)"
token = "tk_pulse_us_west_secret"

[[PulseMonitors]]
id = "US-EAST-1"
name = "US East (Virginia)"
token = "tk_pulse_us_east_secret"

[[PulseMonitors]]
id = "EU-CENTRAL-1"
name = "EU Central (Frankfurt)"
token = "tk_pulse_eu_central_secret"
```

### 2. Assign PulseMonitors to Monitors

```toml
[[monitors]]
id = "api-prod"
name = "Production API"
token = "tk_api_prod"
interval = 30
maxRetries = 0
resendNotification = 0
pulseMonitors = ["US-WEST-1", "EU-CENTRAL-1"]  # Which agents should check this

[monitors.pulse.http]
method = "GET"
url = "https://api.example.com/health"
timeout = 10
```

## Supported Protocols

### HTTP/HTTPS

```toml
[monitors.pulse.http]
method = "GET"          # GET, POST, or HEAD
url = "https://api.example.com/health"
timeout = 10            # Seconds
headers = [
  { "Authorization" = "Bearer token123" },
  { "X-Custom-Header" = "value" }
]
```

### WebSocket

```toml
[monitors.pulse.ws]
url = "wss://ws.example.com/socket"
timeout = 3
```

### TCP

```toml
[monitors.pulse.tcp]
host = "db.example.com"
port = 5432
timeout = 5
```

### UDP

```toml
[monitors.pulse.udp]
host = "dns.example.com"
port = 53
timeout = 3
payload = "ping"
expectResponse = false
```

### ICMP (Ping)

```toml
[monitors.pulse.icmp]
host = "server.example.com"
timeout = 2
```

### SMTP

```toml
[monitors.pulse.smtp]
url = "smtps://user:pass@mail.example.com:465"
```

### IMAP

```toml
[monitors.pulse.imap]
server = "imap.example.com"
port = 993
username = "user@example.com"
password = "secret"
```

### MySQL

```toml
[monitors.pulse.mysql]
url = "mysql://user:pass@db.example.com:3306/database"
timeout = 3
```

### MSSQL

```toml
[monitors.pulse.mssql]
url = "sqlserver://user:pass@db.example.com:1433;database=mydb"
timeout = 3
```

### PostgreSQL

```toml
[monitors.pulse.postgresql]
url = "postgresql://user:pass@db.example.com:5432/database"
timeout = 3
useTls = true
```

### Redis

```toml
[monitors.pulse.redis]
url = "redis://user:pass@redis.example.com:6379"
timeout = 3
```

### SNMP

Monitor network devices via SNMP (Simple Network Management Protocol). Supports SNMPv1, SNMPv2c, and SNMPv3 with custom OID mapping to `{custom1}`, `{custom2}`, and `{custom3}` placeholders.

**SNMPv2c — Router with CPU and memory monitoring:**

```toml
[monitors.pulse.snmp]
host = "10.0.0.1"
version = "2c"
community = "monitoring"

[monitors.pulse.snmp.oids]
custom1 = "1.3.6.1.4.1.2021.11.11.0"
custom2 = "1.3.6.1.4.1.2021.4.6.0"
```

**SNMPv3 — Secure switch with authPriv:**

```toml
[monitors.pulse.snmp]
host = "10.0.0.1"
version = "3"
username = "snmpv3user"
authPassword = "MyAuthPass"
authProtocol = "sha256"
privPassword = "MyPrivPass"
privCipher = "aes128"
securityLevel = "authPriv"

[monitors.pulse.snmp.oids]
custom1 = "1.3.6.1.4.1.9.9.13.1.3.1.3.1006"
```

| Option          | Type    | Default               | Description                                              |
| --------------- | ------- | --------------------- | -------------------------------------------------------- |
| `host`          | string  | -                     | Target hostname or IP address (required)                 |
| `port`          | integer | 161                   | SNMP port                                                |
| `timeout`       | integer | 3                     | Response timeout in seconds                              |
| `version`       | string  | `"3"`                 | SNMP version: `1`, `2c`, or `3`                          |
| `community`     | string  | `"public"`            | Community string (v1/v2c only)                           |
| `username`      | string  | -                     | USM username (v3 only)                                   |
| `authPassword`  | string  | -                     | Authentication password (v3 only)                        |
| `authProtocol`  | string  | `"sha256"`            | Auth protocol: md5, sha1, sha224, sha256, sha384, sha512 |
| `privPassword`  | string  | -                     | Privacy password (v3 authPriv only)                      |
| `privCipher`    | string  | `"aes128"`            | Privacy cipher: des, aes128, aes192, aes256              |
| `securityLevel` | string  | `"authPriv"`          | Security level: noAuthNoPriv, authNoPriv, authPriv       |
| `oid`           | string  | `"1.3.6.1.2.1.1.3.0"` | Primary OID for availability check (sysUpTime)           |
| `oids`          | object  | -                     | Map of placeholder name → OID for custom values          |

OIDs must be in numeric dot-notation (e.g., `1.3.6.1.2.1.1.3.0`). MIB names are not supported. Entries named `custom1`, `custom2`, or `custom3` populate the corresponding custom metric fields.

### Minecraft Java

```toml
[monitors.pulse.minecraft-java]
host = "mc.example.com"
port = 25565
timeout = 3

# Optional: define a custom metric (custom1) to track the current online player count.
[monitors.custom1]
id = "players"
name = "Player Count"
unit = "players"
```

### Minecraft Bedrock

```toml
[monitors.pulse.minecraft-bedrock]
host = "bedrock.example.com"
port = 19132
timeout = 3

# Optional: define a custom metric (custom1) to track the current online player count.
[monitors.custom1]
id = "players"
name = "Player Count"
unit = "players"
```

## Pulse Interval Calculation

The server automatically calculates the pulse interval for PulseMonitor:

```
pulse_interval = max(3, floor(monitor.interval / 3))
```

For a monitor with `interval = 30`:

- PulseMonitor checks every `max(3, 30/3) = 10` seconds
- This ensures multiple checks within each monitoring interval

## WebSocket Protocol

PulseMonitor connects via WebSocket and receives configuration updates.

### Connection

```
ws://uptime-monitor:3000/ws
```

### Subscribe

```json
{
	"action": "subscribe",
	"token": "tk_pulse_us_west_secret"
}
```

### Configuration Response

```json
{
	"action": "subscribed",
	"pulseMonitorId": "US-WEST-1",
	"pulseMonitorName": "US West (Oregon)",
	"data": {
		"monitors": [
			{
				"enabled": true,
				"name": "Production API",
				"token": "tk_api_prod",
				"interval": 10,
				"debug": true,
				"http": {
					"method": "GET",
					"url": "https://api.example.com/health",
					"timeout": 10
				}
			}
		]
	},
	"timestamp": "2025-01-15T10:30:00.000Z"
}
```

### Configuration Updates

When the server configuration is reloaded, all connected PulseMonitors receive updated configurations:

```json
{
  "action": "config-update",
  "data": {
    "monitors": [...]
  },
  "timestamp": "2025-01-15T10:35:00.000Z"
}
```

## Deploying PulseMonitor

### Docker

```bash
docker run -d \
  --name pulsemonitor \
  -e PULSE_SERVER_URL="http://localhost:3000" \
  -e PULSE_TOKEN="tk_pulse_us_west_secret" \
  rabbitcompany/pulsemonitor:latest
```

### Docker Compose

```yaml
services:
  pulsemonitor:
    image: rabbitcompany/pulsemonitor:latest
    environment:
      - PULSE_SERVER_URL=http://localhost:3000
      - PULSE_TOKEN=tk_pulse_eu_central_secret
    restart: unless-stopped
    ulimits:
      nproc: 65535
      nofile:
        soft: 65535
        hard: 65535
```

### Binary

```bash
# Set environment variables (.env prefered)
export PULSE_SERVER_URL=http://localhost:3000
export PULSE_TOKEN=your_token_here

# Download the binary
wget https://github.com/Rabbit-Company/PulseMonitor/releases/latest/download/pulsemonitor-$(uname -m)-gnu
# Set file permissions
sudo chmod 755 pulsemonitor-$(uname -m)-gnu
# Place the binary to `/usr/local/bin`
sudo mv pulsemonitor-$(uname -m)-gnu /usr/local/bin/pulsemonitor
# Start the monitor
pulsemonitor
```

## Multi-Region Setup Example

### Server Configuration

```toml
# Define regions
[[PulseMonitors]]
id = "US-WEST-1"
name = "US West (Oregon)"
token = "tk_pulse_us_west"

[[PulseMonitors]]
id = "US-EAST-1"
name = "US East (Virginia)"
token = "tk_pulse_us_east"

[[PulseMonitors]]
id = "EU-WEST-1"
name = "EU West (Ireland)"
token = "tk_pulse_eu_west"

[[PulseMonitors]]
id = "AP-SOUTH-1"
name = "Asia Pacific (Mumbai)"
token = "tk_pulse_ap_south"

# Global service - check from all regions
[[monitors]]
id = "global-api"
name = "Global API"
token = "tk_global_api"
interval = 30
maxRetries = 0
resendNotification = 0
pulseMonitors = ["US-WEST-1", "US-EAST-1", "EU-WEST-1", "AP-SOUTH-1"]

[monitors.pulse.http]
url = "https://api.example.com/health"
timeout = 10

# US-only service
[[monitors]]
id = "us-api"
name = "US API"
token = "tk_us_api"
interval = 30
maxRetries = 0
resendNotification = 0
pulseMonitors = ["US-WEST-1", "US-EAST-1"]

[monitors.pulse.http]
url = "https://us.api.example.com/health"
timeout = 10

# EU-only service
[[monitors]]
id = "eu-api"
name = "EU API"
token = "tk_eu_api"
interval = 30
maxRetries = 0
resendNotification = 0
pulseMonitors = ["EU-WEST-1"]

[monitors.pulse.http]
url = "https://eu.api.example.com/health"
timeout = 10
```

### Deployment

Deploy PulseMonitor agents in each region:

```yaml
# docker-compose.yml for US West
services:
  pulsemonitor:
    image: rabbitcompany/pulsemonitor:latest
    environment:
      - PULSE_SERVER_URL=http://localhost:3000
      - PULSE_TOKEN=tk_pulse_us_west
    restart: unless-stopped
    ulimits:
      nproc: 65535
      nofile:
        soft: 65535
        hard: 65535
```

## Security Best Practices

### 1. Use unique tokens per region

Each PulseMonitor should have a unique token. This allows you to:

- Revoke access per region
- Track which region sent each pulse
- Limit configuration exposure

### 2. Use WSS in production

Always use secure WebSocket connections:

```
wss://monitor.example.com/ws
```

### 3. Rotate tokens periodically

Change tokens periodically and after any potential compromise:

```toml
[[PulseMonitors]]
id = "US-WEST-1"
token = "tk_pulse_us_west_2025_01"  # Include rotation date
```

### 4. Monitor PulseMonitor health

Add a status page item or separate monitoring for your PulseMonitor instances themselves.

## Troubleshooting

### PulseMonitor not connecting

1. Verify the WebSocket URL is correct
2. Check the token matches exactly
3. Ensure the server is accessible from the PulseMonitor location
4. Check firewall rules for WebSocket connections

### Configuration not received

1. Ensure the PulseMonitor is listed in `[[PulseMonitors]]`
2. Check that monitors have `pulseMonitors` array including this agent
3. Reload server config: `curl http://server/v1/reload/token`

### Pulses not being recorded

1. Verify the monitor token is correct in `monitors.pulse` config
2. Check the pulse endpoint is not rate-limited
3. Look for errors in both server and PulseMonitor logs

### High latency in pulse data

1. The PulseMonitor location may have network issues to the target
2. Consider adding more regions for redundancy
3. Check if the target service is actually slow
