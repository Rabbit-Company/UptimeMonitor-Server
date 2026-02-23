# Admin API Reference

The Admin API provides full CRUD (Create, Read, Update, Delete) operations for managing monitors, groups, status pages, notification channels, and pulse monitors programmatically. All changes are persisted to `config.toml` and auto-reloaded.

## Enabling the Admin API

Add the following to your `config.toml`:

```toml
[adminAPI]
enabled = true
token = "hux23to2isshfuyttzlyy6dfn2m9vtfdpew6iyjUbRqxKtXhgx"
```

| Field     | Required | Description                                          |
| --------- | -------- | ---------------------------------------------------- |
| `enabled` | Yes      | Set to `true` to activate admin endpoints            |
| `token`   | Yes      | Bearer token used to authenticate all admin requests |

Use a long, random string for the token. All admin endpoints require this token.

## Authentication

Every admin endpoint requires a `Bearer` token in the `Authorization` header:

```bash
curl -H "Authorization: Bearer hux23to2isshfuyttzlyy6dfn2m9vtfdpew6iyjUbRqxKtXhgx" \
  http://localhost:3000/v1/admin/monitors
```

If the token is missing, invalid, or the Admin API is disabled, the server returns `401 Unauthorized`.

## How It Works

All write operations (create, update, delete) follow the same pattern:

1. Validate the request body
2. Check for uniqueness conflicts (duplicate IDs, tokens, slugs)
3. Read the current `config.toml`
4. Apply changes
5. Validate the full configuration
6. Write to `config.toml` and hot-reload
7. On reload failure, automatically restore the previous configuration

This means the Admin API is **safe to use in production**. Invalid configurations are rejected before being written, and if a reload fails, the backup is restored automatically.

## Common Errors

All endpoints may return these errors:

| Status | Description                                                    |
| ------ | -------------------------------------------------------------- |
| `400`  | Validation failed (details in `error` and `details` fields)    |
| `401`  | Unauthorized (missing or invalid token, or Admin API disabled) |
| `404`  | Resource not found                                             |
| `409`  | Conflict (duplicate ID, token, or slug)                        |
| `500`  | Internal error (typically a config write/reload failure)       |

**Error response format:**

```json
{
	"error": "Validation failed",
	"details": ["name is required", "interval must be a positive number"]
}
```

---

## Configuration

### GET /v1/admin/config

Returns the entire current configuration object.

```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:3000/v1/admin/config
```

**Response:** The full parsed `config.toml` as JSON, including all monitors, groups, status pages, notifications, pulse monitors, and server settings.

---

## Monitors

### GET /v1/admin/monitors

List all monitors.

```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:3000/v1/admin/monitors
```

**Response:**

```json
{
	"monitors": [
		{
			"id": "a68c2f18-f362-4673-9314-422fb9dca894",
			"name": "Application",
			"token": "Iw6tp3z61d4xYxz3Lk55jyOce3kShmKcenC7mSvR954c5Xea5X",
			"interval": 60,
			"maxRetries": 0,
			"resendNotification": 12,
			"children": ["sub-service-1", "sub-service-2"],
			"notificationChannels": ["critical"],
			"dependencies": ["0f0198e8-0150-4f66-9005-e0c288530761"],
			"pulseMonitors": ["EU-CENTRAL-1"],
			"custom1": {
				"id": "memory",
				"name": "Memory Usage",
				"unit": "MB"
			},
			"pulse": {
				"icmp": {
					"host": "10.1.0.1",
					"timeout": 5
				}
			}
		}
	]
}
```

### GET /v1/admin/monitors/:id

Get a single monitor by ID.

```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:3000/v1/admin/monitors/a68c2f18-f362-4673-9314-422fb9dca894
```

**Response:** Same shape as a single item in the list response.

**Errors:**

- `404 Not Found` - Monitor does not exist

### POST /v1/admin/monitors

Create a new monitor.

```bash
curl -X POST -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "api-staging",
    "name": "Staging API",
    "token": "tk_staging_api_def456",
    "interval": 30,
    "maxRetries": 2,
    "resendNotification": 0,
    "notificationChannels": ["critical"]
  }' \
  http://localhost:3000/v1/admin/monitors
```

**Required fields:**

