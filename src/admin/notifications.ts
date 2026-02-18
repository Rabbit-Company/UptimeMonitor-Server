import type { Web, Server } from "@rabbit-company/web";
import { cache } from "../cache";
import { Logger } from "../logger";
import { readRawConfig, validateConfig, writeAndReload, isValidId, adminBearerAuth } from "./helpers";

export function registerNotificationRoutes(app: Web, getServer: () => Server): void {
	app.get("/v1/admin/notifications", adminBearerAuth(), (ctx) => {
		return ctx.json({ notificationChannels: cache.getAllNotificationChannels() });
	});

	app.get("/v1/admin/notifications/:id", adminBearerAuth(), (ctx) => {
		const ch = cache.getNotificationChannel(ctx.params["id"]!);
		if (!ch) return ctx.json({ error: "Notification channel not found" }, 404);
		return ctx.json(ch);
	});

	app.post("/v1/admin/notifications", adminBearerAuth(), async (ctx) => {
		let body: any;
		try {
			body = await ctx.req.json();
		} catch (e: any) {
			return ctx.json({ error: e.message }, 400);
		}

		const errors = validate(body, false);
		if (errors.length) return ctx.json({ error: "Validation failed", details: errors }, 400);
		if (cache.getNotificationChannel(body.id)) return ctx.json({ error: `Channel '${body.id}' already exists` }, 409);

		try {
			const raw = await readRawConfig();
			if (!raw.notifications || typeof raw.notifications !== "object") raw.notifications = { channels: {} };
			const notif = raw.notifications as Record<string, any>;
			if (!notif.channels || typeof notif.channels !== "object") notif.channels = {};
			notif.channels[body.id] = serialize(body);

			const v = validateConfig(raw);
			if (v) return ctx.json({ error: "Configuration validation failed", details: v }, 400);

			await writeAndReload(raw, getServer);
			Logger.audit("Admin API: Notification channel created", { channelId: body.id });
			return ctx.json({ success: true, message: `Channel '${body.id}' created`, id: body.id }, 201);
		} catch (e: any) {
			Logger.error("Admin API: Failed to create notification channel", { error: e.message });
			return ctx.json({ error: e.message }, 500);
		}
	});

	app.put("/v1/admin/notifications/:id", adminBearerAuth(), async (ctx) => {
		const id = ctx.params["id"]!;
		if (!cache.getNotificationChannel(id)) return ctx.json({ error: "Notification channel not found" }, 404);

		let body: any;
		try {
			body = await ctx.req.json();
		} catch (e: any) {
			return ctx.json({ error: e.message }, 400);
		}

		const errors = validate(body, true);
		if (errors.length) return ctx.json({ error: "Validation failed", details: errors }, 400);

		try {
			const raw = await readRawConfig();
			const channels = (raw.notifications as any)?.channels as Record<string, any>;
			if (!channels?.[id]) return ctx.json({ error: "Channel not found in config file" }, 404);

			for (const [k, v] of Object.entries(body)) {
				if (k === "id") continue;
				if (v === null) delete channels[id]![k];
				else channels[id]![k] = v;
			}

			const v = validateConfig(raw);
			if (v) return ctx.json({ error: "Configuration validation failed", details: v }, 400);

			await writeAndReload(raw, getServer);
			Logger.audit("Admin API: Notification channel updated", { channelId: id });
			return ctx.json({ success: true, message: `Channel '${id}' updated` });
		} catch (e: any) {
			Logger.error("Admin API: Failed to update notification channel", { error: e.message });
			return ctx.json({ error: e.message }, 500);
		}
	});

	app.delete("/v1/admin/notifications/:id", adminBearerAuth(), async (ctx) => {
		const id = ctx.params["id"]!;
		if (!cache.getNotificationChannel(id)) return ctx.json({ error: "Notification channel not found" }, 404);

		try {
			const raw = await readRawConfig();
			const channels = (raw.notifications as any)?.channels as Record<string, any>;
			if (!channels?.[id]) return ctx.json({ error: "Channel not found in config file" }, 404);
			delete channels[id];

			// Clean up references
			if (Array.isArray(raw.monitors)) {
				for (const m of raw.monitors as any[]) {
					if (Array.isArray(m.notificationChannels)) {
						m.notificationChannels = m.notificationChannels.filter((c: string) => c !== id);
					}
				}
			}
			if (Array.isArray(raw.groups)) {
				for (const g of raw.groups as any[]) {
					if (Array.isArray(g.notificationChannels)) {
						g.notificationChannels = g.notificationChannels.filter((c: string) => c !== id);
					}
				}
			}

			const v = validateConfig(raw);
			if (v) return ctx.json({ error: "Configuration validation failed", details: v }, 400);

			await writeAndReload(raw, getServer);
			Logger.audit("Admin API: Notification channel deleted", { channelId: id });
			return ctx.json({ success: true, message: `Channel '${id}' deleted` });
		} catch (e: any) {
			Logger.error("Admin API: Failed to delete notification channel", { error: e.message });
			return ctx.json({ error: e.message }, 500);
		}
	});
}

