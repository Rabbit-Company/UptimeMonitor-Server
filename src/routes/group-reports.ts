import type { Web } from "@rabbit-company/web";
import { cache } from "../cache";
import type { StatusPage, Group } from "../types";
import { getGroupHistoryRaw, getGroupHistoryHourly, getGroupHistoryDaily } from "../clickhouse";
import { cache as webCache } from "@rabbit-company/web-middleware/cache";
import { groupDataToCsv, parseFormat, statusPageBearerAuth, statusPageShouldCache } from "./helpers";

/**
 * Middleware to check if reports are enabled on the status page.
 * Returns 404 if reports are not enabled.
 */
function reportsEnabled() {
	return async (ctx: any, next: () => Promise<Response | void>) => {
		const slug = ctx.params["slug"]!;
		const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
		if (!statusPage) return ctx.json({ error: "Status page not found" }, 404);
		if (!statusPage.reports) return ctx.json({ error: "Reports are not enabled for this status page" }, 404);
		return next();
	};
}

export function registerGroupReportRoutes(app: Web): void {
	/**
	 * GET /v1/status/:slug/groups/:id/reports
	 * Export raw group data as CSV or JSON
	 */
	app.get(
		"/v1/status/:slug/groups/:id/reports",
		reportsEnabled(),
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
			const format = parseFormat(new URL(ctx.req.url).searchParams.get("format") ?? undefined);

			if (format === "csv") {
				const csv = groupDataToCsv(data as Record<string, any>[]);
				return ctx.text(csv, 200, {
					"Content-Type": "text/csv; charset=utf-8",
					"Content-Disposition": `attachment; filename="${groupId}-raw.csv"`,
				});
			}

			return ctx.json(
				{
					groupId,
					type: "raw",
					strategy: group.strategy,
					data,
				},
				200,
				{ "Content-Disposition": `attachment; filename="${groupId}-raw.json"` },
			);
		},
	);

	/**
	 * GET /v1/status/:slug/groups/:id/reports/hourly
	 * Export hourly aggregated group data as CSV or JSON
	 */
	app.get(
		"/v1/status/:slug/groups/:id/reports/hourly",
		reportsEnabled(),
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
			const format = parseFormat(new URL(ctx.req.url).searchParams.get("format") ?? undefined);

			if (format === "csv") {
				const csv = groupDataToCsv(data as Record<string, any>[]);
				return ctx.text(csv, 200, {
					"Content-Type": "text/csv; charset=utf-8",
					"Content-Disposition": `attachment; filename="${groupId}-hourly.csv"`,
				});
			}

			return ctx.json(
				{
					groupId,
					type: "hourly",
					strategy: group.strategy,
					data,
				},
				200,
				{ "Content-Disposition": `attachment; filename="${groupId}-hourly.json"` },
			);
		},
	);

	/**
	 * GET /v1/status/:slug/groups/:id/reports/daily
	 * Export daily aggregated group data as CSV or JSON
	 */
	app.get(
		"/v1/status/:slug/groups/:id/reports/daily",
		reportsEnabled(),
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
			const format = parseFormat(new URL(ctx.req.url).searchParams.get("format") ?? undefined);

			if (format === "csv") {
				const csv = groupDataToCsv(data as Record<string, any>[]);
				return ctx.text(csv, 200, {
					"Content-Type": "text/csv; charset=utf-8",
					"Content-Disposition": `attachment; filename="${groupId}-daily.csv"`,
				});
			}

			return ctx.json(
				{
					groupId,
					type: "daily",
					strategy: group.strategy,
					data,
				},
				200,
				{ "Content-Disposition": `attachment; filename="${groupId}-daily.json"` },
			);
		},
	);
}
