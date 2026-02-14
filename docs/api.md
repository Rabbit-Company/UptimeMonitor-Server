# API Reference

## Health Check

### GET /health

Check if the server is running.

**Response:**

```json
{
	"status": "ok",
	"timestamp": "2025-01-15T10:30:00.000Z",
	"pendingWebSockets": 5
}
```

---

## Pulse Endpoints

### GET /v1/push/:token

Send a heartbeat pulse for a monitor. See [Pulses](pulses.md) for a detailed guide on how pulses work, timing parameters, and best practices.

**Path Parameters:**
| Parameter | Description |
|-----------|-------------|
| `token` | Monitor's secret token |

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `latency` | number | Response time in milliseconds (max: 600000) |
| `startTime` | string/number | Check start time (ISO 8601 or Unix timestamp) |
| `endTime` | string/number | Check end time (ISO 8601 or Unix timestamp) |
| `custom1` | number | Custom metric 1 value |
| `custom2` | number | Custom metric 2 value |
| `custom3` | number | Custom metric 3 value |
| `{customId}` | number | Custom metric by configured ID |

**Timing Logic:**

- `startTime` + `endTime` → latency calculated automatically
- `startTime` + `latency` → endTime calculated
- `endTime` + `latency` → startTime calculated
- `latency` only → endTime = now, startTime calculated
- No params → recorded with current timestamp

**Examples:**

```bash
# Simple pulse
curl http://localhost:3000/v1/push/my-token

# With latency
curl "http://localhost:3000/v1/push/my-token?latency=125"

# With custom metrics (using configured IDs)
curl "http://localhost:3000/v1/push/my-token?latency=50&players=30&tps=19.8"

# With timing
curl "http://localhost:3000/v1/push/my-token?startTime=2025-01-15T10:00:00Z&endTime=2025-01-15T10:00:01Z"
```

**Success Response:**

```json
{
	"success": true,
	"monitorId": "my-monitor"
}
```

**Error Responses:**

```json
{ "error": "Invalid token" }           // 401
{ "error": "Invalid latency" }         // 400
{ "error": "Invalid startTime format" } // 400
{ "error": "Timestamp too far in the future" } // 400
{ "error": "Timestamp too far in the past" }   // 400
```

---

## Status Pages

### GET /v1/status/:slug

Get full status page data with all monitors and groups.

**Authentication:**

- If the status page is password-protected, an `Authorization` header must be provided.
- If the status page is public, no authentication is required.

For protected pages, the `Authorization` header must contain a **BLAKE2b-512 hash of the configured password**, sent as a `Bearer` token.

**Response:**

```json
{
	"name": "Public Status",
	"slug": "status",
	"items": [
		{
			"id": "production",
			"type": "group",
			"name": "Production Services",
			"status": "up",
			"latency": 45.5,
			"uptime1h": 100,
			"uptime24h": 99.95,
			"uptime7d": 99.87,
			"uptime30d": 99.92,
			"uptime90d": 99.89,
			"uptime365d": 99.91,
			"children": [
				{
					"id": "api-prod",
					"type": "monitor",
					"name": "Production API",
					"status": "up",
					"latency": 42,
					"lastCheck": "2025-01-15T10:30:00.000Z",
					"firstPulse": "2024-01-01T00:00:00.000Z",
					"uptime1h": 100,
					"uptime24h": 100,
					"uptime7d": 99.95,
					"uptime30d": 99.98,
					"uptime90d": 99.92,
					"uptime365d": 99.95,
					"custom1": {
						"config": { "id": "connections", "name": "Active Connections", "unit": "conn" },
						"value": 150
					}
				}
			]
		}
	],
	"lastUpdated": "2025-01-15T10:30:00.000Z"
}
```

**Errors:**

- `401 Unauthorized` – Password is required, missing, or invalid
- `404 Not Found` – Status page does not exist

### GET /v1/status/:slug/summary

Get a quick overview without full details.

**Authentication:**