| Field                | Type   | Description                                         |
| -------------------- | ------ | --------------------------------------------------- |
| `id`                 | string | Unique ID (alphanumeric, hyphens, underscores)      |
| `name`               | string | Display name                                        |
| `token`              | string | Unique secret token for sending pulses              |
| `interval`           | number | Expected pulse interval in seconds (must be > 0)    |
| `maxRetries`         | number | Missed pulses before marking down (>= 0)            |
| `resendNotification` | number | Resend notification every N down checks (0 = never) |

**Optional fields:**

| Field                  | Type     | Description                                             |
| ---------------------- | -------- | ------------------------------------------------------- |
| `children`             | string[] | Array of child monitor/group IDs                        |
| `notificationChannels` | string[] | Array of notification channel IDs                       |
| `dependencies`         | string[] | Array of monitor/group IDs for notification suppression |
| `pulseMonitors`        | string[] | Array of PulseMonitor IDs                               |
| `custom1`              | object   | Custom metric config (`id`, `name`, optional `unit`)    |
| `custom2`              | object   | Custom metric config                                    |
| `custom3`              | object   | Custom metric config                                    |
| `pulse`                | object   | PulseMonitor protocol config (http, tcp, etc.)          |

**Success Response (201):**

```json
{
	"success": true,
	"message": "Monitor 'api-staging' created",
	"id": "api-staging"
}
```

**Errors:**

- `409 Conflict` - A monitor with this ID already exists, a group with this ID already exists, or a monitor with this token already exists

### PUT /v1/admin/monitors/:id

Update an existing monitor. Send only the fields you want to change. Set a field to `null` to remove it.

```bash
curl -X PUT -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Staging API v2",
    "interval": 60,
    "children": null
  }' \
  http://localhost:3000/v1/admin/monitors/api-staging
```

**Rules:**

- The `id` field cannot be changed
- Only included fields are updated; omitted fields remain unchanged
- Set a field to `null` to remove optional fields (e.g., `children`, `custom1`)
- If changing `token`, it must not conflict with another monitor's token

**Success Response (200):**

```json
{
	"success": true,
	"message": "Monitor 'api-staging' updated"
}
```

### DELETE /v1/admin/monitors/:id

Delete a monitor. References to this monitor are automatically cleaned up.

```bash
curl -X DELETE -H "Authorization: Bearer <token>" \
  http://localhost:3000/v1/admin/monitors/api-staging
```

**Success Response (200):**

```json
{
	"success": true,
	"message": "Monitor 'api-staging' deleted"
}
```

**Side effects:**

- The monitor ID is removed from all status page `items` arrays
- The monitor ID is removed from `children` arrays in all monitors and groups

---

## Groups

### GET /v1/admin/groups

List all groups.

```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:3000/v1/admin/groups
```

**Response:**

```json
{
	"groups": [
		{
			"id": "production",
			"name": "Production Services",
			"strategy": "percentage",
			"degradedThreshold": 50,
			"interval": 60,
			"resendNotification": 12,
			"children": ["api-prod", "web-prod", "db-prod"],
			"notificationChannels": [],
			"dependencies": []
		}
	]
}
```

### GET /v1/admin/groups/:id

Get a single group by ID.

**Errors:**

- `404 Not Found` - Group does not exist

### POST /v1/admin/groups

Create a new group.

```bash
curl -X POST -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "eu-services",
    "name": "EU Services",
    "strategy": "percentage",
    "degradedThreshold": 50,
    "interval": 60,
    "children": ["eu-api", "eu-web"]
  }' \
  http://localhost:3000/v1/admin/groups
```

**Required fields:**

| Field               | Type   | Description                                      |
| ------------------- | ------ | ------------------------------------------------ |
| `id`                | string | Unique ID (alphanumeric, hyphens, underscores)   |
| `name`              | string | Display name                                     |
| `strategy`          | string | `"any-up"`, `"percentage"`, or `"all-up"`        |
| `degradedThreshold` | number | Percentage threshold for degraded status (0–100) |
| `interval`          | number | Interval in seconds used for uptime calculations |

**Optional fields:**

| Field                  | Type     | Default | Description                                             |
| ---------------------- | -------- | ------- | ------------------------------------------------------- |
| `resendNotification`   | number   | `0`     | Resend notification every N down checks                 |
| `children`             | string[] | `[]`    | Array of child monitor/group IDs                        |
| `notificationChannels` | string[] | `[]`    | Array of notification channel IDs                       |
| `dependencies`         | string[] | `[]`    | Array of monitor/group IDs for notification suppression |

