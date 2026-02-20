import type { Web, Server } from "@rabbit-company/web";
import { cache } from "../cache";
import { Logger } from "../logger";
import { readRawConfig, validateConfig, writeAndReload, isValidId, adminBearerAuth } from "./helpers";

export function registerStatusPageRoutes(app: Web, getServer: () => Server): void {
	app.get("/v1/admin/status-pages", adminBearerAuth(), (ctx) => {
		return ctx.json({ statusPages: cache.getAllStatusPages().map(toResponse) });
	});

	app.get("/v1/admin/status-pages/:id", adminBearerAuth(), (ctx) => {
		const p = cache.getStatusPage(ctx.params["id"]!);
		if (!p) return ctx.json({ error: "Status page not found" }, 404);
		return ctx.json(toResponse(p));
	});

	app.post("/v1/admin/status-pages", adminBearerAuth(), async (ctx) => {
		let body: any;
		try {
			body = await ctx.req.json();
		} catch (e: any) {
			return ctx.json({ error: e.message }, 400);
		}

		const errors = validate(body, false);
		if (errors.length) return ctx.json({ error: "Validation failed", details: errors }, 400);
		if (cache.getStatusPage(body.id)) return ctx.json({ error: `Status page '${body.id}' already exists` }, 409);
		if (cache.getStatusPageBySlug(body.slug)) return ctx.json({ error: `Slug '${body.slug}' already in use` }, 409);

		try {
			const raw = await readRawConfig();
			if (!Array.isArray(raw.status_pages)) raw.status_pages = [];
			(raw.status_pages as any[]).push(serialize(body));

			const v = validateConfig(raw);
			if (v) return ctx.json({ error: "Configuration validation failed", details: v }, 400);

			await writeAndReload(raw, getServer);
			Logger.audit("Admin API: Status page created", { statusPageId: body.id });
			return ctx.json({ success: true, message: `Status page '${body.id}' created`, id: body.id }, 201);
		} catch (e: any) {
			Logger.error("Admin API: Failed to create status page", { error: e.message });
			return ctx.json({ error: e.message }, 500);
		}
	});

	app.put("/v1/admin/status-pages/:id", adminBearerAuth(), async (ctx) => {
		const id = ctx.params["id"]!;
		if (!cache.getStatusPage(id)) return ctx.json({ error: "Status page not found" }, 404);

		let body: any;
		try {
			body = await ctx.req.json();
		} catch (e: any) {
			return ctx.json({ error: e.message }, 400);
		}

		const errors = validate(body, true);
		if (errors.length) return ctx.json({ error: "Validation failed", details: errors }, 400);

		if (body.slug) {
			const existing = cache.getStatusPageBySlug(body.slug);
			if (existing && existing.id !== id) return ctx.json({ error: `Slug '${body.slug}' already in use` }, 409);
		}

		try {
			const raw = await readRawConfig();
			const pages = raw.status_pages as any[];
			const idx = pages.findIndex((p: any) => p.id === id);
			if (idx === -1) return ctx.json({ error: "Status page not found in config file" }, 404);

			for (const [k, v] of Object.entries(body)) {
				if (k === "id") continue;
				if (v === null) delete pages[idx]![k];
				else pages[idx]![k] = v;
			}

			const v = validateConfig(raw);
			if (v) return ctx.json({ error: "Configuration validation failed", details: v }, 400);

			await writeAndReload(raw, getServer);
			Logger.audit("Admin API: Status page updated", { statusPageId: id });
			return ctx.json({ success: true, message: `Status page '${id}' updated` });
		} catch (e: any) {
			Logger.error("Admin API: Failed to update status page", { error: e.message });
			return ctx.json({ error: e.message }, 500);
		}
	});

	app.delete("/v1/admin/status-pages/:id", adminBearerAuth(), async (ctx) => {
		const id = ctx.params["id"]!;
		if (!cache.getStatusPage(id)) return ctx.json({ error: "Status page not found" }, 404);

		try {
			const raw = await readRawConfig();
			const pages = raw.status_pages as any[];

			const idx = pages.findIndex((p: any) => p.id === id);
			if (idx === -1) return ctx.json({ error: "Status page not found in config file" }, 404);
			pages.splice(idx, 1);

			const v = validateConfig(raw);
			if (v) return ctx.json({ error: "Configuration validation failed", details: v }, 400);

			await writeAndReload(raw, getServer);
			Logger.audit("Admin API: Status page deleted", { statusPageId: id });
			return ctx.json({ success: true, message: `Status page '${id}' deleted` });
		} catch (e: any) {
			Logger.error("Admin API: Failed to delete status page", { error: e.message });
			return ctx.json({ error: e.message }, 500);
		}
	});
}

const SLUG_RE = /^[a-z0-9-]+$/;

function serialize(input: any): Record<string, unknown> {
	const r: Record<string, unknown> = {
		id: input.id,
		name: input.name,
		slug: input.slug,
		items: input.items,
	};
	if (input.leafItems?.length) r.leafItems = input.leafItems;
	if (input.password) r.password = input.password;
	return r;
}

function toResponse(p: any) {
	return {
		id: p.id,
		name: p.name,
		slug: p.slug,
		items: p.items,
		leafItems: p.leafItems || [],
		password: p.password,
	};
}

function validate(input: any, isUpdate: boolean): string[] {
	const e: string[] = [];

	if (!isUpdate) {
		if (!isValidId(input.id)) e.push("id is required (alphanumeric, hyphens, underscores)");
		if (!input.name || typeof input.name !== "string" || !input.name.trim()) e.push("name is required");
		if (!input.slug || typeof input.slug !== "string" || !input.slug.trim()) {
			e.push("slug is required");
		} else if (!SLUG_RE.test(input.slug)) {
			e.push("slug must contain only lowercase letters, numbers, and hyphens");
		}
		if (!Array.isArray(input.items) || input.items.length === 0) e.push("items must be a non-empty array");
	} else {
		if (input.id !== undefined) e.push("id cannot be changed");
		if (input.name !== undefined && (typeof input.name !== "string" || !input.name.trim())) e.push("name must be a non-empty string");
		if (input.slug !== undefined) {
			if (typeof input.slug !== "string" || !input.slug.trim()) e.push("slug must be a non-empty string");
			else if (!SLUG_RE.test(input.slug)) e.push("slug must contain only lowercase letters, numbers, and hyphens");
		}
		if (input.items !== undefined && (!Array.isArray(input.items) || input.items.length === 0)) e.push("items must be a non-empty array");
	}

	if (input.password !== undefined && input.password !== null) {
		if (typeof input.password !== "string" || !input.password.trim()) e.push("password must be a non-empty string if provided");
		else if (input.password.length < 8) e.push("password must be at least 8 characters");
	}

	if (input.leafItems !== undefined && input.leafItems !== null) {
		if (!Array.isArray(input.leafItems)) {
			e.push("leafItems must be an array");
		} else {
			for (const item of input.leafItems) {
				if (typeof item !== "string" || !item.trim()) {
					e.push("each leafItems entry must be a non-empty string");
					break;
				}
			}
		}
	}

	return e;
}
