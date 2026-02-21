import type { Web } from "@rabbit-company/web";
import { cache } from "../cache";
import {
	getMonitorHistoryRaw,
	getMonitorHistoryHourly,
	getMonitorHistoryDaily,
	getGroupHistoryRaw,
	getGroupHistoryHourly,
	getGroupHistoryDaily,
} from "../clickhouse";
import { adminBearerAuth } from "./helpers";
import { parseFormat, monitorDataToCsv, groupDataToCsv } from "../routes/helpers";

export function registerAdminReportRoutes(app: Web): void {
	/**
	 * GET /v1/admin/monitors/:id/reports
	 * Export raw monitor data as CSV or JSON
	 */
	app.get("/v1/admin/monitors/:id/reports", adminBearerAuth(), async (ctx) => {
		const monitorId = ctx.params["id"]!;
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
			{
				"Content-Disposition": `attachment; filename="${monitorId}-raw.json"`,
			},
		);
	});

	/**
	 * GET /v1/admin/monitors/:id/reports/hourly
	 * Export hourly aggregated monitor data as CSV or JSON
	 */
	app.get("/v1/admin/monitors/:id/reports/hourly", adminBearerAuth(), async (ctx) => {
		const monitorId = ctx.params["id"]!;
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
	});

	/**
	 * GET /v1/admin/monitors/:id/reports/daily
	 * Export daily aggregated monitor data as CSV or JSON
	 */
	app.get("/v1/admin/monitors/:id/reports/daily", adminBearerAuth(), async (ctx) => {
		const monitorId = ctx.params["id"]!;
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
	});

	/**
	 * GET /v1/admin/groups/:id/reports
	 * Export raw group data as CSV or JSON
	 */
	app.get("/v1/admin/groups/:id/reports", adminBearerAuth(), async (ctx) => {
		const groupId = ctx.params["id"]!;
		const group = cache.getGroup(groupId);
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
	});

	/**
	 * GET /v1/admin/groups/:id/reports/hourly
	 * Export hourly aggregated group data as CSV or JSON
	 */
	app.get("/v1/admin/groups/:id/reports/hourly", adminBearerAuth(), async (ctx) => {
		const groupId = ctx.params["id"]!;
		const group = cache.getGroup(groupId);
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
	});

	/**
	 * GET /v1/admin/groups/:id/reports/daily
	 * Export daily aggregated group data as CSV or JSON
	 */
	app.get("/v1/admin/groups/:id/reports/daily", adminBearerAuth(), async (ctx) => {
		const groupId = ctx.params["id"]!;
		const group = cache.getGroup(groupId);
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
	});
}
