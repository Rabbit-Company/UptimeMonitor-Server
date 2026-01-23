import type { NodeClickHouseClientConfigOptions } from "@clickhouse/client/dist/config";
import type { IpExtractionPreset } from "@rabbit-company/web-middleware/ip-extract";

/**
 * Configuration options for the logger.
 */
export interface LoggerConfig {
	/** Logging level (0 = ERROR, 1 = WARN, 2 = AUDIT, 3 = INFO, 4 = HTTP, 5 = DEBUG, 6 = VERBOSE, 7 = SILLY) */
	level?: number;
}

/**
 * Configuration for a custom metric that can be tracked alongside latency.
 */
export interface CustomMetricConfig {
	/** Unique identifier for this metric (used in API requests) */
	id: string;
	/** Human-readable name for display */
	name: string;
	/** Optional unit of measurement (e.g., "players", "ms", "MB") */
	unit?: string;
}

/**
 * HTTP pulse monitoring configuration
 */
export interface PulseHttpConfig {
	/** HTTP method (GET, POST, HEAD) */
	method?: string;
	/** URL to monitor */
	url: string;
	/** Request timeout in seconds */
	timeout?: number;
	/** Optional headers */
	headers?: Array<Record<string, string>>;
}

/**
 * WebSocket pulse monitoring configuration
 */
export interface PulseWsConfig {
	/** WebSocket URL */
	url: string;
	/** Connection timeout in seconds */
	timeout?: number;
}

/**
 * TCP pulse monitoring configuration
 */
export interface PulseTcpConfig {
	/** Host to connect to */
	host: string;
	/** Port number */
	port: number;
	/** Connection timeout in seconds */
	timeout?: number;
}

/**
 * UDP pulse monitoring configuration
 */
export interface PulseUdpConfig {
	/** Host to send to */
	host: string;
	/** Port number */
	port: number;
	/** Timeout in seconds */
	timeout?: number;
	/** Payload to send */
	payload?: string;
	/** Whether to expect a response */
	expectResponse?: boolean;
}

/**
 * ICMP (ping) pulse monitoring configuration
 */
export interface PulseIcmpConfig {
	/** Host to ping */
	host: string;
	/** Timeout in seconds */
	timeout?: number;
}

/**
 * SMTP pulse monitoring configuration
 */
export interface PulseSmtpConfig {
	/** SMTP URL (e.g., smtps://user:pass@hostname:port) */
	url: string;
}

/**
 * IMAP pulse monitoring configuration
 */
export interface PulseImapConfig {
	/** IMAP server hostname */
	server: string;
	/** Port number */
	port: number;
	/** Username */
	username: string;
	/** Password */
	password: string;
}

/**
 * MySQL pulse monitoring configuration
 */
export interface PulseMysqlConfig {
	/** MySQL connection URL */
	url: string;
	/** Connection timeout in seconds */
	timeout?: number;
}

/**
 * MSSQL pulse monitoring configuration
 */
export interface PulseMssqlConfig {
	/** MSSQL JDBC connection URL */
	url: string;
	/** Connection timeout in seconds */
	timeout?: number;
}

/**
 * PostgreSQL pulse monitoring configuration
 */
export interface PulsePostgresqlConfig {
	/** PostgreSQL connection URL */
	url: string;
	/** Connection timeout in seconds */
	timeout?: number;
	/** Whether to use TLS */
	useTls?: boolean;
}

/**
 * Redis pulse monitoring configuration
 */
export interface PulseRedisConfig {
	/** Redis connection URL */
	url: string;
	/** Connection timeout in seconds */
	timeout?: number;
}

/**
 * Pulse monitoring configuration - defines what PulseMonitor should check
 * Only one type should be configured per monitor
 */
export interface PulseConfig {
	/** HTTP monitoring */
	http?: PulseHttpConfig;
	/** WebSocket monitoring */
	ws?: PulseWsConfig;
	/** TCP monitoring */
	tcp?: PulseTcpConfig;
	/** UDP monitoring */
	udp?: PulseUdpConfig;
	/** ICMP (ping) monitoring */
	icmp?: PulseIcmpConfig;
	/** SMTP monitoring */
	smtp?: PulseSmtpConfig;
	/** IMAP monitoring */
	imap?: PulseImapConfig;
	/** MySQL monitoring */
	mysql?: PulseMysqlConfig;
	/** MSSQL monitoring */
	mssql?: PulseMssqlConfig;
	/** PostgreSQL monitoring */
	postgresql?: PulsePostgresqlConfig;
	/** Redis monitoring */
	redis?: PulseRedisConfig;
}

/**
 * Represents a PulseMonitor instance that can be deployed to different regions.
 * PulseMonitors connect via WebSocket and receive configuration for monitors they should target.
 */
