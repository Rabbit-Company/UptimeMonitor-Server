import type { NodeClickHouseClientConfigOptions } from "@clickhouse/client/dist/config";

/**
 * Configuration options for the logger.
 */
export interface LoggerConfig {
	/** Logging level (0 = ERROR, 1 = WARN, 2 = AUDIT, 3 = INFO, 4 = HTTP, 5 = DEBUG, 6 = VERBOSE, 7 = SILLY) */
	level?: number;
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
	/** Multiplier for expected interval (e.g., 1.5 = 50% tolerance) */
	toleranceFactor: number;
	/** Resend notification after this many consecutive down checks (0 = never) */
	resendNotification: number;
	/** Optional group ID this monitor belongs to */
	groupId?: string;
	/** Notification channel IDs to use for this monitor */
	notificationChannels?: string[];
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
	/** Multiplier for expected interval (e.g., 1.5 = 50% tolerance) */
	toleranceFactor: number;
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
	/** Status of the monitor at the time of pulse */
	status: "up" | "down";
	/** Response latency in milliseconds */
	latency: number | null;
	/** Timestamp of when the pulse was received */
	timestamp: Date;
}

/**
 * Defines interval durations in string and millisecond formats.
 */
export interface IntervalConfig {
	/** Interval label (e.g., '5 minute', '6 hour') */
	interval: string;
	/** Interval in milliseconds */
	intervalMs: number;
	/** Aggregation range (e.g., '24 HOUR', '90 DAY') */
	range: string;
	/** Aggregation range in milliseconds */
	rangeMs: number;
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
	lastCheck: Date;
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
}

/**
 * Server-Sent Event (SSE) data sent to clients.
 */
export interface SSEPulseEvent {
	/** Type of event: 'pulse' or 'ping' */
	type: "pulse" | "ping";
	/** Monitor ID (for 'pulse' events) */
	monitorId?: string;
	/** Current status of the monitor */
	status?: "up" | "down";
	/** Measured latency */
	latency?: number;
	/** Timestamp of the event */
	timestamp?: Date;
}

/**
 * A single pulse record stored in the database.
 */
export interface PulseRecord {
	/** Status of the monitor ('up' or 'down') */
	status: "up" | "down";
	/** Measured latency */
	latency: number;
	/** Timestamp of the last check (UTC time) */
	last_check: string;
}

/**
 * Represents a stored uptime percentage.
 */
export interface UptimeRecord {
	/** Uptime percentage over a given period */
	uptime: number;
}

/**
 * Historical metrics used for graphs or reports.
 */
export interface HistoryRecord {
	/** Timestamp of the record (UTC time) */
	time: string;
	/** Average latency during the period */
	avg_latency: number;
	/** Minimum latency recorded */
	min_latency: number;
	/** Maximum latency recorded */
	max_latency: number;
	/** Uptime percentage during the period */
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
		secure: boolean; // true for 465, false for other ports
		auth: {
			user: string;
			pass: string;
		};
	};
	from: string;
	to: string[];
	templates: {
		subject: {
			down: string;
			stillDown: string;
			recovered: string;
		};
	};
}

export interface DiscordConfig {
	enabled: boolean;
	webhookUrl: string;
	username?: string;
	avatarUrl?: string;
	mentions?: {
		users?: string[]; // Discord user IDs
		roles?: string[]; // Discord role IDs
		everyone?: boolean;
	};
}

export interface WebhookConfig {
	enabled: boolean;
	url: string;
	method?: "POST" | "PUT" | "PATCH";
	headers?: Record<string, string>;
	template?: string; // JSON template for custom payloads
}

export interface NotificationsConfig {
	/** Collection of notification channels indexed by their ID */
	channels: Record<string, NotificationChannel>;
}

// Notification channel definition with unique ID
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

export interface NotificationProvider {
	sendNotification(event: NotificationEvent): Promise<void>;
}