**Success Response (201):**

```json
{
	"success": true,
	"message": "Group 'eu-services' created",
	"id": "eu-services"
}
```

**Errors:**

- `409 Conflict` - A group with this ID already exists, or a monitor with this ID already exists

### PUT /v1/admin/groups/:id

Update an existing group. Send only the fields you want to change.

```bash
curl -X PUT -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "degradedThreshold": 75,
    "children": ["eu-api", "eu-web", "eu-db"],
    "notificationChannels": ["critical"]
  }' \
  http://localhost:3000/v1/admin/groups/eu-services
```

**Rules:**

- The `id` field cannot be changed
- Set a field to `null` to remove optional fields

**Success Response (200):**

```json
{
	"success": true,
	"message": "Group 'eu-services' updated"
}
```

### DELETE /v1/admin/groups/:id

Delete a group. References are automatically cleaned up.

```bash
curl -X DELETE -H "Authorization: Bearer <token>" \
  http://localhost:3000/v1/admin/groups/eu-services
```

**Success Response (200):**

```json
{
	"success": true,
	"message": "Group 'eu-services' deleted"
}
```

**Side effects:**

- The group ID is removed from all status page `items` arrays
- The group ID is removed from `children` arrays in all monitors and groups

---

## Status Pages

### GET /v1/admin/status-pages

List all status pages.

```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:3000/v1/admin/status-pages
```

**Response:**

```json
{
	"statusPages": [
		{
			"id": "public",
			"name": "Public Status Page",
			"slug": "status",
			"items": ["all-services", "third-party"],
			"password": "Password123",
			"reports": false
		}
	]
}
```

### GET /v1/admin/status-pages/:id

Get a single status page by ID.

**Errors:**

- `404 Not Found` - Status page does not exist

### POST /v1/admin/status-pages

Create a new status page.

```bash
curl -X POST -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "partners",
    "name": "Partner Status",
    "slug": "partner-status",
    "items": ["production", "api-prod"]
  }' \
  http://localhost:3000/v1/admin/status-pages
```

**Required fields:**

| Field   | Type     | Description                                            |
| ------- | -------- | ------------------------------------------------------ |
| `id`    | string   | Unique ID (alphanumeric, hyphens, underscores)         |
| `name`  | string   | Display name                                           |
| `slug`  | string   | URL slug (lowercase letters, numbers, hyphens only)    |
| `items` | string[] | Non-empty array of monitor and/or group IDs to display |

**Optional fields:**

| Field       | Type     | Description                                         |
| ----------- | -------- | --------------------------------------------------- |
| `leafItems` | string[] | IDs treated as leaf nodes (children not expanded)   |
| `password`  | string   | Password to protect the page (minimum 8 characters) |
| `reports`   | boolean  | Enable report export endpoints (default: false)     |

**Success Response (201):**

```json
{
	"success": true,
	"message": "Status page 'partners' created",
	"id": "partners"
}
```

**Errors:**

- `409 Conflict` - A status page with this ID already exists, or the slug is already in use

### PUT /v1/admin/status-pages/:id

Update an existing status page.

```bash
curl -X PUT -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Partner Status Page",
    "password": "new-secure-password"
  }' \
  http://localhost:3000/v1/admin/status-pages/partners
```

**Rules:**

- The `id` field cannot be changed
- If changing `slug`, it must not conflict with another status page's slug
- Set `password` to `null` to remove password protection

**Success Response (200):**

```json
{
	"success": true,
	"message": "Status page 'partners' updated"
}
```

### DELETE /v1/admin/status-pages/:id

Delete a status page. You cannot delete the last remaining status page.

```bash
curl -X DELETE -H "Authorization: Bearer <token>" \
  http://localhost:3000/v1/admin/status-pages/partners
```

**Success Response (200):**

```json
{
	"success": true,
	"message": "Status page 'partners' deleted"
}
```

---

## Notification Channels

### GET /v1/admin/notifications

List all notification channels.

```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:3000/v1/admin/notifications
```

**Response:**