export interface PulseMonitor {
	/** Unique PulseMonitor ID (e.g., "US-WEST-1", "EU-CENTRAL-1") */
	id: string;
	/** Human-readable name for this PulseMonitor instance */
	name: string;
	/** Authentication token for WebSocket connection */
	token: string;
}

/**
 * Represents a monitor that checks uptime.
 */
export interface Monitor {
	/** Unique monitor ID */
	id: string;
	/** Monitor display name */
	name: string;
	/** Monitor access token used to identify incoming pulses */
	token: string;
	/** Check interval in seconds */
	interval: number;
	/** Maximum missed checks before marking the monitor as down */
	maxRetries: number;
	/** Resend notification after this many consecutive down checks (0 = never) */
	resendNotification: number;
	/** Optional group ID this monitor belongs to */
	groupId?: string;
	/** Notification channel IDs to use for this monitor */
	notificationChannels?: string[];
	/** Configuration for custom metric 1 */
	custom1?: CustomMetricConfig;
	/** Configuration for custom metric 2 */
	custom2?: CustomMetricConfig;
	/** Configuration for custom metric 3 */
	custom3?: CustomMetricConfig;
	/** Optional pulse monitoring configuration for PulseMonitor */
	pulse?: PulseConfig;
	/** Array of PulseMonitor IDs that should target this monitor */
	pulseMonitors?: string[];
}

/**
 * Represents a group of monitors or nested groups.
 */
export interface Group {
	/** Unique group ID */
	id: string;
	/** Group display name */
	name: string;
	/**
	 * Strategy for determining group status based on child statuses:
	 * - "any-up": Group is UP if at least one child is up, DOWN if all children are down
	 * - "percentage": Group is UP if 100% children are up, DEGRADED if >= degradedThreshold% are up, DOWN otherwise
	 * - "all-up": Group is UP only if all children are up, DOWN if any child is down
	 */
	strategy: "any-up" | "percentage" | "all-up";
	/** Percentage of children that must be up to consider this group healthy (0–100) */
	degradedThreshold: number;
	/** Uses this interval when calculating uptime of a group */
	interval: number;
	/** Optional parent group ID */
	parentId?: string;
	/** Notification channel IDs to use for this group */
	notificationChannels?: string[];
}

/**
 * Represents a public-facing status page.
 */
export interface StatusPage {
	/** Unique status page ID */
	id: string;
	/** Status page display name */
	name: string;
	/** URL slug for accessing the page */
	slug: string;
	/** Array of monitor or group IDs displayed on the page */
	items: string[];
}

/**
 * Configuration for the HTTP server.
 */
export interface ServerConfig {
	/** Port number the server will listen on */
	port: number;
	/** Type for available IP extraction presets */
	proxy: IpExtractionPreset;
	/** Token for reloading configuration via API (auto-generated if not provided) */
	reloadToken: string;
}

/**
 * Application configuration object.
 */
export interface Config {
	/** ClickHouse connection options */
	clickhouse: NodeClickHouseClientConfigOptions;
	/** Server-specific configuration */
	server: ServerConfig;
	/** Logger configuration */
	logger: LoggerConfig;
	/** Self-monitoring and automatic backfill configuration */
	selfMonitoring: SelfMonitoringConfig;
	/** Missing pulse detector configuration */
	missingPulseDetector: MissingPulseDetectorConfig;
	/** List of PulseMonitor instances */
	pulseMonitors: PulseMonitor[];
	/** List of defined monitors */
	monitors: Monitor[];
	/** List of defined groups */
	groups: Group[];
	/** List of status pages */
	statusPages: StatusPage[];
	notifications?: NotificationsConfig;
}

/**
 * Represents a single pulse event from a monitor.
 */
export interface Pulse {
	/** ID of the monitor sending the pulse */
	monitorId: string;
	/** Response latency in milliseconds */
	latency: number | null;
	/** Timestamp of when the pulse was received */
	timestamp: Date;
	/** Custom metric 1 value */
	custom1: number | null;
	/** Custom metric 2 value */
	custom2: number | null;
	/** Custom metric 3 value */
	custom3: number | null;
}

/**
 * Custom metric data returned in status responses.
 */
export interface CustomMetricData {
	/** The metric configuration from the monitor */
	config: CustomMetricConfig;
	/** Current value of the metric (undefined if no data) */
	value?: number;
}

/**
 * Status data returned for monitors or groups.
 */
