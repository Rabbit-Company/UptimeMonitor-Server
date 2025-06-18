import { readFileSync } from "fs";
import type { Config, Monitor, Group, StatusPage, ServerConfig } from "./types";
import type { NodeClickHouseClientConfigOptions } from "@clickhouse/client/dist/config";
import { Logger } from "./logger";

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

function isArray(value: unknown): value is unknown[] {
	return Array.isArray(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Validation functions
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

	// Validate optional groupId
	if (monitor.groupId !== undefined && (!isString(monitor.groupId) || monitor.groupId.trim().length === 0)) {
		errors.push(`monitors[${index}].groupId must be a non-empty string if provided`);
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	return {
		id: monitor.id as string,
		name: monitor.name as string,
		token: monitor.token as string,
		interval: monitor.interval as number,
		groupId: monitor.groupId as string | undefined,
	};
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

	// Validate optional parentId
	if (group.parentId !== undefined && (!isString(group.parentId) || group.parentId.trim().length === 0)) {
		errors.push(`groups[${index}].parentId must be a non-empty string if provided`);
	}

	// Validate degradedThreshold
	if (!isNumber(group.degradedThreshold)) {
		errors.push(`groups[${index}].degradedThreshold must be a number`);
	} else if (group.degradedThreshold < 0 || group.degradedThreshold > 100) {
		errors.push(`groups[${index}].degradedThreshold must be between 0 and 100`);
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	return {
		id: group.id as string,
		name: group.name as string,
		parentId: group.parentId as string | undefined,
		degradedThreshold: group.degradedThreshold as number,
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

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	return {
		id: page.id as string,
		name: page.name as string,
		slug: page.slug as string,
		items: page.items as string[],
	};
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

function validateServerConfig(config: unknown): ServerConfig {
	const errors: string[] = [];
	const cfg = (config || {}) as Record<string, unknown>;

	const result: ServerConfig = {
		port: 3000,
	};

	if (cfg.port !== undefined) {
		if (!isNumber(cfg.port) || cfg.port <= 0 || cfg.port > 65535) {
			errors.push("server.port must be a valid port number (1-65535)");
		} else {
			result.port = cfg.port;
		}
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	return result;
}

function validateUniqueIds(config: Config): void {
	const errors: string[] = [];

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

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}
}

function validateReferences(config: Config): void {
	const errors: string[] = [];

	// Create sets of valid IDs
	const validMonitorIds = new Set(config.monitors.map((m) => m.id));
	const validGroupIds = new Set(config.groups.map((g) => g.id));
	const allValidIds = new Set([...validMonitorIds, ...validGroupIds]);

	// Validate monitor group references
	for (const monitor of config.monitors) {
		if (monitor.groupId && !validGroupIds.has(monitor.groupId)) {
			errors.push(`Monitor '${monitor.id}' references non-existent group: ${monitor.groupId}`);
		}
	}

	// Validate group parent references
	for (const group of config.groups) {
		if (group.parentId) {
			if (!validGroupIds.has(group.parentId)) {
				errors.push(`Group '${group.id}' references non-existent parent group: ${group.parentId}`);
			}
			if (group.parentId === group.id) {
				errors.push(`Group '${group.id}' cannot be its own parent`);
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

	// Check for circular group references
	const visited = new Set<string>();
	const recursionStack = new Set<string>();

	function checkCircular(groupId: string, path: string[] = []): void {
		if (recursionStack.has(groupId)) {
			errors.push(`Circular reference detected in groups: ${[...path, groupId].join(" -> ")}`);
			return;
		}

		if (visited.has(groupId)) return;

		visited.add(groupId);
		recursionStack.add(groupId);

		const group = config.groups.find((g) => g.id === groupId);
		if (group?.parentId) {
			checkCircular(group.parentId, [...path, groupId]);
		}

		recursionStack.delete(groupId);
	}

	for (const group of config.groups) {
		if (!visited.has(group.id)) {
			checkCircular(group.id);
		}
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}
}

// Load and validate configuration
function loadConfig(): Config {
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
				server = { port: 3000 };
			} else throw error;
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
			monitors,
			groups,
			statusPages,
		};

		// Additional validations
		validateUniqueIds(config);
		validateReferences(config);
		detectCircularReferences(config);

		Logger.info(`Configuration loaded successfully from ${configPath}`, {
			monitors: config.monitors.length,
			groups: config.groups.length,
			statusPages: config.statusPages.length,
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

		process.exit(1);
	}
}

// Export the validated configuration
export const config: Config = loadConfig();

// Re-export for hot reloading support
export function reloadConfig(): Config {
	Logger.info("🔄 Reloading configuration...");
	return loadConfig();
}