```json
{
	"notificationChannels": [
		{
			"id": "critical",
			"name": "Critical Production Alerts",
			"description": "High-priority alerts",
			"enabled": true,
			"discord": { "enabled": true, "webhookUrl": "https://discord.com/api/webhooks/..." }
		}
	]
}
```

### GET /v1/admin/notifications/:id

Get a single notification channel by ID.

**Errors:**

- `404 Not Found` - Notification channel does not exist

### POST /v1/admin/notifications

Create a new notification channel.

```bash
curl -X POST -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "ops-alerts",
    "name": "Ops Team Alerts",
    "enabled": true,
    "discord": {
      "enabled": true,
      "webhookUrl": "https://discord.com/api/webhooks/123/abc"
    }
  }' \
  http://localhost:3000/v1/admin/notifications
```

**Required fields:**

| Field     | Type    | Description                                    |
| --------- | ------- | ---------------------------------------------- |
| `id`      | string  | Unique ID (alphanumeric, hyphens, underscores) |
| `name`    | string  | Display name                                   |
| `enabled` | boolean | Whether the channel is active                  |

**Optional fields:**

| Field         | Type   | Description                   |
| ------------- | ------ | ----------------------------- |
| `description` | string | Human-readable description    |
| `discord`     | object | Discord webhook configuration |
| `email`       | object | Email/SMTP configuration      |
| `ntfy`        | object | Ntfy push notification config |
| `telegram`    | object | Telegram bot configuration    |
| `webhook`     | object | Webhook configuration         |

**Discord configuration:**

```json
{
	"enabled": true,
	"webhookUrl": "https://discord.com/api/webhooks/...",
	"username": "Alert Bot",
	"avatarUrl": "https://example.com/avatar.png",
	"mentions": {
		"users": ["123456789"],
		"roles": ["987654321"],
		"everyone": false
	}
}
```

**Email configuration:**

```json
{
	"enabled": true,
	"from": "\"Uptime Monitor\" <alerts@example.com>",
	"to": ["admin@example.com", "ops@example.com"],
	"smtp": {
		"host": "smtp.example.com",
		"port": 465,
		"secure": true,
		"user": "alerts@example.com",
		"pass": "your-smtp-password"
	}
}
```

**Ntfy configuration:**

```json
{
	"enabled": true,
	"server": "https://ntfy.sh",
	"topic": "uptime-monitor",
	"token": "tk_your_token_here"
}
```

**Telegram configuration:**

```json
{
	"enabled": true,
	"botToken": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
	"chatId": "-1001234567890",
	"topicId": 123,
	"disableNotification": false
}
```

**Webhook configuration:**

```json
{
	"enabled": true,
	"url": "https://example.com/webhook",
	"headers": {
		"Authorization": "Bearer your-token"
	}
}
```

**Success Response (201):**

```json
{
	"success": true,
	"message": "Channel 'ops-alerts' created",
	"id": "ops-alerts"
}
```

**Errors:**

- `409 Conflict` - A channel with this ID already exists

### PUT /v1/admin/notifications/:id

Update an existing notification channel.

```bash
curl -X PUT -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": false,
    "discord": null
  }' \
  http://localhost:3000/v1/admin/notifications/ops-alerts
```

**Rules:**

- The `id` field cannot be changed
- Set a provider to `null` to remove it (e.g., `"discord": null`)

**Success Response (200):**

```json
{
	"success": true,
	"message": "Channel 'ops-alerts' updated"
}
```

### DELETE /v1/admin/notifications/:id

Delete a notification channel. References are automatically cleaned up.

```bash
curl -X DELETE -H "Authorization: Bearer <token>" \
  http://localhost:3000/v1/admin/notifications/ops-alerts
```

**Success Response (200):**

```json
{
	"success": true,
	"message": "Channel 'ops-alerts' deleted"
}
```

**Side effects:**

- The channel ID is removed from `notificationChannels` arrays in all monitors and groups

---

## Pulse Monitors

### GET /v1/admin/pulse-monitors

List all PulseMonitor instances.

```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:3000/v1/admin/pulse-monitors
```

**Response:**

```json
{
	"pulseMonitors": [
		{
			"id": "US-WEST-1",
			"name": "US West 1 (Oregon)",
			"token": "tk_pulse_monitor_us_west_1"
		}
	]
}
```

### GET /v1/admin/pulse-monitors/:id

Get a single PulseMonitor by ID.

**Errors:**

