import { readFileSync } from "fs";
import type {
	Config,
	Monitor,
	Group,
	StatusPage,
	ServerConfig,
	LoggerConfig,
	NotificationsConfig,
	NotificationChannel,
	SelfMonitoringConfig,
	MissingPulseDetectorConfig,
	CustomMetricConfig,
	PulseMonitor,
	PulseConfig,
	AdminAPIConfig,
} from "./types";
import type { NodeClickHouseClientConfigOptions } from "@clickhouse/client/dist/config";
import { Logger } from "./logger";
import { type IpExtractionPreset } from "@rabbit-company/web-middleware/ip-extract";

export const defaultReloadToken = generateSecureToken();
export const defaultAdminToken = generateSecureToken();

// Validation error class
class ConfigValidationError extends Error {
	constructor(public errors: string[]) {
		super(`Configuration validation failed:\n${errors.join("\n")}`);
		this.name = "ConfigValidationError";
	}
}

// Type guards
function isString(value: unknown): value is string {
	return typeof value === "string";
}

function isNumber(value: unknown): value is number {
	return typeof value === "number" && !isNaN(value);
}

function isBoolean(value: unknown): value is boolean {
	return typeof value === "boolean";
}

function isArray(value: unknown): value is unknown[] {
	return Array.isArray(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const IP_EXTRACTION_PRESETS = ["direct", "cloudflare", "aws", "gcp", "azure", "vercel", "nginx", "development"] as const;

function isIpExtractionPreset(value: unknown): value is IpExtractionPreset {
	return typeof value === "string" && IP_EXTRACTION_PRESETS.includes(value as IpExtractionPreset);
}

// Validation functions

function validateLoggerConfig(config: unknown): LoggerConfig {
	const errors: string[] = [];
	const cfg = (config || {}) as Record<string, unknown>;

	const result: LoggerConfig = {
		level: 4,
	};

	if (cfg.level !== undefined) {
		if (!isNumber(cfg.level) || cfg.level < 0 || cfg.level > 7) {
			errors.push("logger.level must be a valid number (0-7)");
		} else {
			result.level = cfg.level;
		}
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	return result;
}

function validateCustomMetricConfig(metric: unknown, context: string): CustomMetricConfig | undefined {
	if (metric === undefined) {
		return undefined;
	}

	const errors: string[] = [];

	if (!isObject(metric)) {
		throw new ConfigValidationError([`${context} must be an object`]);
	}

	// Validate id
	if (!isString(metric.id) || metric.id.trim().length === 0) {
		errors.push(`${context}.id must be a non-empty string`);
	}

	// Validate name
	if (!isString(metric.name) || metric.name.trim().length === 0) {
		errors.push(`${context}.name must be a non-empty string`);
	}

	// Validate optional unit
	if (metric.unit !== undefined && (!isString(metric.unit) || metric.unit.trim().length === 0)) {
		errors.push(`${context}.unit must be a non-empty string if provided`);
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	const result: CustomMetricConfig = {
		id: metric.id as string,
		name: metric.name as string,
	};

	if (metric.unit) {
		result.unit = metric.unit as string;
	}

	return result;
}

function validatePulseConfig(pulse: unknown, context: string): PulseConfig | undefined {
	if (pulse === undefined) {
		return undefined;
	}

	const errors: string[] = [];

	if (!isObject(pulse)) {
		throw new ConfigValidationError([`${context} must be an object`]);
	}

	const result: PulseConfig = {};
	let configCount = 0;

	// Validate HTTP config
	if (pulse.http !== undefined) {
		configCount++;
		if (!isObject(pulse.http)) {
			errors.push(`${context}.http must be an object`);
		} else {
			const http = pulse.http;
			if (!isString(http.url) || http.url.trim().length === 0) {
				errors.push(`${context}.http.url must be a non-empty string`);
			}
			if (http.method !== undefined && (!isString(http.method) || !["GET", "POST", "HEAD"].includes(http.method.toUpperCase()))) {
				errors.push(`${context}.http.method must be GET, POST, or HEAD`);
			}
			if (http.timeout !== undefined && (!isNumber(http.timeout) || http.timeout <= 0)) {
				errors.push(`${context}.http.timeout must be a positive number`);
			}
			if (http.headers !== undefined && !isArray(http.headers)) {
				errors.push(`${context}.http.headers must be an array`);
			}
			if (errors.length === 0) {
				result.http = {
					url: http.url as string,
					method: http.method as string | undefined,
					timeout: http.timeout as number | undefined,
					headers: http.headers as Array<Record<string, string>> | undefined,
				};
			}
		}
	}

	// Validate WebSocket config
	if (pulse.ws !== undefined) {
		configCount++;
		if (!isObject(pulse.ws)) {
			errors.push(`${context}.ws must be an object`);
		} else {
			const ws = pulse.ws;
			if (!isString(ws.url) || ws.url.trim().length === 0) {
				errors.push(`${context}.ws.url must be a non-empty string`);
			}
			if (ws.timeout !== undefined && (!isNumber(ws.timeout) || ws.timeout <= 0)) {
				errors.push(`${context}.ws.timeout must be a positive number`);
			}
			if (errors.length === 0) {
				result.ws = {
					url: ws.url as string,
					timeout: ws.timeout as number | undefined,
				};
			}
		}
	}

	// Validate TCP config
	if (pulse.tcp !== undefined) {
		configCount++;
		if (!isObject(pulse.tcp)) {
			errors.push(`${context}.tcp must be an object`);
		} else {
			const tcp = pulse.tcp;
			if (!isString(tcp.host) || tcp.host.trim().length === 0) {
				errors.push(`${context}.tcp.host must be a non-empty string`);
			}
			if (!isNumber(tcp.port) || tcp.port <= 0 || tcp.port > 65535) {
				errors.push(`${context}.tcp.port must be a valid port number (1-65535)`);
			}
			if (tcp.timeout !== undefined && (!isNumber(tcp.timeout) || tcp.timeout <= 0)) {
				errors.push(`${context}.tcp.timeout must be a positive number`);
			}
			if (errors.length === 0) {
				result.tcp = {
					host: tcp.host as string,
					port: tcp.port as number,
					timeout: tcp.timeout as number | undefined,
				};
			}
		}
	}

	// Validate UDP config
	if (pulse.udp !== undefined) {
		configCount++;
		if (!isObject(pulse.udp)) {
			errors.push(`${context}.udp must be an object`);
		} else {
			const udp = pulse.udp;
			if (!isString(udp.host) || udp.host.trim().length === 0) {
				errors.push(`${context}.udp.host must be a non-empty string`);
			}
			if (!isNumber(udp.port) || udp.port <= 0 || udp.port > 65535) {
				errors.push(`${context}.udp.port must be a valid port number (1-65535)`);
			}
			if (udp.timeout !== undefined && (!isNumber(udp.timeout) || udp.timeout <= 0)) {
				errors.push(`${context}.udp.timeout must be a positive number`);
			}
			if (udp.payload !== undefined && !isString(udp.payload)) {
				errors.push(`${context}.udp.payload must be a string`);
			}
			if (udp.expectResponse !== undefined && !isBoolean(udp.expectResponse)) {
				errors.push(`${context}.udp.expectResponse must be a boolean`);
			}
			if (errors.length === 0) {
				result.udp = {
					host: udp.host as string,
					port: udp.port as number,
					timeout: udp.timeout as number | undefined,
					payload: udp.payload as string | undefined,
					expectResponse: udp.expectResponse as boolean | undefined,
				};
			}
		}
	}

	// Validate ICMP config
	if (pulse.icmp !== undefined) {
		configCount++;
		if (!isObject(pulse.icmp)) {
			errors.push(`${context}.icmp must be an object`);
		} else {
			const icmp = pulse.icmp;
			if (!isString(icmp.host) || icmp.host.trim().length === 0) {
				errors.push(`${context}.icmp.host must be a non-empty string`);
			}
			if (icmp.timeout !== undefined && (!isNumber(icmp.timeout) || icmp.timeout <= 0)) {
				errors.push(`${context}.icmp.timeout must be a positive number`);
			}
			if (errors.length === 0) {
				result.icmp = {
					host: icmp.host as string,
					timeout: icmp.timeout as number | undefined,
				};
			}
		}
	}

	// Validate SMTP config
	if (pulse.smtp !== undefined) {
		configCount++;
		if (!isObject(pulse.smtp)) {
			errors.push(`${context}.smtp must be an object`);
		} else {
			const smtp = pulse.smtp;
			if (!isString(smtp.url) || smtp.url.trim().length === 0) {
				errors.push(`${context}.smtp.url must be a non-empty string`);
			}
			if (errors.length === 0) {
				result.smtp = {
					url: smtp.url as string,
				};
			}
		}
	}

	// Validate IMAP config
	if (pulse.imap !== undefined) {
		configCount++;
		if (!isObject(pulse.imap)) {
			errors.push(`${context}.imap must be an object`);
		} else {
			const imap = pulse.imap;
			if (!isString(imap.server) || imap.server.trim().length === 0) {
				errors.push(`${context}.imap.server must be a non-empty string`);
			}
			if (!isNumber(imap.port) || imap.port <= 0 || imap.port > 65535) {
				errors.push(`${context}.imap.port must be a valid port number (1-65535)`);
			}
			if (!isString(imap.username) || imap.username.trim().length === 0) {
				errors.push(`${context}.imap.username must be a non-empty string`);
			}
			if (!isString(imap.password) || imap.password.trim().length === 0) {
				errors.push(`${context}.imap.password must be a non-empty string`);
			}
			if (errors.length === 0) {
				result.imap = {
					server: imap.server as string,
					port: imap.port as number,
					username: imap.username as string,
					password: imap.password as string,
				};
			}
		}
	}

	// Validate MySQL config
	if (pulse.mysql !== undefined) {
		configCount++;
		if (!isObject(pulse.mysql)) {
			errors.push(`${context}.mysql must be an object`);
		} else {
			const mysql = pulse.mysql;
			if (!isString(mysql.url) || mysql.url.trim().length === 0) {
				errors.push(`${context}.mysql.url must be a non-empty string`);
			}
			if (mysql.timeout !== undefined && (!isNumber(mysql.timeout) || mysql.timeout <= 0)) {
				errors.push(`${context}.mysql.timeout must be a positive number`);
			}
			if (errors.length === 0) {
				result.mysql = {
					url: mysql.url as string,
					timeout: mysql.timeout as number | undefined,
				};
			}
		}
	}

	// Validate MSSQL config
	if (pulse.mssql !== undefined) {
		configCount++;
		if (!isObject(pulse.mssql)) {
			errors.push(`${context}.mssql must be an object`);
		} else {
			const mssql = pulse.mssql;
			if (!isString(mssql.url) || mssql.url.trim().length === 0) {
				errors.push(`${context}.mssql.url must be a non-empty string`);
			}
			if (mssql.timeout !== undefined && (!isNumber(mssql.timeout) || mssql.timeout <= 0)) {
				errors.push(`${context}.mssql.timeout must be a positive number`);
			}
			if (errors.length === 0) {
				result.mssql = {
					url: mssql.url as string,
					timeout: mssql.timeout as number | undefined,
				};
			}
		}
	}

	// Validate PostgreSQL config
	if (pulse.postgresql !== undefined) {
		configCount++;
		if (!isObject(pulse.postgresql)) {
			errors.push(`${context}.postgresql must be an object`);
		} else {
			const postgresql = pulse.postgresql;
			if (!isString(postgresql.url) || postgresql.url.trim().length === 0) {
				errors.push(`${context}.postgresql.url must be a non-empty string`);
			}
			if (postgresql.timeout !== undefined && (!isNumber(postgresql.timeout) || postgresql.timeout <= 0)) {
				errors.push(`${context}.postgresql.timeout must be a positive number`);
			}
			if (postgresql.useTls !== undefined && !isBoolean(postgresql.useTls)) {
				errors.push(`${context}.postgresql.useTls must be a boolean`);
			}
			if (errors.length === 0) {
				result.postgresql = {
					url: postgresql.url as string,
					timeout: postgresql.timeout as number | undefined,
					useTls: postgresql.useTls as boolean | undefined,
				};
			}
		}
	}

	// Validate Redis config
	if (pulse.redis !== undefined) {
		configCount++;
		if (!isObject(pulse.redis)) {
			errors.push(`${context}.redis must be an object`);
		} else {
			const redis = pulse.redis;
			if (!isString(redis.url) || redis.url.trim().length === 0) {
				errors.push(`${context}.redis.url must be a non-empty string`);
			}
			if (redis.timeout !== undefined && (!isNumber(redis.timeout) || redis.timeout <= 0)) {
				errors.push(`${context}.redis.timeout must be a positive number`);
			}
			if (errors.length === 0) {
				result.redis = {
					url: redis.url as string,
					timeout: redis.timeout as number | undefined,
				};
			}
		}
	}

	// Validate Minecraft Java config
	if (pulse["minecraft-java"] !== undefined) {
		configCount++;
		if (!isObject(pulse["minecraft-java"])) {
			errors.push(`${context}.minecraft-java must be an object`);
		} else {
			const minecraftJava = pulse["minecraft-java"];
			if (!isString(minecraftJava.host) || minecraftJava.host.trim().length === 0) {
				errors.push(`${context}.minecraft-java.host must be a non-empty string`);
			}
			if (minecraftJava.port !== undefined && (!isNumber(minecraftJava.port) || minecraftJava.port <= 0 || minecraftJava.port > 65535)) {
				errors.push(`${context}.minecraft-java.port must be a valid port number (1-65535)`);
			}
			if (minecraftJava.timeout !== undefined && (!isNumber(minecraftJava.timeout) || minecraftJava.timeout <= 0)) {
				errors.push(`${context}.minecraft-java.timeout must be a positive number`);
			}
			if (errors.length === 0) {
				result["minecraft-java"] = {
					host: minecraftJava.host as string,
					port: minecraftJava.port as number | undefined,
					timeout: minecraftJava.timeout as number | undefined,
				};
			}
		}
	}

	// Validate Minecraft Bedrock config
	if (pulse["minecraft-bedrock"] !== undefined) {
		configCount++;
		if (!isObject(pulse["minecraft-bedrock"])) {
			errors.push(`${context}.minecraft-bedrock must be an object`);
		} else {
			const minecraftBedrock = pulse["minecraft-bedrock"];
			if (!isString(minecraftBedrock.host) || minecraftBedrock.host.trim().length === 0) {
				errors.push(`${context}.minecraft-bedrock.host must be a non-empty string`);
			}
			if (minecraftBedrock.port !== undefined && (!isNumber(minecraftBedrock.port) || minecraftBedrock.port <= 0 || minecraftBedrock.port > 65535)) {
				errors.push(`${context}.minecraft-bedrock.port must be a valid port number (1-65535)`);
			}
			if (minecraftBedrock.timeout !== undefined && (!isNumber(minecraftBedrock.timeout) || minecraftBedrock.timeout <= 0)) {
				errors.push(`${context}.minecraft-bedrock.timeout must be a positive number`);
			}
			if (errors.length === 0) {
				result["minecraft-bedrock"] = {
					host: minecraftBedrock.host as string,
					port: minecraftBedrock.port as number | undefined,
					timeout: minecraftBedrock.timeout as number | undefined,
				};
			}
		}
	}

	// Check that at least one config type is defined
	if (configCount === 0) {
		errors.push(
			`${context} must have at least one monitoring type configured (http, ws, tcp, udp, icmp, smtp, imap, mysql, mssql, postgresql, redis, minecraft-java, minecraft-bedrock)`,
		);
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	return result;
}

function validateMonitor(monitor: unknown, index: number): Monitor {
	const errors: string[] = [];

	if (!isObject(monitor)) {
		throw new Error(`monitors[${index}] must be an object`);
	}

	// Validate ID
	if (!isString(monitor.id) || monitor.id.trim().length === 0) {
		errors.push(`monitors[${index}].id must be a non-empty string`);
	}

	// Validate name
	if (!isString(monitor.name) || monitor.name.trim().length === 0) {
		errors.push(`monitors[${index}].name must be a non-empty string`);
	}

	// Validate token
	if (!isString(monitor.token) || monitor.token.trim().length === 0) {
		errors.push(`monitors[${index}].token must be a non-empty string`);
	}

	// Validate interval
	if (!isNumber(monitor.interval) || monitor.interval <= 0) {
		errors.push(`monitors[${index}].interval must be a positive number`);
	}

	// Validate maxRetries
	if (!isNumber(monitor.maxRetries) || monitor.maxRetries < 0) {
		errors.push(`monitors[${index}].maxRetries must be a positive number`);
	}

	// Validate resendNotification
	if (!isNumber(monitor.resendNotification) || monitor.resendNotification < 0) {
		errors.push(`monitors[${index}].resendNotification must be a positive number`);
	}

	// Validate optional groupId
	if (monitor.groupId !== undefined && (!isString(monitor.groupId) || monitor.groupId.trim().length === 0)) {
		errors.push(`monitors[${index}].groupId must be a non-empty string if provided`);
	}

	// Validate optional pulseMonitors array
	let pulseMonitors: string[] | undefined;
	if (monitor.pulseMonitors !== undefined) {
		if (!isArray(monitor.pulseMonitors)) {
			errors.push(`monitors[${index}].pulseMonitors must be an array if provided`);
		} else {
			pulseMonitors = [];
			for (let i = 0; i < monitor.pulseMonitors.length; i++) {
				if (!isString(monitor.pulseMonitors[i]) || (monitor.pulseMonitors[i] as string).trim().length === 0) {
					errors.push(`monitors[${index}].pulseMonitors[${i}] must be a non-empty string`);
				} else {
					pulseMonitors.push(monitor.pulseMonitors[i] as string);
				}
			}
		}
	}

	let children: string[] | undefined;
	if (monitor.children !== undefined) {
		if (!isArray(monitor.children)) {
			errors.push(`monitors[${index}].children must be an array if provided`);
		} else {
			children = [];
			for (let i = 0; i < monitor.children.length; i++) {
				if (!isString(monitor.children[i]) || (monitor.children[i] as string).trim().length === 0) {
					errors.push(`monitors[${index}].children[${i}] must be a non-empty string`);
				} else {
					children.push(monitor.children[i] as string);
				}
			}
		}
	}

	let dependencies: string[] | undefined;
	if (monitor.dependencies !== undefined) {
		if (!isArray(monitor.dependencies)) {
			errors.push(`monitors[${index}].dependencies must be an array if provided`);
		} else {
			dependencies = [];
			for (let i = 0; i < monitor.dependencies.length; i++) {
				if (!isString(monitor.dependencies[i]) || (monitor.dependencies[i] as string).trim().length === 0) {
					errors.push(`monitors[${index}].dependencies[${i}] must be a non-empty string`);
				} else {
					dependencies.push(monitor.dependencies[i] as string);
				}
			}
		}
	}

	// Validate pulse configuration
	let pulse: PulseConfig | undefined;
	try {
		pulse = validatePulseConfig(monitor.pulse, `monitors[${index}].pulse`);
	} catch (error) {
		if (error instanceof ConfigValidationError) {
			errors.push(...error.errors);
		}
	}

	// If pulseMonitors is set, pulse configuration must also be set
	if (pulseMonitors && pulseMonitors.length > 0 && !pulse) {
		errors.push(`monitors[${index}] has pulseMonitors configured but no pulse configuration`);
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	const notificationChannels = validateNotificationChannels(monitor.notificationChannels, `monitors[${index}]`);

	// Validate custom metrics
	let custom1: CustomMetricConfig | undefined;
	let custom2: CustomMetricConfig | undefined;
	let custom3: CustomMetricConfig | undefined;

	try {
		custom1 = validateCustomMetricConfig(monitor.custom1, `monitors[${index}].custom1`);
	} catch (error) {
		if (error instanceof ConfigValidationError) {
			throw error;
		}
	}

	try {
		custom2 = validateCustomMetricConfig(monitor.custom2, `monitors[${index}].custom2`);
	} catch (error) {
		if (error instanceof ConfigValidationError) {
			throw error;
		}
	}

	try {
		custom3 = validateCustomMetricConfig(monitor.custom3, `monitors[${index}].custom3`);
	} catch (error) {
		if (error instanceof ConfigValidationError) {
			throw error;
		}
	}

	const result: Monitor = {
		id: monitor.id as string,
		name: monitor.name as string,
		token: monitor.token as string,
		interval: monitor.interval as number,
		maxRetries: monitor.maxRetries as number,
		resendNotification: monitor.resendNotification as number,
		children,
		dependencies,
		notificationChannels,
		pulseMonitors,
	};

	if (pulse) result.pulse = pulse;
	if (custom1) result.custom1 = custom1;
	if (custom2) result.custom2 = custom2;
	if (custom3) result.custom3 = custom3;

	return result;
}

function validateGroup(group: unknown, index: number): Group {
	const errors: string[] = [];

	if (!isObject(group)) {
		throw new Error(`groups[${index}] must be an object`);
	}

	// Validate ID
	if (!isString(group.id) || group.id.trim().length === 0) {
		errors.push(`groups[${index}].id must be a non-empty string`);
	}

	// Validate name
	if (!isString(group.name) || group.name.trim().length === 0) {
		errors.push(`groups[${index}].name must be a non-empty string`);
	}

	// Validate strategy
	if (!isString(group.strategy) || !["any-up", "percentage", "all-up"].includes(group.strategy)) {
		errors.push(`groups[${index}].strategy must be either 'any-up', 'percentage' or 'all-up'`);
	}

	// Validate interval
	if (!isNumber(group.interval) || group.interval <= 0) {
		errors.push(`group[${index}].interval must be a positive number`);
	}

	// Validate degradedThreshold
	if (!isNumber(group.degradedThreshold)) {
		errors.push(`groups[${index}].degradedThreshold must be a number`);
	} else if (group.degradedThreshold < 0 || group.degradedThreshold > 100) {
		errors.push(`groups[${index}].degradedThreshold must be between 0 and 100`);
	}

	// Validate resendNotification (optional, defaults to 0 which means never resend)
	if (group.resendNotification !== undefined) {
		if (!isNumber(group.resendNotification) || group.resendNotification < 0) {
			errors.push(`groups[${index}].resendNotification must be a non-negative number`);
		}
	}

	let children: string[] | undefined;
	if (group.children !== undefined) {
		if (!isArray(group.children)) {
			errors.push(`groups[${index}].children must be an array if provided`);
		} else {
			children = [];
			for (let i = 0; i < group.children.length; i++) {
				if (!isString(group.children[i]) || (group.children[i] as string).trim().length === 0) {
					errors.push(`groups[${index}].children[${i}] must be a non-empty string`);
				} else {
					children.push(group.children[i] as string);
				}
			}
		}
	}

	let dependencies: string[] | undefined;
	if (group.dependencies !== undefined) {
		if (!isArray(group.dependencies)) {
			errors.push(`groups[${index}].dependencies must be an array if provided`);
		} else {
			dependencies = [];
			for (let i = 0; i < group.dependencies.length; i++) {
				if (!isString(group.dependencies[i]) || (group.dependencies[i] as string).trim().length === 0) {
					errors.push(`groups[${index}].dependencies[${i}] must be a non-empty string`);
				} else {
					dependencies.push(group.dependencies[i] as string);
				}
			}
		}
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	const notificationChannels = validateNotificationChannels(group.notificationChannels, `groups[${index}]`);

	return {
		id: group.id as string,
		name: group.name as string,
		strategy: group.strategy as "any-up" | "percentage" | "all-up",
		degradedThreshold: group.degradedThreshold as number,
		interval: group.interval as number,
		resendNotification: (group.resendNotification as number | undefined) ?? 0,
		children,
		dependencies,
		notificationChannels,
	};
}

function validateStatusPage(page: unknown, index: number): StatusPage {
	const errors: string[] = [];

	if (!isObject(page)) {
		throw new Error(`status_pages[${index}] must be an object`);
	}

	// Validate ID
	if (!isString(page.id) || page.id.trim().length === 0) {
		errors.push(`status_pages[${index}].id must be a non-empty string`);
	}

	// Validate name
	if (!isString(page.name) || page.name.trim().length === 0) {
		errors.push(`status_pages[${index}].name must be a non-empty string`);
	}

	// Validate slug
	if (!isString(page.slug) || page.slug.trim().length === 0) {
		errors.push(`status_pages[${index}].slug must be a non-empty string`);
	} else if (!/^[a-z0-9-]+$/.test(page.slug as string)) {
		errors.push(`status_pages[${index}].slug must contain only lowercase letters, numbers, and hyphens`);
	}

	// Validate items array
	if (!isArray(page.items)) {
		errors.push(`status_pages[${index}].items must be an array`);
	} else if (page.items.length === 0) {
		errors.push(`status_pages[${index}].items must have at least one item`);
	} else {
		// Validate each item in the array
		for (let i = 0; i < page.items.length; i++) {
			if (!isString(page.items[i]) || (page.items[i] as string).trim().length === 0) {
				errors.push(`status_pages[${index}].items[${i}] must be a non-empty string`);
			}
		}
	}

	if (page.password !== undefined) {
		if (!isString(page.password) || page.password.trim().length === 0) {
			errors.push(`status_pages[${index}].password must be a non-empty string if provided`);
		} else if ((page.password as string).length < 8) {
			errors.push(`status_pages[${index}].password must be at least 8 characters long`);
		}
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	const result: StatusPage = {
		id: page.id as string,
		name: page.name as string,
		slug: page.slug as string,
		items: page.items as string[],
	};

	if (page.password !== undefined) {
		result.password = page.password as string;

		const hasher = new Bun.CryptoHasher("blake2b512");
		hasher.update(result.password);

		result.hashedPassword = hasher.digest("hex");
	}

	return result;
}

function validateClickHouseConfig(config: unknown): NodeClickHouseClientConfigOptions {
	const errors: string[] = [];
	const cfg = (config || {}) as Record<string, unknown>;

	const result: NodeClickHouseClientConfigOptions = {
		url: "http://localhost:8123/uptime_monitor",
	};

	// Validate url
	if (cfg.url !== undefined) {
		if (!isString(cfg.url) || cfg.url.trim().length === 0) {
			errors.push("clickhouse.url must be a non-empty string");
		} else {
			result.url = cfg.url;
		}
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	return result;
}

/**
 * Generate a secure random token
 */
function generateSecureToken(length: number = 50): string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	const randomBytes = crypto.getRandomValues(new Uint8Array(length));
	return Array.from(randomBytes, (byte) => chars[byte % chars.length]).join("");
}

function validateServerConfig(config: unknown): ServerConfig {
	const errors: string[] = [];
	const cfg = (config || {}) as Record<string, unknown>;

	const result: ServerConfig = {
		port: 3000,
		proxy: "direct",
		reloadToken: defaultReloadToken,
	};

	if (cfg.port !== undefined) {
		if (!isNumber(cfg.port) || cfg.port <= 0 || cfg.port > 65535) {
			errors.push("server.port must be a valid port number (1-65535)");
		} else {
			result.port = cfg.port;
		}
	}

	if (cfg.proxy !== undefined) {
		if (!isIpExtractionPreset(cfg.proxy)) {
			errors.push(`server.proxy must be one of: ${IP_EXTRACTION_PRESETS.join(", ")}`);
		} else {
			result.proxy = cfg.proxy;
		}
	}

	if (cfg.reloadToken !== undefined) {
		if (!isString(cfg.reloadToken) || cfg.reloadToken.trim().length === 0) {
			errors.push("server.reloadToken must be a non-empty string if provided");
		} else {
			result.reloadToken = cfg.reloadToken;
		}
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	return result;
}

function validateAdminAPIConfig(config: unknown): AdminAPIConfig {
	const errors: string[] = [];
	const cfg = (config || {}) as Record<string, unknown>;

	const result: AdminAPIConfig = {
		enabled: false,
		token: defaultAdminToken,
	};

	if (cfg.enabled !== undefined) {
		if (!isBoolean(cfg.enabled)) {
			errors.push("adminAPI.enabled must be a boolean");
		} else {
			result.enabled = cfg.enabled;
		}
	}

	if (cfg.token !== undefined) {
		if (!isString(cfg.token) || cfg.token.trim().length === 0) {
			errors.push("adminAPI.token must be a non-empty string if provided");
		} else {
			result.token = cfg.token;
		}
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	return result;
}

function validateSelfMonitoringConfig(config: unknown): SelfMonitoringConfig {
	const errors: string[] = [];
	const cfg = (config || {}) as Record<string, unknown>;

	const result: SelfMonitoringConfig = {
		enabled: false,
		id: "self-monitor",
		interval: 3,
		backfillOnRecovery: false,
		latencyStrategy: "last-known",
	};

	if (isBoolean(cfg.enabled)) {
		result.enabled = cfg.enabled;
	}

	if (isString(cfg.id) && cfg.id.trim().length !== 0) {
		result.id = cfg.id;
	}

	if (isNumber(cfg.interval) && cfg.interval >= 1) {
		result.interval = cfg.interval;
	}

	if (isBoolean(cfg.backfillOnRecovery)) {
		result.backfillOnRecovery = cfg.backfillOnRecovery;
	}

	if (isString(cfg.latencyStrategy) && ["last-known", "null"].includes(cfg.latencyStrategy)) {
		result.latencyStrategy = cfg.latencyStrategy as "last-known" | "null";
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	return result;
}

function validateMissingPulseDetectorConfig(config: unknown): MissingPulseDetectorConfig {
	const errors: string[] = [];
	const cfg = (config || {}) as Record<string, unknown>;

	const result: MissingPulseDetectorConfig = {
		interval: 5,
	};

	if (cfg.interval !== undefined) {
		if (!isNumber(cfg.interval) || cfg.interval < 1) {
			errors.push("missingPulseDetector.interval must be a number >= 1");
		} else {
			result.interval = cfg.interval;
		}
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	return result;
}

function validatePulseMonitor(pulseMonitor: unknown, index: number): PulseMonitor {
	const errors: string[] = [];

	if (!isObject(pulseMonitor)) {
		throw new Error(`PulseMonitors[${index}] must be an object`);
	}

	// Validate ID
	if (!isString(pulseMonitor.id) || pulseMonitor.id.trim().length === 0) {
		errors.push(`PulseMonitors[${index}].id must be a non-empty string`);
	}

	// Validate name
	if (!isString(pulseMonitor.name) || pulseMonitor.name.trim().length === 0) {
		errors.push(`PulseMonitors[${index}].name must be a non-empty string`);
	}

	// Validate token
	if (!isString(pulseMonitor.token) || pulseMonitor.token.trim().length === 0) {
		errors.push(`PulseMonitors[${index}].token must be a non-empty string`);
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	return {
		id: pulseMonitor.id as string,
		name: pulseMonitor.name as string,
		token: pulseMonitor.token as string,
	};
}

function validateEmailConfig(config: unknown, channelId: string): any {
	const errors: string[] = [];
	const cfg = config as Record<string, unknown>;

	if (!isBoolean(cfg.enabled)) {
		errors.push(`notifications.channels.${channelId}.email.enabled must be a boolean`);
	}

	if (!cfg.enabled) {
		return { enabled: false };
	}

	// Validate SMTP config
	if (!isObject(cfg.smtp)) {
		errors.push(`notifications.channels.${channelId}.email.smtp must be an object`);
	} else {
		const smtp = cfg.smtp as Record<string, unknown>;

		if (!isString(smtp.host) || smtp.host.trim().length === 0) {
			errors.push(`notifications.channels.${channelId}.email.smtp.host must be a non-empty string`);
		}

		if (!isNumber(smtp.port) || smtp.port <= 0 || smtp.port > 65535) {
			errors.push(`notifications.channels.${channelId}.email.smtp.port must be a valid port number`);
		}

		if (!isBoolean(smtp.secure)) {
			errors.push(`notifications.channels.${channelId}.email.smtp.secure must be a boolean`);
		}

		if (!isString(smtp.user) || smtp.user.trim().length === 0) {
			errors.push(`notifications.channels.${channelId}.email.smtp.user must be a non-empty string`);
		}

		if (!isString(smtp.pass) || smtp.pass.trim().length === 0) {
			errors.push(`notifications.channels.${channelId}.email.smtp.pass must be a non-empty string`);
		}
	}

	// Validate from field
	if (!isString(cfg.from) || cfg.from.trim().length === 0) {
		errors.push(`notifications.channels.${channelId}.email.from must be a non-empty string`);
	}

	// Validate to field
	if (!isArray(cfg.to)) {
		errors.push(`notifications.channels.${channelId}.email.to must be an array`);
	} else if (cfg.to.length === 0) {
		errors.push(`notifications.channels.${channelId}.email.to must have at least one recipient`);
	} else {
		for (let i = 0; i < cfg.to.length; i++) {
			if (!isString(cfg.to[i]) || (cfg.to[i] as string).trim().length === 0) {
				errors.push(`notifications.channels.${channelId}.email.to[${i}] must be a non-empty string`);
			}
		}
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	return {
		enabled: cfg.enabled,
		smtp: {
			host: (cfg.smtp as any).host,
			port: (cfg.smtp as any).port,
			secure: (cfg.smtp as any).secure,
			auth: {
				user: (cfg.smtp as any).user,
				pass: (cfg.smtp as any).pass,
			},
		},
		from: cfg.from,
		to: cfg.to,
	};
}

function validateDiscordConfig(config: unknown, channelId: string): any {
	const errors: string[] = [];
	const cfg = config as Record<string, unknown>;

	if (!isBoolean(cfg.enabled)) {
		errors.push(`notifications.channels.${channelId}.discord.enabled must be a boolean`);
	}

	if (!cfg.enabled) {
		return { enabled: false };
	}

	if (!isString(cfg.webhookUrl) || cfg.webhookUrl.trim().length === 0) {
		errors.push(`notifications.channels.${channelId}.discord.webhookUrl must be a non-empty string`);
	}

	// Validate optional fields
	if (cfg.username !== undefined && (!isString(cfg.username) || cfg.username.trim().length === 0)) {
		errors.push(`notifications.channels.${channelId}.discord.username must be a non-empty string if provided`);
	}

	if (cfg.avatarUrl !== undefined && (!isString(cfg.avatarUrl) || cfg.avatarUrl.trim().length === 0)) {
		errors.push(`notifications.channels.${channelId}.discord.avatarUrl must be a non-empty string if provided`);
	}

	// Validate mentions
	if (cfg.mentions !== undefined) {
		if (!isObject(cfg.mentions)) {
			errors.push(`notifications.channels.${channelId}.discord.mentions must be an object`);
		} else {
			const mentions = cfg.mentions as Record<string, unknown>;

			if (mentions.users !== undefined) {
				if (!isArray(mentions.users)) {
					errors.push(`notifications.channels.${channelId}.discord.mentions.users must be an array`);
				} else {
					for (let i = 0; i < mentions.users.length; i++) {
						if (!isString(mentions.users[i])) {
							errors.push(`notifications.channels.${channelId}.discord.mentions.users[${i}] must be a string`);
						}
					}
				}
			}

			if (mentions.roles !== undefined) {
				if (!isArray(mentions.roles)) {
					errors.push(`notifications.channels.${channelId}.discord.mentions.roles must be an array`);
				} else {
					for (let i = 0; i < mentions.roles.length; i++) {
						if (!isString(mentions.roles[i])) {
							errors.push(`notifications.channels.${channelId}.discord.mentions.roles[${i}] must be a string`);
						}
					}
				}
			}

			if (mentions.everyone !== undefined && !isBoolean(mentions.everyone)) {
				errors.push(`notifications.channels.${channelId}.discord.mentions.everyone must be a boolean`);
			}
		}
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	const result: any = {
		enabled: cfg.enabled,
		webhookUrl: cfg.webhookUrl,
	};

	if (cfg.username) result.username = cfg.username;
	if (cfg.avatarUrl) result.avatarUrl = cfg.avatarUrl;
	if (cfg.mentions) {
		result.mentions = {};
		const mentions = cfg.mentions as Record<string, unknown>;
		if (mentions.users) result.mentions.users = mentions.users;
		if (mentions.roles) result.mentions.roles = mentions.roles;
		if (mentions.everyone !== undefined) result.mentions.everyone = mentions.everyone;
	}

	return result;
}

function validateNtfyConfig(config: unknown, channelId: string): any {
	const errors: string[] = [];
	const cfg = config as Record<string, unknown>;

	if (!isBoolean(cfg.enabled)) {
		errors.push(`notifications.channels.${channelId}.ntfy.enabled must be a boolean`);
	}

	if (!cfg.enabled) {
		return { enabled: false };
	}

	// Validate server
	if (!isString(cfg.server) || cfg.server.trim().length === 0) {
		errors.push(`notifications.channels.${channelId}.ntfy.server must be a non-empty string`);
	}

	// Validate topic
	if (!isString(cfg.topic) || cfg.topic.trim().length === 0) {
		errors.push(`notifications.channels.${channelId}.ntfy.topic must be a non-empty string`);
	}

	// Validate optional username
	if (cfg.username !== undefined && (!isString(cfg.username) || cfg.username.trim().length === 0)) {
		errors.push(`notifications.channels.${channelId}.ntfy.username must be a non-empty string if provided`);
	}

	// Validate optional password
	if (cfg.password !== undefined && (!isString(cfg.password) || cfg.password.trim().length === 0)) {
		errors.push(`notifications.channels.${channelId}.ntfy.password must be a non-empty string if provided`);
	}

	// Validate optional token
	if (cfg.token !== undefined && (!isString(cfg.token) || cfg.token.trim().length === 0)) {
		errors.push(`notifications.channels.${channelId}.ntfy.token must be a non-empty string if provided`);
	}

	// Warn if username is provided without password or vice versa
	if ((cfg.username && !cfg.password) || (!cfg.username && cfg.password)) {
		errors.push(`notifications.channels.${channelId}.ntfy: both username and password must be provided together`);
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	const result: any = {
		enabled: cfg.enabled,
		server: cfg.server,
		topic: cfg.topic,
	};

	if (cfg.username) result.username = cfg.username;
	if (cfg.password) result.password = cfg.password;
	if (cfg.token) result.token = cfg.token;

	return result;
}

function validateTelegramConfig(config: unknown, channelId: string): any {
	const errors: string[] = [];
	const cfg = config as Record<string, unknown>;

	if (!isBoolean(cfg.enabled)) {
		errors.push(`notifications.channels.${channelId}.telegram.enabled must be a boolean`);
	}

	if (!cfg.enabled) {
		return { enabled: false };
	}

	if (!isString(cfg.botToken) || cfg.botToken.trim().length === 0) {
		errors.push(`notifications.channels.${channelId}.telegram.botToken must be a non-empty string`);
	}

	if (!isString(cfg.chatId) || cfg.chatId.trim().length === 0) {
		errors.push(`notifications.channels.${channelId}.telegram.chatId must be a non-empty string`);
	}

	if (cfg.topicId !== undefined && !isNumber(cfg.topicId)) {
		errors.push(`notifications.channels.${channelId}.telegram.topicId must be a number if provided`);
	}

	if (cfg.disableNotification !== undefined && !isBoolean(cfg.disableNotification)) {
		errors.push(`notifications.channels.${channelId}.telegram.disableNotification must be a boolean if provided`);
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	const result: any = {
		enabled: cfg.enabled,
		botToken: cfg.botToken,
		chatId: cfg.chatId,
	};

	if (cfg.topicId !== undefined) result.topicId = cfg.topicId;
	if (cfg.disableNotification !== undefined) result.disableNotification = cfg.disableNotification;

	return result;
}

function validateWebhookConfig(config: unknown, channelId: string): any {
	const errors: string[] = [];
	const cfg = config as Record<string, unknown>;

	if (!isBoolean(cfg.enabled)) {
		errors.push(`notifications.channels.${channelId}.webhook.enabled must be a boolean`);
	}

	if (!cfg.enabled) {
		return { enabled: false };
	}

	if (!isString(cfg.url) || cfg.url.trim().length === 0) {
		errors.push(`notifications.channels.${channelId}.webhook.url must be a non-empty string`);
	}

	if (cfg.headers !== undefined) {
		if (!isObject(cfg.headers)) {
			errors.push(`notifications.channels.${channelId}.webhook.headers must be an object`);
		} else {
			for (const [key, value] of Object.entries(cfg.headers)) {
				if (!isString(value)) {
					errors.push(`notifications.channels.${channelId}.webhook.headers.${key} must be a string`);
				}
			}
		}
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	const result: any = {
		enabled: cfg.enabled,
		url: cfg.url,
	};

	if (cfg.headers) result.headers = cfg.headers;

	return result;
}

function validateNotificationChannel(channel: unknown, channelId: string): NotificationChannel {
	const errors: string[] = [];

	if (!isObject(channel)) {
		throw new Error(`notifications.channels.${channelId} must be an object`);
	}

	// Validate basic properties
	if (!isString(channel.id) || channel.id.trim().length === 0) {
		errors.push(`notifications.channels.${channelId}.id must be a non-empty string`);
	}

	if (!isString(channel.name) || channel.name.trim().length === 0) {
		errors.push(`notifications.channels.${channelId}.name must be a non-empty string`);
	}

	if (channel.description !== undefined && (!isString(channel.description) || channel.description.trim().length === 0)) {
		errors.push(`notifications.channels.${channelId}.description must be a non-empty string if provided`);
	}

	if (!isBoolean(channel.enabled)) {
		errors.push(`notifications.channels.${channelId}.enabled must be a boolean`);
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	const result: NotificationChannel = {
		id: channel.id as string,
		name: channel.name as string,
		enabled: channel.enabled as boolean,
	};

	if (channel.description) {
		result.description = channel.description as string;
	}

	// Validate provider configurations
	if (channel.email) {
		try {
			result.email = validateEmailConfig(channel.email, channelId);
		} catch (error) {
			if (error instanceof ConfigValidationError) {
				throw error;
			}
		}
	}

	if (channel.discord) {
		try {
			result.discord = validateDiscordConfig(channel.discord, channelId);
		} catch (error) {
			if (error instanceof ConfigValidationError) {
				throw error;
			}
		}
	}

	if (channel.ntfy) {
		try {
			result.ntfy = validateNtfyConfig(channel.ntfy, channelId);
		} catch (error) {
			if (error instanceof ConfigValidationError) {
				throw error;
			}
		}
	}

	if (channel.telegram) {
		try {
			result.telegram = validateTelegramConfig(channel.telegram, channelId);
		} catch (error) {
			if (error instanceof ConfigValidationError) {
				throw error;
			}
		}
	}

	if (channel.webhook) {
		try {
			result.webhook = validateWebhookConfig(channel.webhook, channelId);
		} catch (error) {
			if (error instanceof ConfigValidationError) {
				throw error;
			}
		}
	}

	return result;
}

function validateNotificationsConfig(config: unknown): NotificationsConfig {
	const errors: string[] = [];

	if (!config) {
		return { channels: {} };
	}

	if (!isObject(config)) {
		throw new ConfigValidationError(["notifications must be an object"]);
	}

	const channels: Record<string, NotificationChannel> = {};

	if (config.channels) {
		if (!isObject(config.channels)) {
			errors.push("notifications.channels must be an object");
		} else {
			for (const [channelId, channelConfig] of Object.entries(config.channels)) {
				try {
					channels[channelId] = validateNotificationChannel(channelConfig, channelId);
				} catch (error) {
					if (error instanceof ConfigValidationError) {
						errors.push(...error.errors);
					} else if (error instanceof Error) {
						errors.push(error.message);
					}
				}
			}
		}
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	return { channels };
}

function validateNotificationChannels(notificationChannels: unknown, context: string): string[] {
	if (notificationChannels === undefined) {
		return [];
	}

	if (!isArray(notificationChannels)) {
		throw new ConfigValidationError([`${context}.notificationChannels must be an array if provided`]);
	}

	const errors: string[] = [];
	const channels: string[] = [];

	for (let i = 0; i < notificationChannels.length; i++) {
		if (!isString(notificationChannels[i]) || (notificationChannels[i] as string).trim().length === 0) {
			errors.push(`${context}.notificationChannels[${i}] must be a non-empty string`);
		} else {
			channels.push(notificationChannels[i] as string);
		}
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	return channels;
}

function validateUniqueIds(config: Config): void {
	const errors: string[] = [];

	// Check for duplicate PulseMonitor IDs
	const pulseMonitorIds = new Set<string>();
	for (const pulseMonitor of config.pulseMonitors) {
		if (pulseMonitorIds.has(pulseMonitor.id)) {
			errors.push(`Duplicate PulseMonitor ID: ${pulseMonitor.id}`);
		}
		pulseMonitorIds.add(pulseMonitor.id);
	}

	// Check for duplicate PulseMonitor tokens
	const pulseMonitorTokens = new Set<string>();
	for (const pulseMonitor of config.pulseMonitors) {
		if (pulseMonitorTokens.has(pulseMonitor.token)) {
			errors.push(`Duplicate PulseMonitor token: ${pulseMonitor.token}`);
		}
		pulseMonitorTokens.add(pulseMonitor.token);
	}

	// Check for duplicate monitor IDs
	const monitorIds = new Set<string>();
	for (const monitor of config.monitors) {
		if (monitorIds.has(monitor.id)) {
			errors.push(`Duplicate monitor ID: ${monitor.id}`);
		}
		monitorIds.add(monitor.id);
	}

	// Check for duplicate monitor tokens
	const tokens = new Set<string>();
	for (const monitor of config.monitors) {
		if (tokens.has(monitor.token)) {
			errors.push(`Duplicate monitor token: ${monitor.token}`);
		}
		tokens.add(monitor.token);
	}

	// Check for duplicate group IDs
	const groupIds = new Set<string>();
	for (const group of config.groups) {
		if (groupIds.has(group.id)) {
			errors.push(`Duplicate group ID: ${group.id}`);
		}
		groupIds.add(group.id);
	}

	// Check for duplicate status page IDs
	const statusPageIds = new Set<string>();
	for (const page of config.statusPages) {
		if (statusPageIds.has(page.id)) {
			errors.push(`Duplicate status page ID: ${page.id}`);
		}
		statusPageIds.add(page.id);
	}

	// Check for duplicate status page slugs
	const slugs = new Set<string>();
	for (const page of config.statusPages) {
		if (slugs.has(page.slug)) {
			errors.push(`Duplicate status page slug: ${page.slug}`);
		}
		slugs.add(page.slug);
	}

	const notificationChannelIds = new Set<string>();
	for (const [channelId, channel] of Object.entries(config.notifications?.channels || {})) {
		if (notificationChannelIds.has(channel.id)) {
			errors.push(`Duplicate notification channel ID: ${channel.id}`);
		}
		notificationChannelIds.add(channel.id);

		// Also check that the key matches the ID
		if (channelId !== channel.id) {
			errors.push(`Notification channel key '${channelId}' does not match channel ID '${channel.id}'`);
		}
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}
}

function validateReferences(config: Config): void {
	const errors: string[] = [];

	// Create sets of valid IDs
	const validPulseMonitorIds = new Set(config.pulseMonitors.map((pm) => pm.id));
	const validMonitorIds = new Set(config.monitors.map((m) => m.id));
	const validGroupIds = new Set(config.groups.map((g) => g.id));
	const allValidIds = new Set([...validMonitorIds, ...validGroupIds]);
	const validNotificationChannelIds = new Set(Object.keys(config.notifications?.channels || {}));

	// Validate monitor group references
	for (const monitor of config.monitors) {
		if (monitor.notificationChannels) {
			for (const channelId of monitor.notificationChannels) {
				if (!validNotificationChannelIds.has(channelId)) {
					errors.push(`Monitor '${monitor.id}' references non-existent notification channel: ${channelId}`);
				}
			}
		}

		if (monitor.children) {
			for (const childId of monitor.children) {
				if (!allValidIds.has(childId)) {
					errors.push(`Monitor '${monitor.id}' references non-existent child: ${childId}`);
				}
				if (childId === monitor.id) {
					errors.push(`Monitor '${monitor.id}' cannot be its own child`);
				}
			}
		}

		if (monitor.dependencies) {
			for (const depId of monitor.dependencies) {
				if (!allValidIds.has(depId)) {
					errors.push(`Monitor '${monitor.id}' has dependency on non-existent monitor/group: ${depId}`);
				}
				if (depId === monitor.id) {
					errors.push(`Monitor '${monitor.id}' cannot depend on itself`);
				}
			}
		}

		if (monitor.pulseMonitors) {
			for (const pulseMonitorId of monitor.pulseMonitors) {
				if (!validPulseMonitorIds.has(pulseMonitorId)) {
					errors.push(`Monitor '${monitor.id}' references non-existent PulseMonitor: ${pulseMonitorId}`);
				}
			}

			// Monitors with pulseMonitors must have pulse configuration
			if (monitor.pulseMonitors.length > 0 && !monitor.pulse) {
				errors.push(`Monitor '${monitor.id}' has pulseMonitors configured but no pulse configuration`);
			}
		}
	}

	// Validate group parent references
	for (const group of config.groups) {
		if (group.notificationChannels) {
			for (const channelId of group.notificationChannels) {
				if (!validNotificationChannelIds.has(channelId)) {
					errors.push(`Group '${group.id}' references non-existent notification channel: ${channelId}`);
				}
			}
		}

		if (group.children) {
			for (const childId of group.children) {
				if (!allValidIds.has(childId)) {
					errors.push(`Group '${group.id}' references non-existent child: ${childId}`);
				}
				if (childId === group.id) {
					errors.push(`Group '${group.id}' cannot be its own child`);
				}
			}
		}

		if (group.dependencies) {
			for (const depId of group.dependencies) {
				if (!allValidIds.has(depId)) {
					errors.push(`Group '${group.id}' has dependency on non-existent monitor/group: ${depId}`);
				}
				if (depId === group.id) {
					errors.push(`Group '${group.id}' cannot depend on itself`);
				}
			}
		}
	}

	// Validate status page item references
	for (const page of config.statusPages) {
		for (const itemId of page.items) {
			if (!allValidIds.has(itemId)) {
				errors.push(`Status page '${page.id}' references non-existent item: ${itemId}`);
			}
		}
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}
}

function detectCircularReferences(config: Config): void {
	const errors: string[] = [];

	const childrenGraph = new Map<string, string[]>();
	for (const monitor of config.monitors) {
		if (monitor.children?.length) {
			childrenGraph.set(monitor.id, monitor.children);
		}
	}
	for (const group of config.groups) {
		if (group.children?.length) {
			childrenGraph.set(group.id, group.children);
		}
	}

	const visited = new Set<string>();
	const recursionStack = new Set<string>();

	function checkCircular(id: string, path: string[] = []): void {
		if (recursionStack.has(id)) {
			errors.push(`Circular children reference detected: ${[...path, id].join(" -> ")}`);
			return;
		}
		if (visited.has(id)) return;

		visited.add(id);
		recursionStack.add(id);

		const children = childrenGraph.get(id);
		if (children) {
			for (const childId of children) {
				checkCircular(childId, [...path, id]);
			}
		}

		recursionStack.delete(id);
	}

	for (const id of childrenGraph.keys()) {
		if (!visited.has(id)) {
			checkCircular(id);
		}
	}

	// Check for circular dependency references (across all monitors and groups)
	const allEntities = new Map<string, string[]>();
	for (const monitor of config.monitors) {
		if (monitor.dependencies?.length) {
			allEntities.set(monitor.id, monitor.dependencies);
		}
	}
	for (const group of config.groups) {
		if (group.dependencies?.length) {
			allEntities.set(group.id, group.dependencies);
		}
	}

	const depVisited = new Set<string>();
	const depStack = new Set<string>();

	function checkDepCircular(entityId: string, path: string[] = []): void {
		if (depStack.has(entityId)) {
			errors.push(`Circular dependency detected: ${[...path, entityId].join(" -> ")}`);
			return;
		}

		if (depVisited.has(entityId)) return;

		depVisited.add(entityId);
		depStack.add(entityId);

		const deps = allEntities.get(entityId);
		if (deps) {
			for (const depId of deps) {
				checkDepCircular(depId, [...path, entityId]);
			}
		}

		depStack.delete(entityId);
	}

	for (const entityId of allEntities.keys()) {
		if (!depVisited.has(entityId)) {
			checkDepCircular(entityId);
		}
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}
}

function validateNotificationChannelProviders(config: Config): void {
	const errors: string[] = [];

	for (const [channelId, channel] of Object.entries(config.notifications?.channels || {})) {
		if (!channel.enabled) {
			continue;
		}

		// Check that enabled channels have at least one provider configured
		const hasEmail = channel.email?.enabled;
		const hasDiscord = channel.discord?.enabled;
		const hasNtfy = channel.ntfy?.enabled;
		const hasTelegram = channel.telegram?.enabled;
		const hasWebhook = channel.webhook?.enabled;

		if (!hasEmail && !hasDiscord && !hasNtfy && !hasTelegram && !hasWebhook) {
			errors.push(`Notification channel '${channelId}' is enabled but has no providers configured`);
		}
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}
}

// Load and validate configuration
function loadConfig(exitOnError: boolean = true): Config {
	const configPath = process.env["CONFIG"] || "./config.toml";

	try {
		// Read the TOML file
		const tomlContent = readFileSync(configPath, "utf-8");
		const parsed = Bun.TOML.parse(tomlContent) as Record<string, unknown>;

		const allErrors: string[] = [];

		// Validate ClickHouse config
		let clickhouse: NodeClickHouseClientConfigOptions;
		try {
			clickhouse = validateClickHouseConfig(parsed.clickhouse);
		} catch (error) {
			if (error instanceof ConfigValidationError) {
				allErrors.push(...error.errors);
				clickhouse = { url: "http://localhost:8123/uptime_monitor" };
			} else throw error;
		}

		// Validate server config
		let server: ServerConfig;
		try {
			server = validateServerConfig(parsed.server);
		} catch (error) {
			if (error instanceof ConfigValidationError) {
				allErrors.push(...error.errors);
				server = { port: 3000, proxy: "direct", reloadToken: defaultReloadToken };
			} else throw error;
		}

		// Validate adminAPI config
		let adminAPI: AdminAPIConfig;
		try {
			adminAPI = validateAdminAPIConfig(parsed.adminAPI);
		} catch (error) {
			if (error instanceof ConfigValidationError) {
				allErrors.push(...error.errors);
				adminAPI = { enabled: false, token: defaultAdminToken };
			} else throw error;
		}

		let logger: LoggerConfig;
		try {
			logger = validateLoggerConfig(parsed.logger);
		} catch (error) {
			if (error instanceof ConfigValidationError) {
				allErrors.push(...error.errors);
				logger = { level: 4 };
			} else throw error;
		}

		let selfMonitoring: SelfMonitoringConfig;
		try {
			selfMonitoring = validateSelfMonitoringConfig(parsed.selfMonitoring);
		} catch (error) {
			if (error instanceof ConfigValidationError) {
				allErrors.push(...error.errors);
				selfMonitoring = {
					enabled: false,
					id: "self-monitor",
					interval: 3,
					backfillOnRecovery: false,
					latencyStrategy: "last-known",
				};
			} else throw error;
		}

		let missingPulseDetector: MissingPulseDetectorConfig;
		try {
			missingPulseDetector = validateMissingPulseDetectorConfig(parsed.missingPulseDetector);
		} catch (error) {
			if (error instanceof ConfigValidationError) {
				allErrors.push(...error.errors);
				missingPulseDetector = { interval: 5 };
			} else throw error;
		}

		let notifications: NotificationsConfig;
		try {
			notifications = validateNotificationsConfig(parsed.notifications);
		} catch (error) {
			if (error instanceof ConfigValidationError) {
				allErrors.push(...error.errors);
				notifications = { channels: {} };
			} else throw error;
		}

		// Validate PulseMonitors
		const pulseMonitors: PulseMonitor[] = [];
		if (parsed.PulseMonitors !== undefined) {
			if (!isArray(parsed.PulseMonitors)) {
				allErrors.push("PulseMonitors must be an array");
			} else {
				for (let i = 0; i < parsed.PulseMonitors.length; i++) {
					try {
						pulseMonitors.push(validatePulseMonitor(parsed.PulseMonitors[i], i));
					} catch (error) {
						if (error instanceof ConfigValidationError) {
							allErrors.push(...error.errors);
						} else if (error instanceof Error) {
							allErrors.push(error.message);
						}
					}
				}
			}
		}

		// Validate monitors
		const monitors: Monitor[] = [];
		if (!isArray(parsed.monitors)) {
			allErrors.push("monitors must be an array");
		} else if (parsed.monitors.length === 0) {
			allErrors.push("At least one monitor must be configured");
		} else {
			for (let i = 0; i < parsed.monitors.length; i++) {
				try {
					monitors.push(validateMonitor(parsed.monitors[i], i));
				} catch (error) {
					if (error instanceof ConfigValidationError) {
						allErrors.push(...error.errors);
					} else if (error instanceof Error) {
						allErrors.push(error.message);
					}
				}
			}
		}

		// Validate groups
		const groups: Group[] = [];
		if (parsed.groups !== undefined) {
			if (!isArray(parsed.groups)) {
				allErrors.push("groups must be an array");
			} else {
				for (let i = 0; i < parsed.groups.length; i++) {
					try {
						groups.push(validateGroup(parsed.groups[i], i));
					} catch (error) {
						if (error instanceof ConfigValidationError) {
							allErrors.push(...error.errors);
						} else if (error instanceof Error) {
							allErrors.push(error.message);
						}
					}
				}
			}
		}

		// Validate status pages
		const statusPages: StatusPage[] = [];
		if (!isArray(parsed.status_pages)) {
			allErrors.push("status_pages must be an array");
		} else if (parsed.status_pages.length === 0) {
			allErrors.push("At least one status page must be configured");
		} else {
			for (let i = 0; i < parsed.status_pages.length; i++) {
				try {
					statusPages.push(validateStatusPage(parsed.status_pages[i], i));
				} catch (error) {
					if (error instanceof ConfigValidationError) {
						allErrors.push(...error.errors);
					} else if (error instanceof Error) {
						allErrors.push(error.message);
					}
				}
			}
		}

		if (allErrors.length > 0) {
			throw new ConfigValidationError(allErrors);
		}

		const config: Config = {
			clickhouse,
			server,
			adminAPI,
			logger,
			selfMonitoring,
			missingPulseDetector,
			notifications,
			pulseMonitors,
			monitors,
			groups,
			statusPages,
		};

		// Additional validations
		validateUniqueIds(config);
		validateReferences(config);
		detectCircularReferences(config);
		validateNotificationChannelProviders(config);

		Logger.setLevel(logger.level || 4);

		Logger.info(`Configuration loaded successfully from ${configPath}`, {
			monitors: config.monitors.length,
			groups: config.groups.length,
			statusPages: config.statusPages.length,
			pulseMonitors: config.pulseMonitors.length,
			notificationChannels: Object.keys(config.notifications?.channels || {}).length,
			missingPulseDetectorInterval: config.missingPulseDetector.interval + "s",
		});

		return config;
	} catch (err: any) {
		Logger.error("Configuration validation failed:");

		if (err instanceof ConfigValidationError) {
			for (const error of err.errors) {
				Logger.error(`  - ${error}`);
			}
		} else if (err instanceof Error) {
			Logger.error("Unknown error", { "error.message": err?.message });
		} else {
			Logger.error("Unknown error", { "error.message": err?.message });
		}

		if (exitOnError) {
			process.exit(1);
		}

		throw err;
	}
}

export let config: Config = loadConfig();

export function reloadConfig(): Config {
	Logger.info("🔄 Reloading configuration...");
	const newConfig = loadConfig(false);
	config = newConfig;
	return newConfig;
}
