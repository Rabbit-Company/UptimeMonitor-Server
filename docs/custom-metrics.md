# Custom Metrics

Track up to 3 additional numeric values per monitor alongside latency. Custom metrics are sent as part of [pulses](pulses.md). Useful for player counts, connection pools, queue depths, and more.

## Configuration

Define custom metrics in your monitor configuration:

```toml
[[monitors]]
id = "game-server"
name = "Game Server"
token = "tk_game"
interval = 10
maxRetries = 0
resendNotification = 0

[monitors.custom1]
id = "players"        # Parameter name in API calls
name = "Player Count" # Display name
unit = "players"      # Optional unit label

[monitors.custom2]
id = "tps"
name = "Ticks Per Second"
unit = "TPS"

[monitors.custom3]
id = "memory"
name = "Memory Usage"
unit = "MB"
```

| Field  | Required | Description                                          |
| ------ | -------- | ---------------------------------------------------- |
| `id`   | Yes      | Query parameter name (letters, numbers, underscores) |
| `name` | Yes      | Human-readable display name                          |
| `unit` | No       | Unit label for display (e.g., "MB", "conn", "%")     |

## Sending Custom Metrics

### Using Configured IDs

```bash
curl "http://localhost:3000/v1/push/tk_game?players=42&tps=19.8&memory=2048"
```

### Using Generic Names

```bash
curl "http://localhost:3000/v1/push/tk_game?custom1=42&custom2=19.8&custom3=2048"
```

### With Latency

```bash
curl "http://localhost:3000/v1/push/tk_game?latency=15&players=42&tps=19.8"
```

### Via WebSocket

```json
{
	"action": "push",
	"token": "tk_game",
	"latency": 15,
	"players": 42,
	"tps": 19.8,
	"memory": 2048
}
```

## Reading Custom Metrics

### Current Status

```bash
curl http://localhost:3000/v1/status/status
```

**Response:**

```json
{
	"items": [
		{
			"id": "game-server",
			"type": "monitor",
			"name": "Game Server",
			"status": "up",
			"latency": 15,
			"custom1": {
				"config": {
					"id": "players",
					"name": "Player Count",
					"unit": "players"
				},
				"value": 42
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
				"value": 2048
			}
		}
	]
}
```

### History Data

Custom metrics are aggregated with min, max, and avg values:

```bash
curl http://localhost:3000/v1/monitors/game-server/history/hourly
```

**Response:**

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
			"timestamp": "2025-01-15T10:00:00Z",
			"uptime": 100,
			"latency_min": 10,
			"latency_max": 25,
			"latency_avg": 15.3,
			"custom1_min": 20,
			"custom1_max": 85,
			"custom1_avg": 45.7,
			"custom2_min": 18.5,
			"custom2_max": 20.0,
			"custom2_avg": 19.6,
			"custom3_min": 1800,
			"custom3_max": 2500,
			"custom3_avg": 2100
		}
	]
}
```

## WebSocket Events

Custom metrics are included in real-time pulse events:

```json
{
	"action": "pulse",
	"data": {
		"slug": "status",
		"monitorId": "game-server",
		"status": "up",
		"latency": 15,
		"custom1": 42,
		"custom2": 19.8,
		"custom3": 2048,
		"timestamp": "2025-01-15T10:30:00.000Z"
	}
}
```

## Use Cases

### Game Servers

```toml
[monitors.custom1]
id = "players"
name = "Online Players"
unit = "players"

[monitors.custom2]
id = "tps"
name = "Server TPS"
unit = "TPS"

[monitors.custom3]
id = "memory"
name = "Memory Used"
unit = "MB"
```

### Database Servers

```toml
[monitors.custom1]
id = "connections"
name = "Active Connections"
unit = "conn"

[monitors.custom2]
id = "qps"
name = "Queries/Second"
unit = "qps"

[monitors.custom3]
id = "replication_lag"
name = "Replication Lag"
unit = "ms"
```

### Web Servers

```toml
[monitors.custom1]
id = "requests"
name = "Requests/Second"
unit = "rps"

[monitors.custom2]
id = "error_rate"
name = "Error Rate"
unit = "%"

[monitors.custom3]
id = "queue_depth"
name = "Request Queue"
unit = "requests"
```

### Message Queues

```toml
[monitors.custom1]
id = "queue_size"
name = "Queue Depth"
unit = "messages"

[monitors.custom2]
id = "throughput"
name = "Throughput"
unit = "msg/s"

[monitors.custom3]
id = "consumer_lag"
name = "Consumer Lag"
unit = "messages"
```

### CDN / Cache

```toml
[monitors.custom1]
id = "hit_rate"
name = "Cache Hit Rate"
unit = "%"

[monitors.custom2]
id = "bandwidth"
name = "Bandwidth"
unit = "Mbps"

[monitors.custom3]
id = "origin_requests"
name = "Origin Requests"
unit = "req/s"
```

### IoT Devices

```toml
[monitors.custom1]
id = "temperature"
name = "Temperature"
unit = "°C"

[monitors.custom2]
id = "battery"
name = "Battery Level"
unit = "%"

[monitors.custom3]
id = "signal"
name = "Signal Strength"
unit = "dBm"
```

## Data Types

Custom metrics accept any numeric value:

- Integers: `42`, `-10`, `1000000`
- Decimals: `19.8`, `0.001`, `99.99`
- Negative values: `-5.5`

Non-numeric values are ignored (no error, just not stored).

## Data Retention

Custom metrics follow the same retention as latency data:

| Table           | Retention | Aggregation            |
| --------------- | --------- | ---------------------- |
| `pulses`        | ~24 hours | Raw values             |
| `pulses_hourly` | ~90 days  | min, max, avg per hour |
| `pulses_daily`  | Forever   | min, max, avg per day  |

## Best Practices

### 1. Choose meaningful IDs

Use short, descriptive IDs that make sense in URLs:

- ✅ `players`, `tps`, `memory`
- ❌ `player_count_metric_1`, `m1`

### 2. Always include units

Units help with display and understanding:

```toml
[monitors.custom1]
id = "memory"
name = "Memory Usage"
unit = "MB"  # Makes "2048 MB" clear
```

### 3. Send metrics consistently

If a metric is defined, try to send it with every pulse. Missing values appear as `null` in responses.

### 4. Use appropriate precision

ClickHouse stores metrics as `Float32`. For most use cases, 2-3 decimal places are sufficient:

- ✅ `tps=19.8`
- ❌ `tps=19.8234567890123`

### 5. Monitor rate of change

The min/max/avg aggregation in history lets you spot anomalies:

- Sudden spikes in `custom1_max`
- Gradual drift in `custom1_avg`
- Zero values in `custom1_min` (potential issue)