- `404 Not Found` - PulseMonitor does not exist

### POST /v1/admin/pulse-monitors

Create a new PulseMonitor instance.

```bash
curl -X POST -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "AP-EAST-1",
    "name": "Asia Pacific (Tokyo)",
    "token": "tk_pulse_monitor_ap_east_1"
  }' \
  http://localhost:3000/v1/admin/pulse-monitors
```

**Required fields:**

| Field   | Type   | Description                                    |
| ------- | ------ | ---------------------------------------------- |
| `id`    | string | Unique ID (alphanumeric, hyphens, underscores) |
| `name`  | string | Display name                                   |
| `token` | string | Unique token for WebSocket authentication      |

**Success Response (201):**

```json
{
	"success": true,
	"message": "PulseMonitor 'AP-EAST-1' created",
	"id": "AP-EAST-1"
}
```

**Errors:**

- `409 Conflict` - A PulseMonitor with this ID or token already exists

### PUT /v1/admin/pulse-monitors/:id

Update an existing PulseMonitor.

```bash
curl -X PUT -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Asia Pacific East (Tokyo)"
  }' \
  http://localhost:3000/v1/admin/pulse-monitors/AP-EAST-1
```

**Rules:**

- The `id` field cannot be changed
- If changing `token`, it must not conflict with another PulseMonitor's token

**Success Response (200):**

```json
{
	"success": true,
	"message": "PulseMonitor 'AP-EAST-1' updated"
}
```

### DELETE /v1/admin/pulse-monitors/:id

Delete a PulseMonitor. References are automatically cleaned up.

```bash
curl -X DELETE -H "Authorization: Bearer <token>" \
  http://localhost:3000/v1/admin/pulse-monitors/AP-EAST-1
```

**Success Response (200):**

```json
{
	"success": true,
	"message": "PulseMonitor 'AP-EAST-1' deleted"
}
```

**Side effects:**

- The PulseMonitor ID is removed from `pulseMonitors` arrays in all monitors

---

## Incidents

Unlike other admin resources, incidents are stored in ClickHouse (not `config.toml`). They are not part of the configuration file and do not trigger a config reload. Incidents are associated with a status page and optionally linked to affected monitors or groups on that page.

Each incident has a timeline of updates that track its progression. The incident's `status` is driven by its timeline updates. To change an incident's status, add a new update via the updates endpoint.

### GET /v1/admin/incidents

List all incidents. Optionally filter by status page.

```bash
curl -H "Authorization: Bearer " \
  http://localhost:3000/v1/admin/incidents
```

**Query Parameters:**

| Parameter        | Type   | Description                        |
| ---------------- | ------ | ---------------------------------- |
| `status_page_id` | string | Filter incidents by status page ID |

**Response:**

```json
{
	"incidents": [
		{
			"id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
			"status_page_id": "main",
			"title": "Database connectivity issues",
			"status": "investigating",
			"severity": "major",
			"affected_monitors": ["api-prod", "web-app"],
			"created_at": "2026-02-15T10:30:00.000Z",
			"updated_at": "2026-02-15T10:30:00.000Z",
			"resolved_at": null
		}
	]
}
```

### GET /v1/admin/incidents/:id

Get a single incident with all its timeline updates.

```bash
curl -H "Authorization: Bearer " \
  http://localhost:3000/v1/admin/incidents/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

**Response:**

```json
{
	"id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
	"status_page_id": "main",
	"title": "Database connectivity issues",
	"status": "identified",
	"severity": "major",
	"affected_monitors": ["api-prod"],
	"created_at": "2026-02-15T10:30:00.000Z",
	"updated_at": "2026-02-15T10:45:00.000Z",
	"resolved_at": null,
	"updates": [
		{
			"id": "f6e5d4c3-b2a1-0987-fedc-ba9876543210",
			"incident_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
			"status": "investigating",
			"message": "We are investigating reports of degraded database performance.",
			"created_at": "2026-02-15T10:30:00.000Z"
		},
		{
			"id": "11223344-5566-7788-99aa-bbccddeeff00",
			"incident_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
			"status": "identified",
			"message": "We have identified the root cause as a failed database migration.",
			"created_at": "2026-02-15T10:45:00.000Z"
		}
	]
}
```

**Errors:**

- `404 Not Found` - Incident does not exist

### POST /v1/admin/incidents

Create a new incident with an initial timeline update message.

```bash
curl -X POST -H "Authorization: Bearer " \
  -H "Content-Type: application/json" \
  -d '{
    "status_page_id": "main",
    "title": "Database connectivity issues",
    "status": "investigating",
    "severity": "major",
    "message": "We are investigating reports of degraded database performance.",
    "affected_monitors": ["api-prod"]
  }' \
  http://localhost:3000/v1/admin/incidents
