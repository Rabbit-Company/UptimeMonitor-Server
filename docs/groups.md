# Groups & Strategies

Groups let you organize monitors and other groups hierarchically and define how their combined health is calculated. Both groups and monitors can hold children, allowing flexible tree structures.

## Basic Group

```toml
[[groups]]
id = "production"
name = "Production Services"
strategy = "percentage"
degradedThreshold = 50
interval = 60
resendNotification = 0
children = ["api-prod", "web-prod", "db-prod"]
```

## Group Strategies

Strategies and `degradedThreshold` are only used by groups to calculate their status from children. Monitors do not need strategies (They always derive their own status from their pulses).

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
children = ["lb-1", "lb-2", "lb-3"]
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
children = ["payment-gateway", "payment-db", "payment-queue"]
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
children = ["api-1", "api-2", "api-3", "api-4"]
```

| Children Status | Percentage | Group Status    |
| --------------- | ---------- | --------------- |
| 4 up, 0 down    | 100%       | UP              |
| 3 up, 1 down    | 75%        | DEGRADED (≥50%) |
| 2 up, 2 down    | 50%        | DEGRADED (≥50%) |
| 1 up, 3 down    | 25%        | DOWN (<50%)     |
| 0 up, 4 down    | 0%         | DOWN            |

## Nested Groups

Groups can contain other groups for hierarchical organization. Structure is defined **top-down**. A parent lists its children using the `children` array.

```toml
# Top-level group
[[groups]]
id = "all-services"
name = "All Services"
strategy = "percentage"
degradedThreshold = 75
interval = 60
resendNotification = 0
children = ["production", "staging"]

# Child groups
[[groups]]
id = "production"
name = "Production"
strategy = "percentage"
degradedThreshold = 50
interval = 60
resendNotification = 0
children = ["api-prod", "web-prod", "db-prod"]

[[groups]]
id = "staging"
name = "Staging"
strategy = "any-up"
degradedThreshold = 0
interval = 60
resendNotification = 0
children = ["api-staging", "web-staging"]
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

## Shared Children

A monitor or group can appear in multiple parents' `children` arrays. This allows the same monitor to be part of several groups simultaneously.

```toml
[[groups]]
id = "production"
name = "Production Services"
strategy = "percentage"
degradedThreshold = 50
interval = 60
resendNotification = 0
children = ["shared-db"]

[[groups]]
id = "infrastructure"
name = "Infrastructure"
strategy = "all-up"
degradedThreshold = 0
interval = 60
resendNotification = 0
children = ["shared-db", "cdn-global"]
```

In this example, the `shared-db` monitor belongs to both the `production` and `infrastructure` groups.

## Monitors with Children

Monitors can also have children. This allows you to define dependency trees where a monitor holds other monitors or groups beneath it. Note that monitors do **not** have `strategy` or `degradedThreshold`. These are only used by groups for uptime aggregation. Monitors always derive their own status from their own pulses.

```toml
[[monitors]]
id = "server-1"
name = "Server 1"
token = "secret-server-1"
interval = 30
maxRetries = 0
resendNotification = 0
children = ["app-1", "app-2", "app-3"]
```

## Dependencies vs Children Hierarchy

The children hierarchy (`children`) and `dependencies` serve different purposes:

- **Children hierarchy** (`children`) is for **status aggregation** - calculating whether a group is up, down, or degraded based on its children. It also determines how monitors and groups are organized on status pages.
- **Dependencies** is for **notification suppression** - when a dependency is down, notifications for the dependent entity are suppressed to avoid alert storms.

These are orthogonal. A group can have `children` for status aggregation and completely different `dependencies` for notification suppression. That said, it is common for them to overlap.

```toml
# This group holds server monitors as children for status purposes,
# but depends on "network" for notification suppression
[[groups]]
id = "servers"
name = "Servers"
strategy = "all-up"
degradedThreshold = 50
interval = 30
resendNotification = 0
children = ["server-1", "server-2"]
dependencies = ["network"]
notificationChannels = ["discord"]
```

See [Dependencies](dependencies.md) for full documentation and examples.

## Group Uptime Calculation

Group uptime is computed from child uptimes using the group's strategy:

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

Groups do not store their own pulses. History is computed from children in real-time.
