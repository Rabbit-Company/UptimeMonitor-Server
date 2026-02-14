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
			"groupId": "3e99b0b2-fbe3-43a9-87a6-81c0f4faa024",
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
    "groupId": "staging",
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
| `groupId`              | string   | Parent group ID                                         |
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
    "groupId": null
  }' \
  http://localhost:3000/v1/admin/monitors/api-staging
```

**Rules:**

- The `id` field cannot be changed
- Only included fields are updated; omitted fields remain unchanged
- Set a field to `null` to remove optional fields (e.g., `groupId`, `custom1`)
- If changing `token`, it must not conflict with another monitor's token

**Success Response (200):**

```json
{
	"success": true,
	"message": "Monitor 'api-staging' updated"
}
```

### DELETE /v1/admin/monitors/:id

Delete a monitor. References to this monitor in status pages are automatically cleaned up.

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
			"parentId": "all-services",
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
    "interval": 60
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
| `parentId`             | string   | -       | Parent group ID for nesting                             |
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

- Monitors with `groupId` referencing this group have their `groupId` removed
- The group ID is removed from all status page `items` arrays
- Other groups with `parentId` referencing this group have their `parentId` removed

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
			"password": "Password123"
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

| Field      | Type   | Description                                         |
| ---------- | ------ | --------------------------------------------------- |
| `password` | string | Password to protect the page (minimum 8 characters) |

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

## Endpoint Summary

| Method   | Endpoint                       | Description                    |
| -------- | ------------------------------ | ------------------------------ |
| `GET`    | `/v1/admin/config`             | Get full configuration         |
| `GET`    | `/v1/admin/monitors`           | List all monitors              |
| `GET`    | `/v1/admin/monitors/:id`       | Get a monitor                  |
| `POST`   | `/v1/admin/monitors`           | Create a monitor               |
| `PUT`    | `/v1/admin/monitors/:id`       | Update a monitor               |
| `DELETE` | `/v1/admin/monitors/:id`       | Delete a monitor               |
| `GET`    | `/v1/admin/groups`             | List all groups                |
| `GET`    | `/v1/admin/groups/:id`         | Get a group                    |
| `POST`   | `/v1/admin/groups`             | Create a group                 |
| `PUT`    | `/v1/admin/groups/:id`         | Update a group                 |
| `DELETE` | `/v1/admin/groups/:id`         | Delete a group                 |
| `GET`    | `/v1/admin/status-pages`       | List all status pages          |
| `GET`    | `/v1/admin/status-pages/:id`   | Get a status page              |
| `POST`   | `/v1/admin/status-pages`       | Create a status page           |
| `PUT`    | `/v1/admin/status-pages/:id`   | Update a status page           |
| `DELETE` | `/v1/admin/status-pages/:id`   | Delete a status page           |
| `GET`    | `/v1/admin/notifications`      | List all notification channels |
| `GET`    | `/v1/admin/notifications/:id`  | Get a notification channel     |
| `POST`   | `/v1/admin/notifications`      | Create a notification channel  |
| `PUT`    | `/v1/admin/notifications/:id`  | Update a notification channel  |
| `DELETE` | `/v1/admin/notifications/:id`  | Delete a notification channel  |
| `GET`    | `/v1/admin/pulse-monitors`     | List all PulseMonitors         |
| `GET`    | `/v1/admin/pulse-monitors/:id` | Get a PulseMonitor             |
| `POST`   | `/v1/admin/pulse-monitors`     | Create a PulseMonitor          |
| `PUT`    | `/v1/admin/pulse-monitors/:id` | Update a PulseMonitor          |
| `DELETE` | `/v1/admin/pulse-monitors/:id` | Delete a PulseMonitor          |