function serialize(input: any): Record<string, unknown> {
	const r: Record<string, unknown> = {
		id: input.id,
		name: input.name,
		enabled: input.enabled,
	};
	if (input.description) r.description = input.description;
	if (input.discord) r.discord = input.discord;
	if (input.email) r.email = input.email;
	if (input.ntfy) r.ntfy = input.ntfy;
	if (input.telegram) r.telegram = input.telegram;
	if (input.webhook) r.webhook = input.webhook;
	return r;
}

function validate(input: any, isUpdate: boolean): string[] {
	const e: string[] = [];

	if (!isUpdate) {
		if (!isValidId(input.id)) e.push("id is required (alphanumeric, hyphens, underscores)");
		if (!input.name || typeof input.name !== "string" || !input.name.trim()) e.push("name is required");
		if (typeof input.enabled !== "boolean") e.push("enabled must be a boolean");
	} else {
		if (input.id !== undefined) e.push("id cannot be changed");
		if (input.name !== undefined && (typeof input.name !== "string" || !input.name.trim())) e.push("name must be a non-empty string");
		if (input.enabled !== undefined && typeof input.enabled !== "boolean") e.push("enabled must be a boolean");
	}

	if (input.description !== undefined && input.description !== null && (typeof input.description !== "string" || !input.description.trim())) {
		e.push("description must be a non-empty string if provided");
	}

	// Discord
	if (input.discord !== undefined && input.discord !== null) {
		if (typeof input.discord !== "object" || Array.isArray(input.discord)) {
			e.push("discord must be an object");
		} else {
			if (typeof input.discord.enabled !== "boolean") e.push("discord.enabled must be a boolean");
			if (input.discord.enabled && (!input.discord.webhookUrl || typeof input.discord.webhookUrl !== "string"))
				e.push("discord.webhookUrl is required when enabled");
		}
	}

	// Email
	if (input.email !== undefined && input.email !== null) {
		if (typeof input.email !== "object" || Array.isArray(input.email)) {
			e.push("email must be an object");
		} else {
			if (typeof input.email.enabled !== "boolean") e.push("email.enabled must be a boolean");
			if (input.email.enabled) {
				if (!input.email.from || typeof input.email.from !== "string") e.push("email.from is required when enabled");
				if (!Array.isArray(input.email.to) || input.email.to.length === 0) e.push("email.to must be a non-empty array when enabled");
				if (!input.email.smtp || typeof input.email.smtp !== "object") {
					e.push("email.smtp is required when enabled");
				} else {
					if (!input.email.smtp.host) e.push("email.smtp.host is required");
					if (typeof input.email.smtp.port !== "number") e.push("email.smtp.port must be a number");
					if (typeof input.email.smtp.secure !== "boolean") e.push("email.smtp.secure must be a boolean");
					if (!input.email.smtp.user) e.push("email.smtp.user is required");
					if (!input.email.smtp.pass) e.push("email.smtp.pass is required");
				}
			}
		}
	}

	// Ntfy
	if (input.ntfy !== undefined && input.ntfy !== null) {
		if (typeof input.ntfy !== "object" || Array.isArray(input.ntfy)) {
			e.push("ntfy must be an object");
		} else {
			if (typeof input.ntfy.enabled !== "boolean") e.push("ntfy.enabled must be a boolean");
			if (input.ntfy.enabled) {
				if (!input.ntfy.server || typeof input.ntfy.server !== "string") e.push("ntfy.server is required when enabled");
				if (!input.ntfy.topic || typeof input.ntfy.topic !== "string") e.push("ntfy.topic is required when enabled");
			}
		}
	}

	// Telegram
	if (input.telegram !== undefined && input.telegram !== null) {
		if (typeof input.telegram !== "object" || Array.isArray(input.telegram)) {
			e.push("telegram must be an object");
		} else {
			if (typeof input.telegram.enabled !== "boolean") e.push("telegram.enabled must be a boolean");
			if (input.telegram.enabled) {
				if (!input.telegram.botToken || typeof input.telegram.botToken !== "string") e.push("telegram.botToken is required when enabled");
				if (!input.telegram.chatId || typeof input.telegram.chatId !== "string") e.push("telegram.chatId is required when enabled");
			}
		}
	}

	// Webhook
	if (input.webhook !== undefined && input.webhook !== null) {
		if (typeof input.webhook !== "object" || Array.isArray(input.webhook)) {
			e.push("webhook must be an object");
		} else {
			if (typeof input.webhook.enabled !== "boolean") e.push("webhook.enabled must be a boolean");
			if (input.webhook.enabled) {
				if (!input.webhook.url || typeof input.webhook.url !== "string") e.push("webhook.url is required when enabled");
				if (input.webhook.headers !== undefined) {
					if (typeof input.webhook.headers !== "object" || Array.isArray(input.webhook.headers)) {
						e.push("webhook.headers must be an object");
					}
				}
			}
		}
	}

	return e;
}
