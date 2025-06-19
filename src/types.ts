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
}

/**
 * Represents a group of monitors or nested groups.
 */
export interface Group {
	/** Unique group ID */
	id: string;
	/** Group display name */
	name: string;
	/** Optional parent group ID */
	parentId?: string;
	/** Percentage of children that must be up to consider this group healthy (0–100) */
	degradedThreshold: number;
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
	latency: number;
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
	lastCheck?: Date;
	/** 1-hour uptime percentage */
	uptime1h?: number;
	/** 24-hour uptime percentage */
	uptime24h?: number;
	/** 7-day uptime percentage */
	uptime7d?: number;
	/** 30-day uptime percentage */
	uptime30d?: number;
	/** 90-day uptime percentage */
	uptime90d?: number;
	/** 365-day uptime percentage */
	uptime365d?: number;
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
