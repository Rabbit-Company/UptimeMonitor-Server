import type { Server, Web } from "@rabbit-company/web";
import { adminBearerAuth, readRawConfig, validateConfig, writeAndReload } from "./helpers";
import { Logger } from "../logger";
import TOML from "smol-toml";

export function registerConfigRoutes(app: Web, getServer: () => Server): void {
	app.get("/v1/admin/config", adminBearerAuth(), async (ctx) => {
		const query = ctx.query();
		const raw = await readRawConfig();

		if (query.get("format") === "toml") {
			return ctx.text(TOML.stringify(raw), 200, { "Content-Type": "application/toml; charset=utf-8" });
		}

		return ctx.json(raw);
	});

	app.post("/v1/admin/config", adminBearerAuth(), async (ctx) => {
		const format = ctx.query().get("format")?.toLowerCase();

		let raw: any;

		try {
			if (format === "toml") {
				const text = await ctx.req.text();
				raw = Bun.TOML.parse(text);
			} else {
				raw = await ctx.req.json();
			}
		} catch (e: any) {
			return ctx.json({ error: "Invalid request body", details: e?.message }, 400);
		}

		const validationErrors = validateConfig(raw);
		if (validationErrors) {
			return ctx.json({ error: "Configuration validation failed", details: validationErrors }, 400);
		}

		try {
			await writeAndReload(raw, getServer);
			Logger.audit("Admin API: Config updated");

			return ctx.json({ success: true });
		} catch (e: any) {
			Logger.error("Admin API: Failed to update config", { error: e?.message });
			return ctx.json({ error: e?.message }, 500);
		}
	});
}