```

**Required fields:**

| Field            | Type   | Description                                                                |
| ---------------- | ------ | -------------------------------------------------------------------------- |
| `status_page_id` | string | ID of the status page this incident belongs to                             |
| `title`          | string | Short incident title                                                       |
| `status`         | string | Initial status: `investigating`, `identified`, `monitoring`, or `resolved` |
| `severity`       | string | Severity level: `minor`, `major`, or `critical`                            |
| `message`        | string | Initial timeline update message                                            |

**Optional fields:**

| Field               | Type     | Description                                                            |
| ------------------- | -------- | ---------------------------------------------------------------------- |
| `affected_monitors` | string[] | IDs of affected monitors/groups (must be on the specified status page) |

**Success Response (201):**

```json
{
	"success": true,
	"message": "Incident 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' created",
	"id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
	"incident": {
		"id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
		"status_page_id": "main",
		"title": "Database connectivity issues",
		"status": "investigating",
		"severity": "major",
		"affected_monitors": ["api-prod"],
		"created_at": "2026-02-15T10:30:00.000Z",
		"updated_at": "2026-02-15T10:30:00.000Z",
		"resolved_at": null,
		"updates": [
			{
				"id": "f6e5d4c3-b2a1-0987-fedc-ba9876543210",
				"incident_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
				"status": "investigating",
				"message": "We are investigating reports of degraded database performance.",
				"created_at": "2026-02-15T10:30:00.000Z"
			}
		]
	}
}
```

**Errors:**

- `400 Bad Request` - Validation failed (missing fields, invalid status/severity, affected monitor not on status page)
- `404 Not Found` - Status page does not exist

### PUT /v1/admin/incidents/:id

Update incident metadata. Status cannot be changed directly. Use the updates endpoint to post a new timeline entry which changes the status.

```bash
curl -X PUT -H "Authorization: Bearer " \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Database connectivity issues - resolved",
    "severity": "critical",
    "affected_monitors": ["api-prod", "web-app"]
  }' \
  http://localhost:3000/v1/admin/incidents/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

**Optional fields (send only what you want to change):**

| Field               | Type     | Description                                                         |
| ------------------- | -------- | ------------------------------------------------------------------- |
| `title`             | string   | Updated incident title                                              |
| `severity`          | string   | `minor`, `major`, or `critical`                                     |
| `affected_monitors` | string[] | Updated list of affected monitor/group IDs (must be on status page) |

**Success Response (200):**

```json
{
	"success": true,
	"message": "Incident 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' updated",
	"incident": {}
}
```

**Errors:**

- `400 Bad Request` - Validation failed (including if you try to set `status` directly)
- `404 Not Found` - Incident does not exist

### DELETE /v1/admin/incidents/:id

Delete an incident and all its timeline updates.

```bash
curl -X DELETE -H "Authorization: Bearer " \
  http://localhost:3000/v1/admin/incidents/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

**Success Response (200):**

```json
{
	"success": true,
	"message": "Incident 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' deleted"
}
```

### POST /v1/admin/incidents/:id/updates

Add a timeline update to an incident. This also updates the parent incident's `status` and `updated_at` timestamp. If the new status is `resolved`, the incident's `resolved_at` is set.

```bash
curl -X POST -H "Authorization: Bearer " \
  -H "Content-Type: application/json" \
  -d '{
    "status": "identified",
    "message": "We have identified the root cause as a failed database migration."
  }' \
  http://localhost:3000/v1/admin/incidents/a1b2c3d4-e5f6-7890-abcd-ef1234567890/updates
