import type { Web, Server } from "@rabbit-company/web";
import { cache } from "../cache";
import { Logger } from "../logger";
import { readRawConfig, validateConfig, writeAndReload, isValidId, adminBearerAuth } from "./helpers";

export function registerGroupRoutes(app: Web, getServer: () => Server): void {
	app.get("/v1/admin/groups", adminBearerAuth(), (ctx) => {
		return ctx.json({ groups: cache.getAllGroups().map(toResponse) });
	});

	app.get("/v1/admin/groups/:id", adminBearerAuth(), (ctx) => {
		const g = cache.getGroup(ctx.params["id"]!);
		if (!g) return ctx.json({ error: "Group not found" }, 404);
		return ctx.json(toResponse(g));
	});

	app.post("/v1/admin/groups", adminBearerAuth(), async (ctx) => {
		let body: any;
		try {
			body = await ctx.req.json();
		} catch (e: any) {
			return ctx.json({ error: e.message }, 400);
		}

		const errors = validate(body, false);
		if (errors.length) return ctx.json({ error: "Validation failed", details: errors }, 400);
		if (cache.getGroup(body.id)) return ctx.json({ error: `Group '${body.id}' already exists` }, 409);
		if (cache.getMonitor(body.id)) return ctx.json({ error: `A monitor with id '${body.id}' already exists` }, 409);

		try {
			const raw = await readRawConfig();
			if (!Array.isArray(raw.groups)) raw.groups = [];
			(raw.groups as any[]).push(serialize(body));

			const v = validateConfig(raw);
			if (v) return ctx.json({ error: "Configuration validation failed", details: v }, 400);

			await writeAndReload(raw, getServer);
			Logger.audit("Admin API: Group created", { groupId: body.id });
			return ctx.json({ success: true, message: `Group '${body.id}' created`, id: body.id }, 201);
		} catch (e: any) {
			Logger.error("Admin API: Failed to create group", { error: e.message });
			return ctx.json({ error: e.message }, 500);
		}
	});

	app.put("/v1/admin/groups/:id", adminBearerAuth(), async (ctx) => {
		const id = ctx.params["id"]!;
		if (!cache.getGroup(id)) return ctx.json({ error: "Group not found" }, 404);

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
			const groups = raw.groups as any[];
			const idx = groups.findIndex((g: any) => g.id === id);
			if (idx === -1) return ctx.json({ error: "Group not found in config file" }, 404);

			for (const [k, v] of Object.entries(body)) {
				if (k === "id") continue;
				if (v === null) delete groups[idx]![k];
				else groups[idx]![k] = v;
			}

			const v = validateConfig(raw);
			if (v) return ctx.json({ error: "Configuration validation failed", details: v }, 400);

			await writeAndReload(raw, getServer);
			Logger.audit("Admin API: Group updated", { groupId: id });
			return ctx.json({ success: true, message: `Group '${id}' updated` });
		} catch (e: any) {
			Logger.error("Admin API: Failed to update group", { error: e.message });
			return ctx.json({ error: e.message }, 500);
		}
	});

	app.delete("/v1/admin/groups/:id", adminBearerAuth(), async (ctx) => {
		const id = ctx.params["id"]!;
		if (!cache.getGroup(id)) return ctx.json({ error: "Group not found" }, 404);

		try {
			const raw = await readRawConfig();
			const groups = raw.groups as any[];
			const idx = groups.findIndex((g: any) => g.id === id);
			if (idx === -1) return ctx.json({ error: "Group not found in config file" }, 404);
			groups.splice(idx, 1);

			// Clean up references
			if (Array.isArray(raw.monitors)) {
				for (const m of raw.monitors as any[]) {
					if (m.groupId === id) delete m.groupId;
				}
			}
			if (Array.isArray(raw.status_pages)) {
				for (const p of raw.status_pages as any[]) {
					if (Array.isArray(p.items)) p.items = p.items.filter((i: string) => i !== id);
				}
			}
			for (const g of groups) {
				if ((g as any).parentId === id) delete (g as any).parentId;
			}

			const v = validateConfig(raw);
			if (v) return ctx.json({ error: "Configuration validation failed", details: v }, 400);

			await writeAndReload(raw, getServer);
			Logger.audit("Admin API: Group deleted", { groupId: id });
			return ctx.json({ success: true, message: `Group '${id}' deleted` });
		} catch (e: any) {
			Logger.error("Admin API: Failed to delete group", { error: e.message });
			return ctx.json({ error: e.message }, 500);
		}
	});
}

const STRATEGIES = ["any-up", "percentage", "all-up"];

function validate(input: any, isUpdate: boolean): string[] {
	const e: string[] = [];

	if (!isUpdate) {
		if (!isValidId(input.id)) e.push("id is required (alphanumeric, hyphens, underscores)");
		if (!input.name || typeof input.name !== "string" || !input.name.trim()) e.push("name is required");
		if (!input.strategy || !STRATEGIES.includes(input.strategy)) e.push("strategy must be 'any-up', 'percentage', or 'all-up'");
		if (typeof input.degradedThreshold !== "number" || input.degradedThreshold < 0 || input.degradedThreshold > 100) e.push("degradedThreshold must be 0-100");
		if (typeof input.interval !== "number" || input.interval <= 0) e.push("interval must be a positive number");
	} else {
		if (input.id !== undefined) e.push("id cannot be changed");
		if (input.name !== undefined && (typeof input.name !== "string" || !input.name.trim())) e.push("name must be a non-empty string");
		if (input.strategy !== undefined && !STRATEGIES.includes(input.strategy)) e.push("strategy must be 'any-up', 'percentage', or 'all-up'");
		if (input.degradedThreshold !== undefined && (typeof input.degradedThreshold !== "number" || input.degradedThreshold < 0 || input.degradedThreshold > 100))
			e.push("degradedThreshold must be 0-100");
		if (input.interval !== undefined && (typeof input.interval !== "number" || input.interval <= 0)) e.push("interval must be a positive number");
	}

	if (input.resendNotification !== undefined && (typeof input.resendNotification !== "number" || input.resendNotification < 0))
		e.push("resendNotification must be a non-negative number");
	if (input.parentId !== undefined && input.parentId !== null && (typeof input.parentId !== "string" || !input.parentId.trim()))
		e.push("parentId must be a non-empty string if provided");
	if (input.notificationChannels !== undefined && !Array.isArray(input.notificationChannels)) e.push("notificationChannels must be an array");
	if (input.dependencies !== undefined && !Array.isArray(input.dependencies)) e.push("dependencies must be an array");

	return e;
}

function serialize(input: any): Record<string, unknown> {
	const r: Record<string, unknown> = {
		id: input.id,
		name: input.name,
		strategy: input.strategy,
		degradedThreshold: input.degradedThreshold,
		interval: input.interval,
		resendNotification: input.resendNotification ?? 0,
	};
	if (input.parentId) r.parentId = input.parentId;
	if (input.notificationChannels?.length) r.notificationChannels = input.notificationChannels;
	if (input.dependencies?.length) r.dependencies = input.dependencies;
	return r;
}

function toResponse(g: any) {
	return {
		id: g.id,
		name: g.name,
		strategy: g.strategy,
		degradedThreshold: g.degradedThreshold,
		interval: g.interval,
		resendNotification: g.resendNotification,
		parentId: g.parentId,
		notificationChannels: g.notificationChannels || [],
		dependencies: g.dependencies || [],
	};
}
