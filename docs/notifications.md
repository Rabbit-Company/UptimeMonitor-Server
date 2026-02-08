# Notifications

Uptime Monitor supports multiple notification providers. Notifications are organized into **channels**, and each monitor or group can subscribe to one or more channels.

## How It Works

1. **Define channels** - Each channel has a unique ID and can have multiple providers (Discord, Email, Ntfy)
2. **Assign channels to monitors/groups** - Use the `notificationChannels` array
3. **Receive alerts** - When a monitor goes down, recovers, or stays down, notifications are sent to all providers in the assigned channels

## Notification Types

| Type         | Trigger                                                  |
| ------------ | -------------------------------------------------------- |
| `down`       | Monitor/group just went down                             |
| `still-down` | Monitor/group remains down after N checks (configurable) |
| `recovered`  | Monitor/group came back up                               |

## Channel Configuration

```toml
[notifications.channels.critical]
id = "critical"
name = "Critical Production Alerts"
description = "High-priority alerts for production outages"
enabled = true
```

| Field         | Required | Description                            |
| ------------- | -------- | -------------------------------------- |
| `id`          | Yes      | Unique identifier (must match the key) |
| `name`        | Yes      | Human-readable name                    |
| `description` | No       | Optional description                   |
| `enabled`     | Yes      | Master switch for this channel         |

## Discord

```toml
[notifications.channels.critical.discord]
enabled = true
webhookUrl = "https://discord.com/api/webhooks/123456/abcdef..."
username = "Uptime Bot"
avatarUrl = "https://example.com/bot-avatar.png"

[notifications.channels.critical.discord.mentions]
everyone = false
users = ["123456789012345678"]
roles = ["987654321098765432"]
```

| Field               | Required | Description                  |
| ------------------- | -------- | ---------------------------- |
| `enabled`           | Yes      | Enable Discord notifications |
| `webhookUrl`        | Yes      | Discord webhook URL          |
| `username`          | No       | Bot display name             |
| `avatarUrl`         | No       | Bot avatar URL               |
| `mentions.everyone` | No       | Mention @everyone            |
| `mentions.users`    | No       | Array of user IDs to mention |
| `mentions.roles`    | No       | Array of role IDs to mention |

### Getting a Discord Webhook URL

1. Open Discord server settings
2. Go to **Integrations** → **Webhooks**
3. Click **New Webhook**
4. Choose the channel and copy the URL

## Email

```toml
[notifications.channels.critical.email]
enabled = true
from = '"Uptime Monitor" <alerts@example.com>'
to = ["admin@example.com", "ops@example.com"]

[notifications.channels.critical.email.smtp]
host = "smtp.example.com"
port = 465
secure = true
user = "alerts@example.com"
pass = "your-smtp-password"
```

| Field         | Required | Description                               |
| ------------- | -------- | ----------------------------------------- |
| `enabled`     | Yes      | Enable email notifications                |
| `from`        | Yes      | Sender address (can include display name) |
| `to`          | Yes      | Array of recipient addresses              |
| `smtp.host`   | Yes      | SMTP server hostname                      |
| `smtp.port`   | Yes      | SMTP port (usually 465 or 587)            |
| `smtp.secure` | Yes      | Use TLS (true for port 465)               |
| `smtp.user`   | Yes      | SMTP username                             |
| `smtp.pass`   | Yes      | SMTP password                             |

### Email Providers

**Gmail:**

```toml
[notifications.channels.alerts.email.smtp]
host = "smtp.gmail.com"
port = 465
secure = true
user = "your-email@gmail.com"
pass = "your-app-password"  # Use App Password, not regular password
```

**SendGrid:**

```toml
[notifications.channels.alerts.email.smtp]
host = "smtp.sendgrid.net"
port = 465
secure = true
user = "apikey"
pass = "SG.your-api-key"
```

**Amazon SES:**

```toml
[notifications.channels.alerts.email.smtp]
host = "email-smtp.us-east-1.amazonaws.com"
port = 465
secure = true
user = "your-ses-smtp-user"
pass = "your-ses-smtp-password"
```

## Ntfy