- If the status page is password-protected, an `Authorization` header must be provided.
- If the status page is public, no authentication is required.

For protected pages, the `Authorization` header must contain a **BLAKE2b-512 hash of the configured password**, sent as a `Bearer` token.

**Response:**

```json
{
	"status": "up",
	"monitors": {
		"up": 5,
		"degraded": 1,
		"down": 0,
		"total": 6
	}
}
```

**Errors:**

- `401 Unauthorized` – Password is required, missing, or invalid
- `404 Not Found` – Status page does not exist

---

## History Endpoints

### Monitor History

#### GET /v1/monitors/:id/history

Raw pulse data (~24 hours due to TTL).

**Response:**

```json
{
	"monitorId": "api-prod",
	"type": "raw",
	"data": [
		{
			"timestamp": "2025-01-15T10:00:00Z",
			"uptime": 100,
			"latency_min": 40,
			"latency_max": 65,
			"latency_avg": 52.3
		}
	],
	"customMetrics": {
		"custom1": { "id": "connections", "name": "Active Connections", "unit": "conn" }
	}
}
```

#### GET /v1/monitors/:id/history/hourly

Hourly aggregated data (~90 days).

#### GET /v1/monitors/:id/history/daily

Daily aggregated data (kept forever).

### Group History

#### GET /v1/groups/:id/history

Raw group history computed from children (~24 hours).

**Response:**

```json
{
	"groupId": "production",
	"type": "raw",
	"strategy": "percentage",
	"data": [
		{
			"timestamp": "2025-01-15T10:00:00Z",
			"uptime": 100,
			"latency_min": 35,
			"latency_max": 120,
			"latency_avg": 67.5
		}
	]
}
```

#### GET /v1/groups/:id/history/hourly

Hourly aggregated group data (~90 days).

#### GET /v1/groups/:id/history/daily

Daily aggregated group data (kept forever).

---

## Configuration

### GET /v1/reload/:token

Hot-reload configuration without restart.

**Response:**

```json
{
	"success": true,
	"message": "Configuration reloaded successfully",
	"stats": {
		"monitors": 10,
		"groups": 5,
		"statusPages": 3,
		"pulseMonitors": 2,
		"notificationChannels": 2
	},
	"timestamp": "2025-01-15T10:30:00.000Z"
}
```

### GET /v1/health/missing-pulse-detector

Get missing pulse detector status.

**Response:**

```json
{
	"running": true,
	"checkInterval": 5000,
	"monitorsWithMissingPulses": [
		{
			"monitorId": "api-staging",
			"monitorName": "Staging API",
			"missedCount": 3,
			"maxRetries": 2,
			"consecutiveDownCount": 1,
			"resendNotification": 12,
			"actualDowntime": 45000
		}
	]
}
```

---

## Admin API

The Admin API provides full CRUD operations for managing monitors, groups, status pages, notification channels, and pulse monitors programmatically. All changes are persisted to `config.toml` and auto-reloaded.

See the [Admin API Reference](admin-api.md) for complete documentation of all endpoints.

**Quick overview:**

| Resource              | Endpoints                                                                          |
| --------------------- | ---------------------------------------------------------------------------------- |
| Configuration         | `GET /v1/admin/config`                                                             |
| Monitors              | `GET/POST /v1/admin/monitors`, `GET/PUT/DELETE /v1/admin/monitors/:id`             |
| Groups                | `GET/POST /v1/admin/groups`, `GET/PUT/DELETE /v1/admin/groups/:id`                 |
| Status Pages          | `GET/POST /v1/admin/status-pages`, `GET/PUT/DELETE /v1/admin/status-pages/:id`     |
| Notification Channels | `GET/POST /v1/admin/notifications`, `GET/PUT/DELETE /v1/admin/notifications/:id`   |
| Pulse Monitors        | `GET/POST /v1/admin/pulse-monitors`, `GET/PUT/DELETE /v1/admin/pulse-monitors/:id` |