```

**Required fields:**

| Field     | Type   | Description                                                            |
| --------- | ------ | ---------------------------------------------------------------------- |
| `status`  | string | New status: `investigating`, `identified`, `monitoring`, or `resolved` |
| `message` | string | Update message body                                                    |

**Success Response (201):**

```json
{
	"success": true,
	"message": "Update added to incident 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'",
	"updateId": "11223344-5566-7788-99aa-bbccddeeff00",
	"incident": {}
}
```

**Errors:**

- `400 Bad Request` - Validation failed (missing or invalid status/message)
- `404 Not Found` - Incident does not exist

### DELETE /v1/admin/incidents/:id/updates/:updateId

Delete a specific timeline update from an incident. If the deleted update was the most recent one, the incident's status and `resolved_at` are synced to match the new most-recent update.

```bash
curl -X DELETE -H "Authorization: Bearer " \
  http://localhost:3000/v1/admin/incidents/a1b2c3d4-e5f6-7890-abcd-ef1234567890/updates/11223344-5566-7788-99aa-bbccddeeff00
```

**Success Response (200):**

```json
{
	"success": true,
	"message": "Update '11223344-5566-7788-99aa-bbccddeeff00' deleted from incident 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'",
	"incident": {}
}
```

**Errors:**

- `404 Not Found` - Incident or update does not exist

### WebSocket Events

All incident operations broadcast real-time events to WebSocket subscribers of the relevant status page. The following actions are emitted: `incident-created`, `incident-updated`, `incident-update-added`, `incident-update-deleted`, `incident-deleted`. See the [WebSocket API section](api.md#websocket-api) in the API Reference for event payload formats.

---

## Endpoint Summary

| Method   | Endpoint                                    | Description                    |
| -------- | ------------------------------------------- | ------------------------------ |
| `GET`    | `/v1/admin/config`                          | Get full configuration         |
| `GET`    | `/v1/admin/monitors`                        | List all monitors              |
| `GET`    | `/v1/admin/monitors/:id`                    | Get a monitor                  |
| `POST`   | `/v1/admin/monitors`                        | Create a monitor               |
| `PUT`    | `/v1/admin/monitors/:id`                    | Update a monitor               |
| `DELETE` | `/v1/admin/monitors/:id`                    | Delete a monitor               |
| `GET`    | `/v1/admin/groups`                          | List all groups                |
| `GET`    | `/v1/admin/groups/:id`                      | Get a group                    |
| `POST`   | `/v1/admin/groups`                          | Create a group                 |
| `PUT`    | `/v1/admin/groups/:id`                      | Update a group                 |
| `DELETE` | `/v1/admin/groups/:id`                      | Delete a group                 |
| `GET`    | `/v1/admin/status-pages`                    | List all status pages          |
| `GET`    | `/v1/admin/status-pages/:id`                | Get a status page              |
| `POST`   | `/v1/admin/status-pages`                    | Create a status page           |
| `PUT`    | `/v1/admin/status-pages/:id`                | Update a status page           |
| `DELETE` | `/v1/admin/status-pages/:id`                | Delete a status page           |
| `GET`    | `/v1/admin/notifications`                   | List all notification channels |
| `GET`    | `/v1/admin/notifications/:id`               | Get a notification channel     |
| `POST`   | `/v1/admin/notifications`                   | Create a notification channel  |
| `PUT`    | `/v1/admin/notifications/:id`               | Update a notification channel  |
| `DELETE` | `/v1/admin/notifications/:id`               | Delete a notification channel  |
| `GET`    | `/v1/admin/pulse-monitors`                  | List all PulseMonitors         |
| `GET`    | `/v1/admin/pulse-monitors/:id`              | Get a PulseMonitor             |
| `POST`   | `/v1/admin/pulse-monitors`                  | Create a PulseMonitor          |
| `PUT`    | `/v1/admin/pulse-monitors/:id`              | Update a PulseMonitor          |
| `DELETE` | `/v1/admin/pulse-monitors/:id`              | Delete a PulseMonitor          |
| `GET`    | `/v1/admin/incidents`                       | List all incidents             |
| `GET`    | `/v1/admin/incidents/:id`                   | Get an incident                |
| `POST`   | `/v1/admin/incidents`                       | Create an incident             |
| `PUT`    | `/v1/admin/incidents/:id`                   | Update an incident             |
| `DELETE` | `/v1/admin/incidents/:id`                   | Delete an incident             |
| `POST`   | `/v1/admin/incidents/:id/updates`           | Add a timeline update          |
| `DELETE` | `/v1/admin/incidents/:id/updates/:updateId` | Delete a timeline update       |
