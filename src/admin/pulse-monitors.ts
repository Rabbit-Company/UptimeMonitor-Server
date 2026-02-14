import type { Web, Server } from "@rabbit-company/web";
import { cache } from "../cache";
import { Logger } from "../logger";
import { readRawConfig, validateConfig, writeAndReload, isValidId, adminBearerAuth } from "./helpers";

export function registerPulseMonitorRoutes(app: Web, getServer: () => Server): void {
	app.get("/v1/admin/pulse-monitors", adminBearerAuth(), (ctx) => {
		return ctx.json({
			pulseMonitors: cache.getAllPulseMonitors().map((pm) => ({ id: pm.id, name: pm.name, token: pm.token })),
		});
	});

	app.get("/v1/admin/pulse-monitors/:id", adminBearerAuth(), (ctx) => {
		const pm = cache.getPulseMonitor(ctx.params["id"]!);
		if (!pm) return ctx.json({ error: "PulseMonitor not found" }, 404);
		return ctx.json({ id: pm.id, name: pm.name, token: pm.token });
	});

	app.post("/v1/admin/pulse-monitors", adminBearerAuth(), async (ctx) => {
		let body: any;
		try {
			body = await ctx.req.json();
		} catch (e: any) {
			return ctx.json({ error: e.message }, 400);
		}

		const errors = validate(body, false);
		if (errors.length) return ctx.json({ error: "Validation failed", details: errors }, 400);
		if (cache.getPulseMonitor(body.id)) return ctx.json({ error: `PulseMonitor '${body.id}' already exists` }, 409);
		if (cache.getPulseMonitorByToken(body.token)) return ctx.json({ error: "A PulseMonitor with this token already exists" }, 409);

		try {
			const raw = await readRawConfig();
			if (!Array.isArray(raw.PulseMonitors)) raw.PulseMonitors = [];
			(raw.PulseMonitors as any[]).push({ id: body.id, name: body.name, token: body.token });

			const v = validateConfig(raw);
			if (v) return ctx.json({ error: "Configuration validation failed", details: v }, 400);

			await writeAndReload(raw, getServer);
			Logger.audit("Admin API: PulseMonitor created", { pulseMonitorId: body.id });
			return ctx.json({ success: true, message: `PulseMonitor '${body.id}' created`, id: body.id }, 201);
		} catch (e: any) {
			Logger.error("Admin API: Failed to create PulseMonitor", { error: e.message });
			return ctx.json({ error: e.message }, 500);
		}
	});

	app.put("/v1/admin/pulse-monitors/:id", adminBearerAuth(), async (ctx) => {
		const id = ctx.params["id"]!;
		if (!cache.getPulseMonitor(id)) return ctx.json({ error: "PulseMonitor not found" }, 404);

		let body: any;
		try {
			body = await ctx.req.json();
		} catch (e: any) {
			return ctx.json({ error: e.message }, 400);
		}

		const errors = validate(body, true);
		if (errors.length) return ctx.json({ error: "Validation failed", details: errors }, 400);

		if (body.token) {
			const existing = cache.getPulseMonitorByToken(body.token);
			if (existing && existing.id !== id) return ctx.json({ error: "A PulseMonitor with this token already exists" }, 409);
		}

		try {
			const raw = await readRawConfig();
			const pms = raw.PulseMonitors as any[];
			const idx = pms.findIndex((pm: any) => pm.id === id);
			if (idx === -1) return ctx.json({ error: "PulseMonitor not found in config file" }, 404);

			for (const [k, v] of Object.entries(body)) {
				if (k === "id") continue;
				if (v === null) delete pms[idx]![k];
				else pms[idx]![k] = v;
			}

			const v = validateConfig(raw);
			if (v) return ctx.json({ error: "Configuration validation failed", details: v }, 400);

			await writeAndReload(raw, getServer);
			Logger.audit("Admin API: PulseMonitor updated", { pulseMonitorId: id });
			return ctx.json({ success: true, message: `PulseMonitor '${id}' updated` });
		} catch (e: any) {
			Logger.error("Admin API: Failed to update PulseMonitor", { error: e.message });
			return ctx.json({ error: e.message }, 500);
		}
	});

	app.delete("/v1/admin/pulse-monitors/:id", adminBearerAuth(), async (ctx) => {
		const id = ctx.params["id"]!;
		if (!cache.getPulseMonitor(id)) return ctx.json({ error: "PulseMonitor not found" }, 404);

		try {
			const raw = await readRawConfig();
			const pms = raw.PulseMonitors as any[];
			const idx = pms.findIndex((pm: any) => pm.id === id);
			if (idx === -1) return ctx.json({ error: "PulseMonitor not found in config file" }, 404);
			pms.splice(idx, 1);

			// Clean up references in monitors
			if (Array.isArray(raw.monitors)) {
				for (const m of raw.monitors as any[]) {
					if (Array.isArray(m.pulseMonitors)) {
						m.pulseMonitors = m.pulseMonitors.filter((p: string) => p !== id);
					}
				}
			}

			const v = validateConfig(raw);
			if (v) return ctx.json({ error: "Configuration validation failed", details: v }, 400);

			await writeAndReload(raw, getServer);
			Logger.audit("Admin API: PulseMonitor deleted", { pulseMonitorId: id });
			return ctx.json({ success: true, message: `PulseMonitor '${id}' deleted` });
		} catch (e: any) {
			Logger.error("Admin API: Failed to delete PulseMonitor", { error: e.message });
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
	} else {
		if (input.id !== undefined) e.push("id cannot be changed");
		if (input.name !== undefined && (typeof input.name !== "string" || !input.name.trim())) e.push("name must be a non-empty string");
		if (input.token !== undefined && (typeof input.token !== "string" || !input.token.trim())) e.push("token must be a non-empty string");
	}

	return e;
}