To enable, add to `config.toml`:

```toml
[adminAPI]
enabled = true
token = "your-secure-admin-token"
```

All admin endpoints require `Authorization: Bearer <token>`.

---

## WebSocket API

Connect to `/ws` for real-time updates.

### Connection

```javascript
const ws = new WebSocket("ws://localhost:3000/ws");

ws.onopen = () => {
	console.log("Connected");
};

ws.onmessage = (event) => {
	const data = JSON.parse(event.data);
	console.log(data);
};
```

### Initial Message

On connect, you receive:

```json
{
	"action": "connected",
	"message": "WebSocket connection established",
	"timestamp": "2025-01-15T10:30:00.000Z"
}
```

### Subscribe to Status Page

```json
{ "action": "subscribe", "slug": "status" }
```

**Response:**

```json
{
	"action": "subscribed",
	"slug": "status",
	"message": "Subscription successful",
	"timestamp": "2025-01-15T10:30:00.000Z"
}
```

### Unsubscribe

```json
{ "action": "unsubscribe", "slug": "status" }
```

### List Subscriptions

```json
{ "action": "list_subscriptions" }
```

**Response:**

```json
{
	"action": "subscriptions",
	"type": "slug",
	"items": ["status", "internal"],
	"timestamp": "2025-01-15T10:30:00.000Z"
}
```

### Push Pulse via WebSocket

```json
{
	"action": "push",
	"token": "my-token",
	"latency": 125,
	"players": 30
}
```

**Response:**

```json
{
	"action": "pushed",
	"monitorId": "game-server",
	"timestamp": "2025-01-15T10:30:00.000Z"
}
```

### PulseMonitor Subscription

For automated monitoring agents:

```json
{ "action": "subscribe", "token": "pulse-monitor-token" }
```

**Response:**

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
				"token": "api-token",
				"interval": 10,
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

### Real-Time Events

When subscribed, you receive events:

**Pulse Received:**

```json
{
	"action": "pulse",
	"data": {
		"slug": "status",
		"monitorId": "api-prod",
		"status": "up",
		"latency": 42,
		"timestamp": "2025-01-15T10:30:00.000Z"
	},
	"timestamp": "2025-01-15T10:30:00.000Z"
}
```

**Monitor Down:**

```json
{
	"action": "monitor-down",
	"data": {
		"slug": "status",
		"monitorId": "api-prod",
		"downtime": 30000
	},
	"timestamp": "2025-01-15T10:30:00.000Z"
}
```

**Monitor Recovered:**

```json
{
	"action": "monitor-recovered",
	"data": {
		"slug": "status",
		"monitorId": "api-prod",
		"previousConsecutiveDownCount": 5,
		"downtime": 150000
	},
	"timestamp": "2025-01-15T10:30:00.000Z"
}
```

**Monitor Still Down:**

```json
{
	"action": "monitor-still-down",
	"data": {
		"slug": "status",
		"monitorId": "api-prod",
		"consecutiveDownCount": 10,
		"downtime": 300000
	},
	"timestamp": "2025-01-15T10:30:00.000Z"
}
```

---

## Rate Limits

| Endpoint            | Limit                                 |
| ------------------- | ------------------------------------- |
| `/v1/push/:token`   | 60 requests per token, refills 12/sec |
| All other endpoints | 500 requests total, refills 100/sec   |

## Caching

| Endpoint                          | Cache TTL  |
| --------------------------------- | ---------- |
| `/v1/status/:slug`                | 30 seconds |
| `/v1/status/:slug/summary`        | 30 seconds |
| `/v1/monitors/:id/history`        | 30 seconds |
| `/v1/monitors/:id/history/hourly` | 5 minutes  |
| `/v1/monitors/:id/history/daily`  | 15 minutes |
| `/v1/groups/:id/history`          | 30 seconds |
| `/v1/groups/:id/history/hourly`   | 5 minutes  |
| `/v1/groups/:id/history/daily`    | 15 minutes |
