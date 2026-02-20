import type { Web } from "@rabbit-company/web";
import { cache } from "../cache";
import type { StatusPage, Group } from "../types";
import { getGroupHistoryRaw, getGroupHistoryHourly, getGroupHistoryDaily } from "../clickhouse";
import { cache as webCache } from "@rabbit-company/web-middleware/cache";
import { statusPageBearerAuth, statusPageShouldCache } from "./helpers";

export function registerGroupHistoryRoutes(app: Web): void {
	/**
	 * GET /v1/status/:slug/groups/:id/history
	 * Returns raw history for a group (~24h due to TTL)
	 * Requires the group to be on the specified status page.
	 */
	app.get(
		"/v1/status/:slug/groups/:id/history",
		statusPageBearerAuth(),
		webCache({ ttl: 30, generateETags: false, shouldCache: statusPageShouldCache }),
		async (ctx) => {
			const slug = ctx.params["slug"]!;
			const groupId = ctx.params["id"]!;

			const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
			if (!statusPage) return ctx.json({ error: "Status page not found" }, 404);

			if (!cache.isItemOnStatusPage(slug, groupId)) return ctx.json({ error: "Group not found" }, 404);

			const group: Group | undefined = cache.getGroup(groupId);
			if (!group) return ctx.json({ error: "Group not found" }, 404);

			const data = await getGroupHistoryRaw(groupId);

			return ctx.json({
				groupId,
				type: "raw",
				strategy: group.strategy,
				data,
			});
		},
	);

	/**
	 * GET /v1/status/:slug/groups/:id/history/hourly
	 * Returns hourly history for a group (~90 days due to TTL)
	 */
	app.get(
		"/v1/status/:slug/groups/:id/history/hourly",
		statusPageBearerAuth(),
		webCache({ ttl: 300, generateETags: false, shouldCache: statusPageShouldCache }),
		async (ctx) => {
			const slug = ctx.params["slug"]!;
			const groupId = ctx.params["id"]!;

			const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
			if (!statusPage) return ctx.json({ error: "Status page not found" }, 404);

			if (!cache.isItemOnStatusPage(slug, groupId)) return ctx.json({ error: "Group not found" }, 404);

			const group: Group | undefined = cache.getGroup(groupId);
			if (!group) return ctx.json({ error: "Group not found" }, 404);

			const data = await getGroupHistoryHourly(groupId);

			return ctx.json({
				groupId,
				type: "hourly",
				strategy: group.strategy,
				data,
			});
		},
	);

	/**
	 * GET /v1/status/:slug/groups/:id/history/daily
	 * Returns daily history for a group (all time)
	 */
	app.get(
		"/v1/status/:slug/groups/:id/history/daily",
		statusPageBearerAuth(),
		webCache({ ttl: 900, generateETags: false, shouldCache: statusPageShouldCache }),
		async (ctx) => {
			const slug = ctx.params["slug"]!;
			const groupId = ctx.params["id"]!;

			const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
			if (!statusPage) return ctx.json({ error: "Status page not found" }, 404);

			if (!cache.isItemOnStatusPage(slug, groupId)) return ctx.json({ error: "Group not found" }, 404);

			const group: Group | undefined = cache.getGroup(groupId);
			if (!group) return ctx.json({ error: "Group not found" }, 404);

			const data = await getGroupHistoryDaily(groupId);

			return ctx.json({
				groupId,
				type: "daily",
				strategy: group.strategy,
				data,
			});
		},
	);
}