export interface StatusData {
	/** ID of the monitor or group */
	id: string;
	/** Type of the item (monitor or group) */
	type: "monitor" | "group";
	/** Display name */
	name: string;
	/** Current status */
	status: "up" | "down" | "degraded";
	/** Latest measured latency */
	latency: number;
	/** Timestamp of the last check */
	lastCheck?: Date;
	/** Timestamp of the first received pulse */
	firstPulse?: Date;
	/** 1-hour uptime percentage */
	uptime1h: number;
	/** 24-hour uptime percentage */
	uptime24h: number;
	/** 7-day uptime percentage */
	uptime7d: number;
	/** 30-day uptime percentage */
	uptime30d: number;
	/** 90-day uptime percentage */
	uptime90d: number;
	/** 365-day uptime percentage */
	uptime365d: number;
	/** Children status data (for groups) */
	children?: StatusData[];
	/** Custom metric 1 data (for monitors) */
	custom1?: CustomMetricData;
	/** Custom metric 2 data (for monitors) */
	custom2?: CustomMetricData;
	/** Custom metric 3 data (for monitors) */
	custom3?: CustomMetricData;
}

/**
 * Server-Sent Event (SSE) data sent to clients.
 */
export interface SSEPulseEvent {
	/** Type of event: 'pulse' or 'ping' */
	type: "pulse" | "ping";
	/** Monitor ID (for 'pulse' events) */
	monitorId?: string;
	/** Current status of the monitor (always 'up' for pulses) */
	status?: "up";
	/** Measured latency */
	latency?: number;
	/** Timestamp of the event */
	timestamp?: Date;
	/** Custom metric 1 value */
	custom1?: number | null;
	/** Custom metric 2 value */
	custom2?: number | null;
	/** Custom metric 3 value */
	custom3?: number | null;
}

export interface SelfMonitoringConfig {
	/** Enable self-monitoring and automatic backfill */
	enabled: boolean;
	/** ID of the self-monitor */
	id: string;
	/** Health check interval in seconds */
	interval: number;
	/** Backfill synthetic pulses for monitors that were healthy before downtime */
	backfillOnRecovery: boolean;
	/** Strategy for synthetic pulse latency */
	latencyStrategy: "last-known" | "null";
}

export interface MissingPulseDetectorConfig {
	/** Check interval in seconds (default: 5) */
	interval: number;
}

/**
 * Raw pulse data aggregated per-interval (from pulses table, ~24h retention)
 * Computed in real-time
 */
export interface PulseRaw {
	/** Interval start timestamp (ISO format) */
	timestamp: string;
	/** Uptime percentage for this interval (0 or 100) */
	uptime: number;
	/** Minimum latency in this interval */
	latency_min?: number;
	/** Maximum latency in this interval */
	latency_max?: number;
	/** Average latency in this interval */
	latency_avg?: number;
	/** Minimum custom1 value in this interval */
	custom1_min?: number;
	/** Maximum custom1 value in this interval */
	custom1_max?: number;
	/** Average custom1 value in this interval */
	custom1_avg?: number;
	/** Minimum custom2 value in this interval */
	custom2_min?: number;
	/** Maximum custom2 value in this interval */
	custom2_max?: number;
	/** Average custom2 value in this interval */
	custom2_avg?: number;
	/** Minimum custom3 value in this interval */
	custom3_min?: number;
	/** Maximum custom3 value in this interval */
	custom3_max?: number;
	/** Average custom3 value in this interval */
	custom3_avg?: number;
}

/**
 * Hourly aggregated data (from pulses_hourly table, ~90 day retention)
 */
export interface PulseHourly {
	/** Hour timestamp (ISO format, e.g., "2025-01-08T14:00:00Z") */
	timestamp: string;
	/** Uptime percentage for this hour (0-100) */
	uptime: number;
	/** Minimum latency in this hour */
	latency_min?: number;
	/** Maximum latency in this hour */
	latency_max?: number;
	/** Average latency in this hour */
	latency_avg?: number;
	/** Minimum custom1 value in this hour */
	custom1_min?: number;
	/** Maximum custom1 value in this hour */
	custom1_max?: number;
	/** Average custom1 value in this hour */
	custom1_avg?: number;
	/** Minimum custom2 value in this hour */
	custom2_min?: number;
	/** Maximum custom2 value in this hour */
	custom2_max?: number;
	/** Average custom2 value in this hour */
	custom2_avg?: number;
	/** Minimum custom3 value in this hour */
	custom3_min?: number;
	/** Maximum custom3 value in this hour */
	custom3_max?: number;
	/** Average custom3 value in this hour */
	custom3_avg?: number;
}

/**
 * Daily aggregated data (from pulses_daily table, kept forever)
 */