[Ntfy](https://ntfy.sh) is a simple HTTP-based pub-sub notification service.

```toml
[notifications.channels.critical.ntfy]
enabled = true
server = "https://ntfy.sh"
topic = "my-uptime-alerts"
# Optional authentication
token = "tk_your_access_token"
# Or username/password
# username = "your-username"
# password = "your-password"
```

| Field      | Required | Description                             |
| ---------- | -------- | --------------------------------------- |
| `enabled`  | Yes      | Enable Ntfy notifications               |
| `server`   | Yes      | Ntfy server URL                         |
| `topic`    | Yes      | Topic name (like a channel)             |
| `token`    | No       | Access token for authentication         |
| `username` | No       | Username (must be paired with password) |
| `password` | No       | Password (must be paired with username) |

### Self-Hosted Ntfy

```toml
[notifications.channels.critical.ntfy]
enabled = true
server = "https://ntfy.your-domain.com"
topic = "uptime-alerts"
username = "admin"
password = "secret"
```

### Subscribing to Ntfy Topics

**Mobile App:** Download from [Google Play](https://play.google.com/store/apps/details?id=io.heckel.ntfy) or [App Store](https://apps.apple.com/app/ntfy/id1625396347)

**Web:** Visit `https://ntfy.sh/your-topic` or your self-hosted instance

**CLI:**

```bash
ntfy subscribe my-uptime-alerts
```

## Telegram

Send notifications to Telegram chats, groups, or channels via a bot.

### Configuration

```toml
[notifications.channels.critical.telegram]
enabled = true
botToken = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
chatId = "-1001234567890"
# Optional: send to a specific forum topic
# topicId = 123
# Optional: send silently
# disableNotification = false

```

| Field                 | Required | Description                                     |
| --------------------- | -------- | ----------------------------------------------- |
| `enabled`             | Yes      | Enable Telegram notifications                   |
| `botToken`            | Yes      | Bot API token from @BotFather                   |
| `chatId`              | Yes      | Target chat/group/channel ID                    |
| `topicId`             | No       | Forum topic ID (for groups with topics enabled) |
| `disableNotification` | No       | Send silently without notification sound        |

### Setting Up a Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the bot token provided
4. Add the bot to your group/channel
5. Get the chat ID:
   - For groups: add [@userinfobot](https://t.me/userinfobot) to the group, or use the Telegram Bot API `getUpdates` endpoint
   - For channels: forward a message from the channel to @userinfobot
   - For direct messages: message the bot and check `getUpdates`

### Forum Topics

If your group has topics (forum mode) enabled, you can send to a specific topic:

```toml
[notifications.channels.critical.telegram]
enabled = true
botToken = "123456:ABC-DEF..."
chatId = "-1001234567890"
topicId = 42
```

## Assigning Channels to Monitors

```toml
[[monitors]]
id = "api-prod"
name = "Production API"
token = "secret"
interval = 30
maxRetries = 0
resendNotification = 12
notificationChannels = ["critical", "ops-team"]
```

## Assigning Channels to Groups

```toml
[[groups]]
id = "production"
name = "Production Services"
strategy = "percentage"
degradedThreshold = 50
interval = 60
resendNotification = 12
notificationChannels = ["critical"]
```

## Resend Notifications

The `resendNotification` field controls "still-down" reminders:

| Value | Behavior                               |
| ----- | -------------------------------------- |
| `0`   | Never resend (only down and recovered) |
| `N`   | Resend every N consecutive down checks |

**Example:** With `interval = 5` and `resendNotification = 12`:

- Down notification sent immediately
- "Still down" reminder every 5 × 12 = 60 seconds while down
- Recovery notification when back up

## Multiple Providers per Channel

A channel can have multiple providers enabled simultaneously:

```toml
[notifications.channels.critical]
id = "critical"
name = "Critical Alerts"
enabled = true

[notifications.channels.critical.discord]
enabled = true
webhookUrl = "https://discord.com/api/webhooks/..."

[notifications.channels.critical.email]
enabled = true
from = "alerts@example.com"
to = ["admin@example.com"]
# ... smtp config

[notifications.channels.critical.ntfy]
enabled = true
server = "https://ntfy.sh"
topic = "critical-alerts"
```

All enabled providers receive every notification for that channel.

## Multiple Channels

Create different channels for different audiences:

```toml
# Critical alerts for on-call
[notifications.channels.critical]
id = "critical"
name = "Critical"
enabled = true

[notifications.channels.critical.discord]
enabled = true
webhookUrl = "https://discord.com/api/webhooks/.../critical"

# Non-critical for general awareness
[notifications.channels.general]
id = "general"
name = "General"
enabled = true

[notifications.channels.general.discord]
enabled = true
webhookUrl = "https://discord.com/api/webhooks/.../general"
```

Then assign appropriately:

```toml
[[monitors]]
id = "payment-api"
notificationChannels = ["critical"]  # Payment is critical

[[monitors]]
id = "blog"
notificationChannels = ["general"]   # Blog is not critical
```

## Troubleshooting

### Discord webhook not working

1. Verify the webhook URL is correct
2. Check that the webhook hasn't been deleted in Discord
3. Look for error messages in server logs

### Email not sending

1. Verify SMTP credentials
2. Check if your email provider requires "App Passwords" (Gmail, etc.)
3. Ensure the `secure` setting matches your port (465 = true, 587 = false usually)
4. Check firewall rules for outbound SMTP

### Ntfy notifications not received

1. Verify the topic name matches your subscription
2. Check authentication credentials if using a private topic
3. Test manually: `curl -d "test" https://ntfy.sh/your-topic`

### Channel shows as "not found or disabled"

1. Ensure `enabled = true` on both the channel and at least one provider
2. Check that the channel ID matches exactly (case-sensitive)
3. Reload configuration: `curl http://localhost:3000/v1/reload/your-token`
