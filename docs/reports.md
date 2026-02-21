# Reports

Reports allow exporting monitor and group history data in **CSV** or **JSON** format. Reports are available through both the public status page API (when enabled) and the Admin API.

## Enabling Reports

Reports must be explicitly enabled per status page in `config.toml`:

```toml
[[status_pages]]
id = "main"
name = "Public Status"
slug = "status"
items = ["all-services"]
reports = true
```

| Field     | Default | Description                                  |
| --------- | ------- | -------------------------------------------- |
| `reports` | `false` | Enable report export endpoints for this page |

Reports are **disabled by default**. When disabled, all report endpoints for that status page return `404`.

## Authentication

Report endpoints follow the same authentication rules as history endpoints:

- If the status page is **public** (no password): No authentication required.
- If the status page is **password-protected**: An `Authorization` header with the BLAKE2b-512 hash of the password is required, sent as a `Bearer` token.

Admin report endpoints always require the admin bearer token.

## Formats

All report endpoints accept a `format` query parameter:

| Value  | Content-Type       | Description                                  |
| ------ | ------------------ | -------------------------------------------- |
| `json` | `application/json` | Default. Same structure as history endpoints |
| `csv`  | `text/csv`         | CSV file with headers and data rows          |

Example:

```bash
# JSON (default)
curl http://localhost:3000/v1/status/public/monitors/api-prod/reports/daily

# CSV
curl "http://localhost:3000/v1/status/public/monitors/api-prod/reports/daily?format=csv"
```

## CSV Column Headers

### Monitor Reports

CSV headers always include:

```
Timestamp,Uptime (%),Latency Min (ms),Latency Max (ms),Latency Avg (ms)
```

If custom metrics are configured on the monitor, their columns are appended. The column name uses the format `Name (unit)`, falling back to the metric `id` if no `name` is configured:

```
...,Player Count Min (players),Player Count Max (players),Player Count Avg (players)
```

If a metric has no `unit`, only the name is used:

```
...,Error Rate Min,Error Rate Max,Error Rate Avg
```

### Group Reports

Group report CSVs always have the same columns:

```
Timestamp,Uptime (%),Latency Min (ms),Latency Max (ms),Latency Avg (ms)
```

## Report Types

Three report types are available, matching the history data granularity:

| Type   | Data Source     | Retention | Description                       |
| ------ | --------------- | --------- | --------------------------------- |
| Raw    | `pulses` table  | ~24 hours | Individual pulse intervals        |
| Hourly | `pulses_hourly` | ~90 days  | Aggregated per hour (min/max/avg) |
| Daily  | `pulses_daily`  | Forever   | Aggregated per day (min/max/avg)  |

---

## Public Report Endpoints

All public report endpoints are scoped under a status page slug. The monitor or group must belong to the specified status page.

**Common Errors:**

- `401 Unauthorized` – Password is required, missing, or invalid
- `404 Not Found` – Status page does not exist, reports are not enabled, or item is not on this status page

### Monitor Reports

#### GET /v1/status/:slug/monitors/:id/reports

Raw monitor report (~24 hours due to TTL). Cached for 30 seconds.

**Query Parameters:**

| Parameter | Type   | Default | Description     |
| --------- | ------ | ------- | --------------- |
| `format`  | string | `json`  | `json` or `csv` |

**JSON Response:** Same as `/v1/status/:slug/monitors/:id/history`.

**CSV Response:**

```csv
Timestamp,Uptime (%),Latency Min (ms),Latency Max (ms),Latency Avg (ms)
2025-01-15T10:00:00Z,100,40,65,52.3
2025-01-15T10:01:00Z,100,38,70,48.1
```

#### GET /v1/status/:slug/monitors/:id/reports/hourly

Hourly aggregated monitor report (~90 days). Cached for 5 minutes.

#### GET /v1/status/:slug/monitors/:id/reports/daily

Daily aggregated monitor report (all time). Cached for 15 minutes.

### Group Reports

#### GET /v1/status/:slug/groups/:id/reports

Raw group report (~24 hours due to TTL). Cached for 30 seconds.

**Query Parameters:**

| Parameter | Type   | Default | Description     |
| --------- | ------ | ------- | --------------- |
| `format`  | string | `json`  | `json` or `csv` |

**JSON Response:** Same as `/v1/status/:slug/groups/:id/history`.

**CSV Response:**

```csv
Timestamp,Uptime (%),Latency Min (ms),Latency Max (ms),Latency Avg (ms)
2025-01-15T10:00:00Z,100,35,120,67.5
```

#### GET /v1/status/:slug/groups/:id/reports/hourly

Hourly aggregated group report (~90 days). Cached for 5 minutes.

#### GET /v1/status/:slug/groups/:id/reports/daily

Daily aggregated group report (all time). Cached for 15 minutes.

---

## Admin Report Endpoints

Admin report endpoints provide unrestricted access to export data for any monitor or group, regardless of status page settings. They require the admin bearer token.

### Monitor Reports

#### GET /v1/admin/monitors/:id/reports

Raw monitor report.

**Query Parameters:**

| Parameter | Type   | Default | Description     |
| --------- | ------ | ------- | --------------- |
| `format`  | string | `json`  | `json` or `csv` |

#### GET /v1/admin/monitors/:id/reports/hourly

Hourly aggregated monitor report.

#### GET /v1/admin/monitors/:id/reports/daily

Daily aggregated monitor report.

### Group Reports

#### GET /v1/admin/groups/:id/reports

Raw group report.

#### GET /v1/admin/groups/:id/reports/hourly

Hourly aggregated group report.

#### GET /v1/admin/groups/:id/reports/daily

Daily aggregated group report.

---

## Caching

Report endpoints use the same cache TTLs as their corresponding history endpoints:

| Report Type | Cache TTL  |
| ----------- | ---------- |
| Raw         | 30 seconds |
| Hourly      | 5 minutes  |
| Daily       | 15 minutes |

For password-protected status pages and Admin reports, responses are never cached (same behavior as history endpoints).

---

## Examples

### Export daily monitor CSV

```bash
curl "http://localhost:3000/v1/status/public/monitors/api-prod/reports/daily?format=csv" \
  -o api-prod-daily.csv
```

### Export hourly group JSON for a protected page

```bash
curl -H "Authorization: Bearer $(echo -n 'Password123' | b2sum -l 512 | cut -d' ' -f1)" \
  "http://localhost:3000/v1/status/public/groups/production/reports/hourly"
```

### Admin: Export raw monitor CSV

```bash
curl -H "Authorization: Bearer your-admin-token" \
  "http://localhost:3000/v1/admin/monitors/api-prod/reports?format=csv" \
  -o api-prod-raw.csv
```

### CSV output with custom metrics

For a monitor with these custom metrics configured:

```toml
[monitors.custom1]
id = "players"
name = "Player Count"
unit = "players"

[monitors.custom2]
id = "tps"
name = "Server TPS"
unit = "TPS"
```

The CSV output would be:

```csv
Timestamp,Uptime (%),Latency Min (ms),Latency Max (ms),Latency Avg (ms),Player Count Min (players),Player Count Max (players),Player Count Avg (players),Server TPS Min (TPS),Server TPS Max (TPS),Server TPS Avg (TPS)
2025-01-15T10:00:00Z,100,10,25,15.3,20,85,45.7,18.5,20.0,19.6
```