export interface PulseDaily {
	/** Date timestamp (YYYY-MM-DD format) */
	timestamp: string;
	/** Uptime percentage for this day (0-100) */
	uptime: number;
	/** Minimum latency on this day */
	latency_min?: number;
	/** Maximum latency on this day */
	latency_max?: number;
	/** Average latency on this day */
	latency_avg?: number;
	/** Minimum custom1 value on this day */
	custom1_min?: number;
	/** Maximum custom1 value on this day */
	custom1_max?: number;
	/** Average custom1 value on this day */
	custom1_avg?: number;
	/** Minimum custom2 value on this day */
	custom2_min?: number;
	/** Maximum custom2 value on this day */
	custom2_max?: number;
	/** Average custom2 value on this day */
	custom2_avg?: number;
	/** Minimum custom3 value on this day */
	custom3_min?: number;
	/** Maximum custom3 value on this day */
	custom3_max?: number;
	/** Average custom3 value on this day */
	custom3_avg?: number;
}

/**
 * A single pulse record stored in the database.
 */
export interface PulseRecord {
	/** Measured latency */
	latency: number;
	/** Timestamp of the last check (UTC time) */
	last_check: string;
	/** Custom metric 1 value */
	custom1: number | null;
	/** Custom metric 2 value */
	custom2: number | null;
	/** Custom metric 3 value */
	custom3: number | null;
}

/**
 * Represents a stored uptime percentage.
 */
export interface UptimeRecord {
	/** Uptime percentage over a given period */
	uptime: number;
}

/**
 * Options for the pulse loss detector.
 */
export interface MissingPulseDetectorOptions {
	/** Interval to check for missing pulses (in milliseconds) */
	checkInterval?: number;
}

export interface EmailConfig {
	enabled: boolean;
	smtp: {
		host: string;
		port: number;
		secure: boolean;
		auth: {
			user: string;
			pass: string;
		};
	};
	from: string;
	to: string[];
}

export interface DiscordConfig {
	enabled: boolean;
	webhookUrl: string;
	username?: string;
	avatarUrl?: string;
	mentions?: {
		users?: string[];
		roles?: string[];
		everyone?: boolean;
	};
}

export interface WebhookConfig {
	enabled: boolean;
	url: string;
	method?: "POST" | "PUT" | "PATCH";
	headers?: Record<string, string>;
	template?: string;
}

export interface DowntimeRecord {
	startTime: Date;
	endTime: Date;
	duration: number;
}

export interface NotificationsConfig {
	/** Collection of notification channels indexed by their ID */
	channels: Record<string, NotificationChannel>;
}

export interface NotificationChannel {
	/** Unique identifier for this notification channel */
	id: string;
	/** Human-readable name for this channel */
	name: string;
	/** Description of what this channel is used for */
	description?: string;
	/** Whether this channel is enabled globally */
	enabled: boolean;
	/** Email configuration for this channel */
	email?: EmailConfig;
	/** Discord configuration for this channel */
	discord?: DiscordConfig;
}

export interface NotificationEvent {
	type: "down" | "still-down" | "recovered";
	monitorId: string;
	monitorName: string;
	timestamp: Date;
	downtime?: number;
	consecutiveDownCount?: number;
	previousConsecutiveDownCount?: number;
	/** The entity that triggered this notification (monitor or group) */
	sourceType: "monitor" | "group";
	/** Additional context for groups */
	groupInfo?: {
		strategy: "any-up" | "percentage" | "all-up";
		childrenUp: number;
		totalChildren: number;
		upPercentage: number;
	};
}

/**
 * Represents the current state of a monitor being tracked for missing pulses
 */
export interface MonitorState {
	/** Number of consecutive missed pulse detections */
	missedCount: number;
	/** Number of consecutive times the monitor has been marked as down */
	consecutiveDownCount: number;
	/** The down count at which the last notification was sent */
	lastNotificationCount: number;
	/** Timestamp when the monitor first went down (undefined if monitor is up) */
	downStartTime?: number;
}

/**
 * Contains information about a monitor's downtime
 */
export interface DowntimeInfo {
	/** Total duration of downtime in milliseconds */
	actualDowntime: number;
	/** Timestamp when the downtime started */
	downStartTime: number;
}

export interface NotificationProvider {
	sendNotification(event: NotificationEvent): Promise<void>;
}

/**
 * Custom metrics values for pulse storage and retrieval
 */
export interface CustomMetrics {
	custom1: number | null;
	custom2: number | null;
	custom3: number | null;
}

/**
 * Group history data aggregated from child monitors/groups.
 * Groups don't store their own pulses - their history is computed from children.
 */
export interface GroupHistoryRecord {
	/** Timestamp (ISO format) */
	timestamp: string;
	/** Uptime percentage based on group strategy */
	uptime: number;
	/** Minimum latency across children */
	latency_min?: number;
	/** Maximum latency across children */
	latency_max?: number;
	/** Average latency across children */
	latency_avg?: number;
}
