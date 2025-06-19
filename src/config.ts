import { readFileSync } from "fs";
import type { Config, Monitor, Group, StatusPage, ServerConfig, LoggerConfig, NotificationsConfig, NotificationChannel } from "./types";
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

function isBoolean(value: unknown): value is boolean {
	return typeof value === "boolean";
}

function isArray(value: unknown): value is unknown[] {
	return Array.isArray(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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

	// Validate toleranceFactor
	if (!isNumber(monitor.toleranceFactor) || monitor.toleranceFactor <= 0) {
		errors.push(`monitors[${index}].toleranceFactor must be a positive number`);
	}

	// Validate resendNotification
	if (!isNumber(monitor.resendNotification) || monitor.resendNotification < 0) {
		errors.push(`monitors[${index}].resendNotification must be a positive number`);
	}

	// Validate optional groupId
	if (monitor.groupId !== undefined && (!isString(monitor.groupId) || monitor.groupId.trim().length === 0)) {
		errors.push(`monitors[${index}].groupId must be a non-empty string if provided`);
	}

	if (errors.length > 0) {
		throw new ConfigValidationError(errors);
	}

	const notificationChannels = validateNotificationChannels(monitor.notificationChannels, `monitors[${index}]`);

	return {
		id: monitor.id as string,
		name: monitor.name as string,
		token: monitor.token as string,
		interval: monitor.interval as number,
		maxRetries: monitor.maxRetries as number,
		toleranceFactor: monitor.toleranceFactor as number,
		resendNotification: monitor.resendNotification as number,
		groupId: monitor.groupId as string | undefined,
		notificationChannels,
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

	if (!isString(group.strategy) || !["any-up", "percentage", "all-up"].includes(group.strategy)) {
		errors.push(`groups[${index}].strategy must be either 'any-up', 'percentage' or 'all-up'`);
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

	const notificationChannels = validateNotificationChannels(group.notificationChannels, `groups[${index}]`);

	return {
		id: group.id as string,
		name: group.name as string,
		strategy: group.strategy as "any-up" | "percentage" | "all-up",
		degradedThreshold: group.degradedThreshold as number,
		parentId: group.parentId as string | undefined,
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

	// Validate templates
	if (!isObject(cfg.templates)) {
		errors.push(`notifications.channels.${channelId}.email.templates must be an object`);
	} else {
		const templates = cfg.templates as Record<string, unknown>;

		if (!isObject(templates.subject)) {
			errors.push(`notifications.channels.${channelId}.email.templates.subject must be an object`);
		} else {
			const subject = templates.subject as Record<string, unknown>;

			if (!isString(subject.down) || subject.down.trim().length === 0) {
				errors.push(`notifications.channels.${channelId}.email.templates.subject.down must be a non-empty string`);
			}

			if (!isString(subject.stillDown) || subject.stillDown.trim().length === 0) {
				errors.push(`notifications.channels.${channelId}.email.templates.subject.stillDown must be a non-empty string`);
			}

			if (!isString(subject.recovered) || subject.recovered.trim().length === 0) {
				errors.push(`notifications.channels.${channelId}.email.templates.subject.recovered must be a non-empty string`);
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
		templates: {
			subject: {
				down: ((cfg.templates as any).subject as any).down,
				stillDown: ((cfg.templates as any).subject as any).stillDown,
				recovered: ((cfg.templates as any).subject as any).recovered,
			},
		},
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
	const validMonitorIds = new Set(config.monitors.map((m) => m.id));
	const validGroupIds = new Set(config.groups.map((g) => g.id));
	const allValidIds = new Set([...validMonitorIds, ...validGroupIds]);
	const validNotificationChannelIds = new Set(Object.keys(config.notifications?.channels || {}));

	// Validate monitor group references
	for (const monitor of config.monitors) {
		if (monitor.groupId && !validGroupIds.has(monitor.groupId)) {
			errors.push(`Monitor '${monitor.id}' references non-existent group: ${monitor.groupId}`);
		}

		if (monitor.notificationChannels) {
			for (const channelId of monitor.notificationChannels) {
				if (!validNotificationChannelIds.has(channelId)) {
					errors.push(`Monitor '${monitor.id}' references non-existent notification channel: ${channelId}`);
				}
			}
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

		if (group.notificationChannels) {
			for (const channelId of group.notificationChannels) {
				if (!validNotificationChannelIds.has(channelId)) {
					errors.push(`Group '${group.id}' references non-existent notification channel: ${channelId}`);
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

function validateNotificationChannelProviders(config: Config): void {
	const errors: string[] = [];

	for (const [channelId, channel] of Object.entries(config.notifications?.channels || {})) {
		if (!channel.enabled) {
			continue;
		}

		// Check that enabled channels have at least one provider configured
		const hasEmail = channel.email?.enabled;
		const hasDiscord = channel.discord?.enabled;

		if (!hasEmail && !hasDiscord) {
			errors.push(`Notification channel '${channelId}' is enabled but has no providers configured`);
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

		let logger: LoggerConfig;
		try {
			logger = validateLoggerConfig(parsed.logger);
		} catch (error) {
			if (error instanceof ConfigValidationError) {
				allErrors.push(...error.errors);
				logger = { level: 4 };
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
			logger,
			notifications,
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
			notificationChannels: Object.keys(config.notifications?.channels || {}).length,
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
