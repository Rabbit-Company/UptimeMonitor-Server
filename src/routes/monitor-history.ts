import type { Web } from "@rabbit-company/web";
import { cache } from "../cache";
import type { StatusPage } from "../types";
import { getMonitorHistoryRaw, getMonitorHistoryHourly, getMonitorHistoryDaily } from "../clickhouse";
import { cache as webCache } from "@rabbit-company/web-middleware/cache";
import { statusPageBearerAuth, statusPageShouldCache } from "./helpers";

export function registerMonitorHistoryRoutes(app: Web): void {
	/**
	 * GET /v1/status/:slug/monitors/:id/history
	 * Returns all raw pulses (~24h due to TTL)
	 * Requires the monitor to be on the specified status page.
	 */
	app.get(
		"/v1/status/:slug/monitors/:id/history",
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

			const customMetrics: Record<string, any> = {};
			if (monitor.custom1) customMetrics.custom1 = monitor.custom1;
			if (monitor.custom2) customMetrics.custom2 = monitor.custom2;
			if (monitor.custom3) customMetrics.custom3 = monitor.custom3;

			return ctx.json({
				monitorId,
				type: "raw",
				data,
				...(Object.keys(customMetrics).length > 0 && { customMetrics }),
			});
		},
	);

	/**
	 * GET /v1/status/:slug/monitors/:id/history/hourly
	 * Returns hourly aggregated data (~90 days due to TTL)
	 */
	app.get(
		"/v1/status/:slug/monitors/:id/history/hourly",
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

			const customMetrics: Record<string, any> = {};
			if (monitor.custom1) customMetrics.custom1 = monitor.custom1;
			if (monitor.custom2) customMetrics.custom2 = monitor.custom2;
			if (monitor.custom3) customMetrics.custom3 = monitor.custom3;

			return ctx.json({
				monitorId,
				type: "hourly",
				data,
				...(Object.keys(customMetrics).length > 0 && { customMetrics }),
			});
		},
	);

	/**
	 * GET /v1/status/:slug/monitors/:id/history/daily
	 * Returns daily aggregated data (all time)
	 */
	app.get(
		"/v1/status/:slug/monitors/:id/history/daily",
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

			const customMetrics: Record<string, any> = {};
			if (monitor.custom1) customMetrics.custom1 = monitor.custom1;
			if (monitor.custom2) customMetrics.custom2 = monitor.custom2;
			if (monitor.custom3) customMetrics.custom3 = monitor.custom3;

			return ctx.json({
				monitorId,
				type: "daily",
				data,
				...(Object.keys(customMetrics).length > 0 && { customMetrics }),
			});
		},
	);
}
