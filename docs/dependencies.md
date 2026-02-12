# Dependencies & Notification Suppression

When infrastructure fails, you typically don't want a flood of notifications for every service affected by the same root cause. For example, if a server goes down, you shouldn't get separate alerts for the server _and_ each of the three apps running on it - just one notification for the server is enough.

Dependencies let you define these relationships so that only the **highest-level** entity that is down triggers a notification.

## How It Works

Both monitors and groups support an optional `dependencies` array. This is a list of monitor or group IDs that the entity depends on. When a notification would normally be sent (down, still-down, or recovered), the system first checks whether any of the listed dependencies are currently down. If so, the notification is **suppressed**.

This means:

- **Down notifications** are suppressed if a dependency is already down
- **Still-down reminders** are suppressed if a dependency is still down
- **Recovery notifications** are suppressed if the user never saw a down notification (because it was suppressed)
- **Status tracking is unaffected** - uptime calculations, group health, and status pages all continue to work normally. Only notifications are suppressed.

## Configuration

### Monitor Dependencies

```toml
[[monitors]]
id = "app-1"
name = "App 1"
token = "token-app-1"
interval = 30
maxRetries = 0
resendNotification = 0
groupId = "server-1"
dependencies = ["server-1"]   # Suppress notifications if server-1 is down
notificationChannels = ["discord"]
```

### Group Dependencies

```toml
[[groups]]
id = "server-1"
name = "Server 1"
strategy = "all-up"
degradedThreshold = 50
interval = 30
resendNotification = 0
dependencies = ["network"]   # Suppress notifications if network group is down
notificationChannels = ["discord"]
```

### Field Reference

| Field          | Type       | Default     | Description                                                                                                           |
| -------------- | ---------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `dependencies` | `string[]` | `[]` (none) | Array of monitor or group IDs. If any listed ID has a status of "down", notifications for this entity are suppressed. |

## Example: Multi-Layer Infrastructure

Consider this infrastructure:

```
Internet -> Core Network -> Server -> [App1, App2, App3]
```

Configure it like this:

```toml
# Internet connectivity monitor
[[monitors]]
id = "internet"
name = "Internet"
token = "token-internet"
interval = 30
maxRetries = 0
resendNotification = 0
notificationChannels = ["discord"]

# Core network group depends on internet
[[groups]]
id = "network"
name = "Core Network"
strategy = "all-up"
degradedThreshold = 50
interval = 30
resendNotification = 0
dependencies = ["internet"]
notificationChannels = ["discord"]

# Server group depends on network
[[groups]]
id = "server-1"
name = "Server 1"
strategy = "all-up"
degradedThreshold = 50
interval = 30
resendNotification = 0
parentId = "network"
dependencies = ["network"]
notificationChannels = ["discord"]

# Apps depend on their server
[[monitors]]
id = "app-1"
name = "App 1"
token = "token-app-1"
interval = 30
maxRetries = 0
resendNotification = 0
groupId = "server-1"
dependencies = ["server-1"]
notificationChannels = ["discord"]

[[monitors]]
id = "app-2"
name = "App 2"
token = "token-app-2"
interval = 30
maxRetries = 0
resendNotification = 0
groupId = "server-1"
dependencies = ["server-1"]
notificationChannels = ["discord"]

[[monitors]]
id = "app-3"
name = "App 3"
token = "token-app-3"
interval = 30
maxRetries = 0
resendNotification = 0
groupId = "server-1"
dependencies = ["server-1"]
notificationChannels = ["discord"]
```

### What happens when the server goes down?

1. **Server 1** group goes down → notification is sent (its dependency `network` is still up)
2. **App 1, App 2, App 3** all go down → notifications are **suppressed** (their dependency `server-1` is down)
3. You receive **one notification** instead of four

### What happens when the internet goes down?

1. **Internet** monitor goes down → notification is sent (it has no dependencies)
2. **Core Network** goes down → notification is **suppressed** (its dependency `internet` is down)
3. **Server 1** goes down → notification is **suppressed** (its dependency `network` is down)
4. **App 1, App 2, App 3** go down → notifications are **suppressed** (their dependency `server-1` is down)
5. You receive **one notification** instead of six

### What about recovery?

When everything comes back up, only the Internet monitor sends a recovery notification. The downstream entities were never announced as down, so their recovery notifications are also suppressed.

## Dependencies vs Group Hierarchy

It's important to understand that `dependencies` and the group hierarchy (`groupId` / `parentId`) serve different purposes:

| Concept             | Purpose                                                                               | Config Field                              |
| ------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Group hierarchy** | Status aggregation - calculating group health from children, organizing status pages  | `groupId` (monitors), `parentId` (groups) |
| **Dependencies**    | Notification suppression - preventing alert storms when upstream infrastructure fails | `dependencies` (monitors and groups)      |

These are orthogonal. A monitor might belong to a group for display purposes but depend on a completely different entity for notification suppression. You can use both, either, or neither.

That said, it's common for `dependencies` to mirror the group hierarchy, as in the example above where apps depend on their parent group.

## Multiple Dependencies

A monitor or group can depend on multiple entities:

```toml
[[monitors]]
id = "web-app"
name = "Web App"
token = "token-web-app"
interval = 30
maxRetries = 0
resendNotification = 0
dependencies = ["server-1", "database", "cdn"]
notificationChannels = ["discord"]
```

If **any** of `server-1`, `database`, or `cdn` is down, notifications for `web-app` are suppressed. All dependencies must be up for notifications to fire normally.

## Validation Rules

The configuration validates dependencies at load time:

- **References must exist**: Every ID in `dependencies` must correspond to an existing monitor or group
- **No self-dependencies**: A monitor/group cannot list itself in its own `dependencies`
- **No circular dependencies**: If A depends on B, B cannot depend on A (directly or transitively)
- **Cross-type references are allowed**: A monitor can depend on a group, and a group can depend on a monitor

Invalid configurations will cause the server to exit with a descriptive error message at startup.

## Edge Cases

- **Startup / grace period**: During the initial grace period after server startup, no notifications are sent anyway, so dependency suppression is not relevant
- **Unknown status**: If a dependency has no status yet (e.g., it hasn't been checked), it's treated as "not down" - no suppression occurs
- **Hot reload**: Dependencies are re-validated when configuration is hot-reloaded via the `/v1/reload/:token` endpoint
