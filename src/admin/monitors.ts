import type { Web, Server } from "@rabbit-company/web";
import { cache } from "../cache";
import { Logger } from "../logger";
import { readRawConfig, validateConfig, writeAndReload, isValidId, adminBearerAuth } from "./helpers";

export function registerMonitorRoutes(app: Web, getServer: () => Server): void {
	app.get("/v1/admin/monitors", adminBearerAuth(), (ctx) => {
		return ctx.json({ monitors: cache.getAllMonitors().map(toResponse) });
	});

	app.get("/v1/admin/monitors/:id", adminBearerAuth(), (ctx) => {
		const m = cache.getMonitor(ctx.params["id"]!);
		if (!m) return ctx.json({ error: "Monitor not found" }, 404);
		return ctx.json(toResponse(m));
	});

	app.post("/v1/admin/monitors", adminBearerAuth(), async (ctx) => {
		let body: any;
		try {
			body = await ctx.req.json();
		} catch (e: any) {
			return ctx.json({ error: e.message }, 400);
		}

		const errors = validate(body, false);
		if (errors.length) return ctx.json({ error: "Validation failed", details: errors }, 400);
		if (cache.getMonitor(body.id)) return ctx.json({ error: `Monitor '${body.id}' already exists` }, 409);
		if (cache.getGroup(body.id)) return ctx.json({ error: `A group with id '${body.id}' already exists` }, 409);
		if (cache.getMonitorByToken(body.token)) return ctx.json({ error: "A monitor with this token already exists" }, 409);

		try {
			const raw = await readRawConfig();
			if (!Array.isArray(raw.monitors)) raw.monitors = [];
			(raw.monitors as any[]).push(serialize(body));

			const v = validateConfig(raw);
			if (v) return ctx.json({ error: "Configuration validation failed", details: v }, 400);

			await writeAndReload(raw, getServer);
			Logger.audit("Admin API: Monitor created", { monitorId: body.id });
			return ctx.json({ success: true, message: `Monitor '${body.id}' created`, id: body.id }, 201);
		} catch (e: any) {
			Logger.error("Admin API: Failed to create monitor", { error: e.message });
			return ctx.json({ error: e.message }, 500);
		}
	});

	app.put("/v1/admin/monitors/:id", adminBearerAuth(), async (ctx) => {
		const id = ctx.params["id"]!;
		if (!cache.getMonitor(id)) return ctx.json({ error: "Monitor not found" }, 404);

		let body: any;
		try {
			body = await ctx.req.json();
		} catch (e: any) {
			return ctx.json({ error: e.message }, 400);
		}

		const errors = validate(body, true);
		if (errors.length) return ctx.json({ error: "Validation failed", details: errors }, 400);

		if (body.token) {
			const existing = cache.getMonitorByToken(body.token);
			if (existing && existing.id !== id) return ctx.json({ error: "A monitor with this token already exists" }, 409);
		}

		try {
			const raw = await readRawConfig();
			const monitors = raw.monitors as any[];
			const idx = monitors.findIndex((m: any) => m.id === id);
			if (idx === -1) return ctx.json({ error: "Monitor not found in config file" }, 404);

			for (const [k, v] of Object.entries(body)) {
				if (k === "id") continue;
				if (v === null) delete monitors[idx]![k];
				else monitors[idx]![k] = v;
			}

			const ve = validateConfig(raw);
			if (ve) return ctx.json({ error: "Configuration validation failed", details: ve }, 400);

			await writeAndReload(raw, getServer);
			Logger.audit("Admin API: Monitor updated", { monitorId: id });
			return ctx.json({ success: true, message: `Monitor '${id}' updated` });
		} catch (e: any) {
			Logger.error("Admin API: Failed to update monitor", { error: e.message });
			return ctx.json({ error: e.message }, 500);
		}
	});

	app.delete("/v1/admin/monitors/:id", adminBearerAuth(), async (ctx) => {
		const id = ctx.params["id"]!;
		if (!cache.getMonitor(id)) return ctx.json({ error: "Monitor not found" }, 404);

		try {
			const raw = await readRawConfig();
			const monitors = raw.monitors as any[];
			const idx = monitors.findIndex((m: any) => m.id === id);
			if (idx === -1) return ctx.json({ error: "Monitor not found in config file" }, 404);
			monitors.splice(idx, 1);

			// Clean up references in status pages
			if (Array.isArray(raw.status_pages)) {
				for (const p of raw.status_pages as any[]) {
					if (Array.isArray(p.items)) p.items = p.items.filter((i: string) => i !== id);
				}
			}

			const v = validateConfig(raw);
			if (v) return ctx.json({ error: "Configuration validation failed", details: v }, 400);

			await writeAndReload(raw, getServer);
			Logger.audit("Admin API: Monitor deleted", { monitorId: id });
			return ctx.json({ success: true, message: `Monitor '${id}' deleted` });
		} catch (e: any) {
			Logger.error("Admin API: Failed to delete monitor", { error: e.message });
			return ctx.json({ error: e.message }, 500);
		}
	});
}

