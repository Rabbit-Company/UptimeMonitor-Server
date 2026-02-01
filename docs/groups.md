# Groups & Strategies

Groups let you organize monitors hierarchically and define how their combined health is calculated.

## Basic Group

```toml
[[groups]]
id = "production"
name = "Production Services"
strategy = "percentage"
degradedThreshold = 50
interval = 60
resendNotification = 0
```

## Group Strategies

### any-up

The group is **UP** if at least one child is up.

**Use case:** Redundant services where any one can serve traffic.

```toml
[[groups]]
id = "load-balancers"
name = "Load Balancers"
strategy = "any-up"
degradedThreshold = 0  # Not used for any-up
interval = 60
resendNotification = 0
```

| Children Status | Group Status |
| --------------- | ------------ |
| 3 up, 0 down    | UP           |
| 2 up, 1 down    | UP           |
| 1 up, 2 down    | UP           |
| 0 up, 3 down    | DOWN         |

### all-up

The group is **UP** only if all children are up.

**Use case:** Critical dependencies where every component matters.

```toml
[[groups]]
id = "payment-chain"
name = "Payment Processing"
strategy = "all-up"
degradedThreshold = 0  # Not used for all-up
interval = 60
resendNotification = 0
```

| Children Status | Group Status |
| --------------- | ------------ |
| 3 up, 0 down    | UP           |
| 2 up, 1 down    | DOWN         |
| 1 up, 2 down    | DOWN         |
| 0 up, 3 down    | DOWN         |

### percentage

The group status depends on what percentage of children are up.

**Use case:** Services where partial availability is acceptable but should be noticed.

```toml
[[groups]]
id = "api-servers"
name = "API Servers"
strategy = "percentage"
degradedThreshold = 50  # Below 50% = DOWN, 50-99% = DEGRADED, 100% = UP
interval = 60
resendNotification = 0
```

| Children Status | Percentage | Group Status    |
| --------------- | ---------- | --------------- |
| 4 up, 0 down    | 100%       | UP              |
| 3 up, 1 down    | 75%        | DEGRADED (≥50%) |
| 2 up, 2 down    | 50%        | DEGRADED (≥50%) |
| 1 up, 3 down    | 25%        | DOWN (<50%)     |
| 0 up, 4 down    | 0%         | DOWN            |

## Nested Groups

Groups can contain other groups for hierarchical organization.

```toml
# Top-level group
[[groups]]
id = "all-services"
name = "All Services"
strategy = "percentage"
degradedThreshold = 75
interval = 60
resendNotification = 0

# Child groups
[[groups]]
id = "production"
name = "Production"
parentId = "all-services"
strategy = "percentage"
degradedThreshold = 50
interval = 60
resendNotification = 0

[[groups]]
id = "staging"
name = "Staging"
parentId = "all-services"
strategy = "any-up"
degradedThreshold = 0
interval = 60
resendNotification = 0
```

**Hierarchy:**

```
all-services (percentage, 75%)
├── production (percentage, 50%)
│   ├── api-prod (monitor)
│   ├── web-prod (monitor)
│   └── db-prod (monitor)
└── staging (any-up)
    ├── api-staging (monitor)
    └── web-staging (monitor)
```

## Assigning Monitors to Groups

Use the `groupId` field on monitors:

```toml
[[monitors]]
id = "api-prod"
name = "Production API"
token = "secret"
interval = 30
maxRetries = 0
resendNotification = 0
groupId = "production"  # This monitor belongs to the "production" group
```

## Group Uptime Calculation

Group uptime is computed from child uptimes using the same strategy:

| Strategy     | Uptime Calculation       |
| ------------ | ------------------------ |
| `any-up`     | Maximum of child uptimes |
| `all-up`     | Minimum of child uptimes |
| `percentage` | Average of child uptimes |

**Example with percentage strategy:**

- Monitor A: 99.5% uptime
- Monitor B: 98.0% uptime
- Monitor C: 100% uptime
- **Group uptime:** (99.5 + 98.0 + 100) / 3 = **99.17%**

## Group History

Groups don't store their own pulses—history is computed from children in real-time.

```bash
# Get raw history (~24h)
curl http://localhost:3000/v1/groups/production/history

# Get hourly history (~90 days)
curl http://localhost:3000/v1/groups/production/history/hourly

# Get daily history (forever)
curl http://localhost:3000/v1/groups/production/history/daily
```

**Response includes the strategy used:**

```json
{
	"groupId": "production",
	"type": "hourly",
	"strategy": "percentage",
	"data": [
		{
			"timestamp": "2025-01-15T10:00:00Z",
			"uptime": 99.5,
			"latency_min": 30,
			"latency_max": 150,
			"latency_avg": 65.3
		}
	]
}
```

## Group Notifications

Groups can have their own notification channels:

```toml
[[groups]]
id = "production"
name = "Production"
strategy = "percentage"
degradedThreshold = 50
interval = 60
resendNotification = 12
notificationChannels = ["critical", "ops-team"]
```

When a group goes down (based on its strategy), notifications are sent to all configured channels.

### Resend Notifications for Groups

The `resendNotification` field works the same as for monitors:

```toml
[missingPulseDetector]
interval = 5

[[groups]]
id = "production"
strategy = "percentage"
degradedThreshold = 50
interval = 60
resendNotification = 12  # Remind every 12 checks while down
notificationChannels = ["critical"]
```

With `interval = 5` and `resendNotification = 12`:

- "Group Down" notification sent immediately
- "Still Down" reminder every 5 × 12 = 60 seconds
- "Recovered" notification when group is up again

## Status Page Display

Groups are displayed on status pages with their children:

```toml
[[status_pages]]
id = "public"
name = "Status"
slug = "status"
items = ["all-services"]  # Shows the group and all nested children
```

**API Response:**

```json
{
	"name": "Status",
	"slug": "status",
	"items": [
		{
			"id": "all-services",
			"type": "group",
			"name": "All Services",
			"status": "degraded",
			"uptime24h": 98.5,
			"children": [
				{
					"id": "production",
					"type": "group",
					"name": "Production",
					"status": "up",
					"children": [
						{
							"id": "api-prod",
							"type": "monitor",
							"name": "Production API",
							"status": "up"
						}
					]
				}
			]
		}
	]
}
```

## Best Practices

### 1. Match strategy to criticality

| Service Type             | Recommended Strategy               |
| ------------------------ | ---------------------------------- |
| Redundant load balancers | `any-up`                           |
| Payment processing chain | `all-up`                           |
| General services         | `percentage` with 50-75% threshold |

### 2. Set meaningful thresholds

For `percentage` strategy:

- **75-90%**: For services with built-in redundancy
- **50%**: For services where half availability is acceptable
- **25%**: For non-critical services

### 3. Don't nest too deeply

While nesting is supported, keep it to 2-3 levels for clarity:

```
all-services
├── production
│   └── (monitors)
├── staging
│   └── (monitors)
└── infrastructure
    └── (monitors)
```

### 4. Use groups for logical organization

Even if you use `percentage` with 100% threshold (similar to `all-up`), groups help organize your status page and provide aggregate uptime statistics.
