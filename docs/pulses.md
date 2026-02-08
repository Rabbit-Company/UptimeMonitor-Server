# Pulses

Pulses are the core mechanism of Uptime Monitor. A pulse is a heartbeat signal sent by your service (or a [PulseMonitor](https://github.com/Rabbit-Company/PulseMonitor) agent) to indicate that the service is alive and healthy. Missing pulses trigger downtime detection and notifications.

## How Pulses Work

Each monitor is configured with an `interval` (the number of seconds defining a time window). The server divides time into consecutive windows of this size. For each window, at least one pulse must arrive for that window to count as "up". If no pulse lands in a window, that window is recorded as downtime.

For example, with `interval = 30`, the server expects at least one pulse every 30 seconds. If a window passes with no pulse, the missing pulse detector flags it.

### Missing Pulse Detection

The `missingPulseDetector` continuously checks whether pulses are overdue:

```toml
[missingPulseDetector]
# How often to check for missing pulses (default: 5 seconds)
# Lower values detect outages faster but increase CPU usage
interval = 5
```

When a pulse is missing, the monitor's `maxRetries` setting determines how many consecutive missed pulses are tolerated before the monitor is marked as down:

```toml
[[monitors]]
id = "my-api"
name = "My API"
token = "secret-token"
interval = 30
maxRetries = 0    # Mark down immediately on first missed pulse
```

- `maxRetries = 0` — Down on the first missed pulse
- `maxRetries = 3` — Tolerates 3 missed pulses before marking down (roughly `3 x interval from missingPulseDetector` seconds)

## Sending Pulses

Pulses are sent via HTTP GET or WebSocket.

### HTTP

```bash
# Simple pulse — records with current timestamp
curl http://localhost:3000/v1/push/:token
```

### WebSocket

```json
{
	"action": "push",
	"token": "your-monitor-token"
}
```

## Timing Parameters

By default, a pulse is recorded at the time the server receives it. This works well when network latency is low, but for services with high or variable latency, the pulse might arrive in the wrong time window, causing inaccurate uptime data.

To solve this, you can include timing information with your pulse to tell the server exactly when the check started and ended. The server uses `startTime` to place the pulse in the correct window.

### Parameters

| Parameter   | Type          | Description                                    |
| ----------- | ------------- | ---------------------------------------------- |
| `latency`   | number        | Response time in milliseconds (max: 600,000)   |
| `startTime` | string/number | When the check started (ISO 8601 or Unix ms)   |
| `endTime`   | string/number | When the check completed (ISO 8601 or Unix ms) |

### Timing Logic

The server calculates missing values automatically based on what you provide:

| Provided                | Calculated                                   |
| ----------------------- | -------------------------------------------- |
| `startTime` + `endTime` | `latency` = endTime - startTime              |
| `startTime` + `latency` | `endTime` = startTime + latency              |
| `endTime` + `latency`   | `startTime` = endTime - latency              |
| `latency` only          | `endTime` = now, `startTime` = now - latency |
| No timing params        | Both set to current server time              |

### Examples

```bash
# RECOMMENDED: Send all three for maximum accuracy
curl "http://localhost:3000/v1/push/:token?startTime=2025-10-15T10:00:00Z&endTime=2025-10-15T10:00:01.500Z&latency=1500"

# Start and end times (latency calculated automatically)
curl "http://localhost:3000/v1/push/:token?startTime=2025-10-15T10:00:00Z&endTime=2025-10-15T10:00:01Z"

# Start time and latency (end time calculated)
curl "http://localhost:3000/v1/push/:token?startTime=2025-10-15T10:00:00Z&latency=1500"

# Unix timestamps (milliseconds)
curl "http://localhost:3000/v1/push/:token?startTime=1736928000000&endTime=1736928001500"

# Latency only (timestamps derived from current time)
curl "http://localhost:3000/v1/push/:token?latency=125"

# Simple pulse (no timing data)
curl http://localhost:3000/v1/push/:token
```

### Via WebSocket

```json
{
	"action": "push",
	"token": "your-monitor-token",
	"startTime": "2025-10-15T10:00:00Z",
	"endTime": "2025-10-15T10:00:01.500Z",
	"latency": 1500
}
```

### Timestamp Bounds

The server rejects pulses with timestamps that are too far from the current time:

- **Future limit:** `endTime` cannot be more than 60 seconds in the future
- **Past limit:** `startTime` cannot be more than 10 minutes in the past

## Custom Metrics

You can send up to 3 custom numeric values alongside each pulse. See [Custom Metrics](custom-metrics.md) for full details.

```bash
# Using configured metric IDs
curl "http://localhost:3000/v1/push/:token?latency=50&players=42&tps=19.8"

# Using generic names
curl "http://localhost:3000/v1/push/:token?latency=50&custom1=42&custom2=19.8&custom3=2048"
```

## Best Practices

### Send Multiple Pulses Per Window

Since a single missed HTTP request would cause a false downtime blip, it's best to send 2–3 pulses per interval window. This is exactly what PulseMonitor does automatically:

```
pulse_interval = max(3, floor(monitor.interval / 3))
```

For a monitor with `interval = 30`, PulseMonitor sends a pulse every 10 seconds (ensuring 3 pulses per window). If one request is dropped, the other two still cover the window.

If you're sending pulses from your own service, follow the same pattern. For `interval = 30`, send a pulse every 10–15 seconds rather than exactly every 30 seconds.

### Always Include startTime for High-Latency Services

If your service has response times over a few seconds, always include `startTime` so the pulse lands in the correct time window. Without it, a check that started at T=29s but completed at T=31s (due to 2s latency) would be recorded in the next window, potentially leaving the original window empty.

### Use the Recommended Format

For maximum accuracy, send all three timing parameters:

```bash
curl "http://localhost:3000/v1/push/:token?startTime=...&endTime=...&latency=..."
```

This gives the server the complete picture and avoids any ambiguity about when the check happened and how long it took.

### Choose interval Based on Your Needs

- **Fast services (APIs, websites):** `interval = 10–30` with `maxRetries = 0`
- **Slower services (batch jobs, databases):** `interval = 60–120` with `maxRetries = 1–3`
- **Variable services:** Use a longer interval with retries to avoid false positives

## Data Retention

Pulses are aggregated into a tiered retention model:

| Table           | Retention | Data                                            |
| --------------- | --------- | ----------------------------------------------- |
| `pulses`        | ~24 hours | Raw pulse data                                  |
| `pulses_hourly` | ~90 days  | Hourly aggregates (uptime, latency min/max/avg) |
| `pulses_daily`  | Forever   | Daily aggregates (uptime, latency min/max/avg)  |

This keeps storage bounded and predictable while providing accurate long-term uptime tracking. See [Configuration Guide](configuration.md) for details on the aggregation process.

## Rate Limits

The pulse endpoint is rate-limited per token:

| Limit        | Value         |
| ------------ | ------------- |
| Max requests | 60 per token  |
| Refill rate  | 12 per second |

This is generous enough for multiple pulses per window across many monitors, but prevents abuse.