function validate(input: any, isUpdate: boolean): string[] {
	const e: string[] = [];

	if (!isUpdate) {
		if (!isValidId(input.id)) e.push("id is required (alphanumeric, hyphens, underscores)");
		if (!input.name || typeof input.name !== "string" || !input.name.trim()) e.push("name is required");
		if (!input.token || typeof input.token !== "string" || !input.token.trim()) e.push("token is required");
		if (typeof input.interval !== "number" || input.interval <= 0) e.push("interval must be a positive number");
		if (typeof input.maxRetries !== "number" || input.maxRetries < 0) e.push("maxRetries must be a non-negative number");
		if (typeof input.resendNotification !== "number" || input.resendNotification < 0) e.push("resendNotification must be a non-negative number");
	} else {
		if (input.id !== undefined) e.push("id cannot be changed");
		if (input.name !== undefined && (typeof input.name !== "string" || !input.name.trim())) e.push("name must be a non-empty string");
		if (input.token !== undefined && (typeof input.token !== "string" || !input.token.trim())) e.push("token must be a non-empty string");
		if (input.interval !== undefined && (typeof input.interval !== "number" || input.interval <= 0)) e.push("interval must be a positive number");
		if (input.maxRetries !== undefined && (typeof input.maxRetries !== "number" || input.maxRetries < 0)) e.push("maxRetries must be a non-negative number");
		if (input.resendNotification !== undefined && (typeof input.resendNotification !== "number" || input.resendNotification < 0))
			e.push("resendNotification must be a non-negative number");
	}

	if (input.groupId !== undefined && input.groupId !== null && (typeof input.groupId !== "string" || !input.groupId.trim()))
		e.push("groupId must be a non-empty string if provided");
	if (input.notificationChannels !== undefined && !Array.isArray(input.notificationChannels)) e.push("notificationChannels must be an array");
	if (input.dependencies !== undefined && !Array.isArray(input.dependencies)) e.push("dependencies must be an array");
	if (input.pulseMonitors !== undefined && !Array.isArray(input.pulseMonitors)) e.push("pulseMonitors must be an array");

	for (const key of ["custom1", "custom2", "custom3"] as const) {
		const v = input[key];
		if (v !== undefined && v !== null) {
			if (typeof v !== "object" || Array.isArray(v)) {
				e.push(`${key} must be an object with id and name`);
			} else {
				if (!v.id || typeof v.id !== "string") e.push(`${key}.id must be a non-empty string`);
				if (!v.name || typeof v.name !== "string") e.push(`${key}.name must be a non-empty string`);
				if (v.unit !== undefined && typeof v.unit !== "string") e.push(`${key}.unit must be a string`);
			}
		}
	}

	if (input.pulse !== undefined && input.pulse !== null && (typeof input.pulse !== "object" || Array.isArray(input.pulse))) {
		e.push("pulse must be an object");
	}

	return e;
}

function serialize(input: any): Record<string, unknown> {
	const r: Record<string, unknown> = {
		id: input.id,
		name: input.name,
		token: input.token,
		interval: input.interval,
		maxRetries: input.maxRetries,
		resendNotification: input.resendNotification,
	};
	if (input.groupId) r.groupId = input.groupId;
	if (input.notificationChannels?.length) r.notificationChannels = input.notificationChannels;
	if (input.dependencies?.length) r.dependencies = input.dependencies;
	if (input.pulseMonitors?.length) r.pulseMonitors = input.pulseMonitors;
	if (input.custom1) r.custom1 = input.custom1;
	if (input.custom2) r.custom2 = input.custom2;
	if (input.custom3) r.custom3 = input.custom3;
	if (input.pulse) r.pulse = input.pulse;
	return r;
}

function toResponse(m: any) {
	return {
		id: m.id,
		name: m.name,
		token: m.token,
		interval: m.interval,
		maxRetries: m.maxRetries,
		resendNotification: m.resendNotification,
		groupId: m.groupId,
		notificationChannels: m.notificationChannels || [],
		dependencies: m.dependencies || [],
		pulseMonitors: m.pulseMonitors || [],
		custom1: m.custom1,
		custom2: m.custom2,
		custom3: m.custom3,
		pulse: m.pulse,
	};
}
