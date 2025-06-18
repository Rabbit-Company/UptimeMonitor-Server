import type { NodeClickHouseClientConfigOptions } from "@clickhouse/client/dist/config";

export interface Monitor {
	id: string;
	name: string;
	token: string;
	interval: number;
	groupId?: string;
}

export interface Group {
	id: string;
	name: string;
	parentId?: string;
	degradedThreshold: number; // percentage of children that must be up
}

export interface StatusPage {
	id: string;
	name: string;
	slug: string;
	items: string[]; // monitor or group IDs
}

export interface ServerConfig {
	port: number;
}

export interface Config {
	clickhouse: NodeClickHouseClientConfigOptions;
	server: ServerConfig;
	monitors: Monitor[];
	groups: Group[];
	statusPages: StatusPage[];
}

export interface Pulse {
	monitorId: string;
	status: "up" | "down";
	latency: number;
	timestamp: Date;
}

export interface IntervalConfig {
	interval: string;
	intervalMs: number;
	range: string;
	rangeMs: number;
}

export interface StatusData {
	id: string;
	type: "monitor" | "group";
	name: string;
	status: "up" | "down" | "degraded";
	latency: number;
	lastCheck?: Date;
	uptime24h?: number;
	uptime7d?: number;
	uptime30d?: number;
	children?: StatusData[];
}

export interface SSEPulseEvent {
	type: "pulse" | "ping";
	monitorId?: string;
	status?: "up" | "down";
	latency?: number;
	timestamp?: Date;
}

export interface PulseRecord {
	status: "up" | "down";
	latency: number;
	last_check: string;
}

export interface UptimeRecord {
	uptime: number;
}

export interface HistoryRecord {
	time: string;
	avg_latency: number;
	min_latency: number;
	max_latency: number;
	uptime: number;
}
