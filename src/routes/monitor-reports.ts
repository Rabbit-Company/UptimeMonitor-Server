import type { Web } from "@rabbit-company/web";
import { cache } from "../cache";
import type { StatusPage } from "../types";
import { getMonitorHistoryRaw, getMonitorHistoryHourly, getMonitorHistoryDaily } from "../clickhouse";
import { cache as webCache } from "@rabbit-company/web-middleware/cache";
import { monitorDataToCsv, parseFormat, statusPageBearerAuth, statusPageShouldCache } from "./helpers";

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

export function registerMonitorReportRoutes(app: Web): void {
	/**
	 * GET /v1/status/:slug/monitors/:id/reports
	 * Export raw monitor data as CSV or JSON
	 */
	app.get(
		"/v1/status/:slug/monitors/:id/reports",
		reportsEnabled(),
		statusPageBearerAuth(),
		webCache({ ttl: 30, generateETags: false, shouldCache: statusPageShouldCache }),
		async (ctx) => {
			const slug = ctx.params["slug"]!;
			const monitorId = ctx.params["id"]!;

			const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
			if (!statusPage) return ctx.json({ error: "Status page not found" }, 404);

			if (!cache.isItemOnStatusPage(slug, monitorId)) return ctx.json({ error: "Monitor not found" }, 404);

			const monitor = cache.getMonitor(monitorId);
			if (!monitor) return ctx.json({ error: "Monitor not found" }, 404);

			const data = await getMonitorHistoryRaw(monitorId);
			const format = parseFormat(new URL(ctx.req.url).searchParams.get("format") ?? undefined);

			if (format === "csv") {
				const csv = monitorDataToCsv(data as Record<string, any>[], monitor.custom1, monitor.custom2, monitor.custom3);
				return ctx.text(csv, 200, {
					"Content-Type": "text/csv; charset=utf-8",
					"Content-Disposition": `attachment; filename="${monitorId}-raw.csv"`,
				});
			}

			const customMetrics: Record<string, any> = {};
			if (monitor.custom1) customMetrics.custom1 = monitor.custom1;
			if (monitor.custom2) customMetrics.custom2 = monitor.custom2;
			if (monitor.custom3) customMetrics.custom3 = monitor.custom3;

			return ctx.json(
				{
					monitorId,
					type: "raw",
					data,
					...(Object.keys(customMetrics).length > 0 && { customMetrics }),
				},
				200,
				{ "Content-Disposition": `attachment; filename="${monitorId}-raw.json"` },
			);
		},
	);

	/**
	 * GET /v1/status/:slug/monitors/:id/reports/hourly
	 * Export hourly aggregated monitor data as CSV or JSON
	 */
	app.get(
		"/v1/status/:slug/monitors/:id/reports/hourly",
		reportsEnabled(),
		statusPageBearerAuth(),
		webCache({ ttl: 300, generateETags: false, shouldCache: statusPageShouldCache }),
		async (ctx) => {
			const slug = ctx.params["slug"]!;
			const monitorId = ctx.params["id"]!;

			const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
			if (!statusPage) return ctx.json({ error: "Status page not found" }, 404);

			if (!cache.isItemOnStatusPage(slug, monitorId)) return ctx.json({ error: "Monitor not found" }, 404);

			const monitor = cache.getMonitor(monitorId);
			if (!monitor) return ctx.json({ error: "Monitor not found" }, 404);

			const data = await getMonitorHistoryHourly(monitorId);
			const format = parseFormat(new URL(ctx.req.url).searchParams.get("format") ?? undefined);

			if (format === "csv") {
				const csv = monitorDataToCsv(data as Record<string, any>[], monitor.custom1, monitor.custom2, monitor.custom3);
				return ctx.text(csv, 200, {
					"Content-Type": "text/csv; charset=utf-8",
					"Content-Disposition": `attachment; filename="${monitorId}-hourly.csv"`,
				});
			}

			const customMetrics: Record<string, any> = {};
			if (monitor.custom1) customMetrics.custom1 = monitor.custom1;
			if (monitor.custom2) customMetrics.custom2 = monitor.custom2;
			if (monitor.custom3) customMetrics.custom3 = monitor.custom3;

			return ctx.json(
				{
					monitorId,
					type: "hourly",
					data,
					...(Object.keys(customMetrics).length > 0 && { customMetrics }),
				},
				200,
				{ "Content-Disposition": `attachment; filename="${monitorId}-hourly.json"` },
			);
		},
	);

	/**
	 * GET /v1/status/:slug/monitors/:id/reports/daily
	 * Export daily aggregated monitor data as CSV or JSON
	 */
	app.get(
		"/v1/status/:slug/monitors/:id/reports/daily",
		reportsEnabled(),
		statusPageBearerAuth(),
		webCache({ ttl: 900, generateETags: false, shouldCache: statusPageShouldCache }),
		async (ctx) => {
			const slug = ctx.params["slug"]!;
			const monitorId = ctx.params["id"]!;

			const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
			if (!statusPage) return ctx.json({ error: "Status page not found" }, 404);

			if (!cache.isItemOnStatusPage(slug, monitorId)) return ctx.json({ error: "Monitor not found" }, 404);

			const monitor = cache.getMonitor(monitorId);
			if (!monitor) return ctx.json({ error: "Monitor not found" }, 404);

			const data = await getMonitorHistoryDaily(monitorId);
			const format = parseFormat(new URL(ctx.req.url).searchParams.get("format") ?? undefined);

			if (format === "csv") {
				const csv = monitorDataToCsv(data as Record<string, any>[], monitor.custom1, monitor.custom2, monitor.custom3);
				return ctx.text(csv, 200, {
					"Content-Type": "text/csv; charset=utf-8",
					"Content-Disposition": `attachment; filename="${monitorId}-daily.csv"`,
				});
			}

			const customMetrics: Record<string, any> = {};
			if (monitor.custom1) customMetrics.custom1 = monitor.custom1;
			if (monitor.custom2) customMetrics.custom2 = monitor.custom2;
			if (monitor.custom3) customMetrics.custom3 = monitor.custom3;

			return ctx.json(
				{
					monitorId,
					type: "daily",
					data,
					...(Object.keys(customMetrics).length > 0 && { customMetrics }),
				},
				200,
				{ "Content-Disposition": `attachment; filename="${monitorId}-daily.json"` },
			);
		},
	);
}
