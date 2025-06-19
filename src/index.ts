import { Web } from "@rabbit-company/web";
import { Logger } from "./logger";
import { config } from "./config";
import type { Monitor, StatusData, StatusPage } from "./types";
import { getMonitorHistory, initClickHouse, statusCache, storePulse, updateMonitorStatus } from "./clickhouse";
import { buildStatusTree } from "./statuspage";
import { logger } from "@rabbit-company/web-middleware/logger";
import { missingPulseDetector } from "./missing-pulse-detector";

await initClickHouse();

// Initialize all monitors and groups status
for (const monitor of config.monitors) {
	await updateMonitorStatus(monitor.id);
}

missingPulseDetector.start();

const app = new Web();

app.use(logger({ logger: Logger, preset: "minimal", logResponses: false }));

app.get("/health", (ctx) => {
	return ctx.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/v1/health/missing-pulse-detector", (ctx) => {
	const status = missingPulseDetector.getStatus();
	return ctx.json(status);
});

app.get("/v1/push/:token", async (ctx) => {
	const token = ctx.params["token"];
	const query = ctx.query();

	const status = query.get("status");
	const latency = parseFloat(query.get("latency") || "");

	const monitor: Monitor | undefined = config.monitors.find((m: Monitor) => m.token === token);
	if (!monitor) {
		return ctx.json({ error: "Invalid token" }, 401);
	}

	if (!status || !["up", "down"].includes(status)) {
		return ctx.json({ error: "Invalid status" }, 401);
	}

	if (!latency || isNaN(latency) || latency <= 0) {
		return ctx.json({ error: "Invalid latency" }, 401);
	}

	await storePulse(monitor.id, status as "up" | "down", latency);

	return ctx.json({ success: true, monitorId: monitor.id });
});

app.get("/v1/status/:slug", async (ctx) => {
	const slug: string = ctx.params["slug"] || "";

	const statusPage: StatusPage | undefined = config.statusPages.find((sp: StatusPage) => sp.slug === slug);
	if (!statusPage) {
		return ctx.json({ error: "Status page not found" }, 404);
	}

	const statusData: StatusData[] = buildStatusTree(statusPage.items);

	return ctx.json({
		name: statusPage.name,
		slug: statusPage.slug,
		items: statusData,
		lastUpdated: new Date(),
	});
});

app.get("/v1/status/:slug/summary", async (ctx) => {
	const slug: string = ctx.params["slug"] || "";

	const statusPage: StatusPage | undefined = config.statusPages.find((sp: StatusPage) => sp.slug === slug);
	if (!statusPage) {
		return ctx.json({ error: "Status page not found" }, 404);
	}

	let totalUp = 0;
	let totalDegraded = 0;
	let totalDown = 0;

	const countStatus = (items: string[]): void => {
		for (const id of items) {
			const status = statusCache.get(id);
			if (!status) continue;

			if (status.type === "monitor") {
				if (status.status === "up") totalUp++;
				else if (status.status === "down") totalDown++;
			} else if (status.type === "group") {
				if (status.status === "up") totalUp++;
				else if (status.status === "degraded") totalDegraded++;
				else if (status.status === "down") totalDown++;
			}
		}
	};

	countStatus(statusPage.items);

	const overallStatus: "up" | "down" | "degraded" = totalDown > 0 ? "down" : totalDegraded > 0 ? "degraded" : "up";

	return ctx.json({
		status: overallStatus,
		monitors: {
			up: totalUp,
			degraded: totalDegraded,
			down: totalDown,
			total: totalUp + totalDegraded + totalDown,
		},
	});
});

app.get("/v1/monitors/:id/history", async (ctx) => {
	const monitorId: string = ctx.params["id"] || "";
	const period: string = ctx.query().get("period") || "24h";

	const monitor: Monitor | undefined = config.monitors.find((m: Monitor) => m.id === monitorId);
	if (!monitor) {
		return ctx.json({ error: "Monitor not found" }, 404);
	}

	if (!["1h", "24h", "7d", "30d", "90d", "365d"].includes(period)) {
		return ctx.json({ error: "Invalid period" }, 401);
	}
	let data;

	try {
		data = await getMonitorHistory(monitorId, period);
	} catch (err: any) {
		Logger.error("Retrieval of monitor history failed", { monitorId: monitorId, period: period, "error.message": err?.message });
	}

	return ctx.json({
		monitorId,
		period,
		data,
	});
});

app.listen({ hostname: "0.0.0.0", port: config.server?.port || 3000 });

Logger.info(`Server running on port ${config.server?.port || 3000}`);

// Graceful shutdown
process.on("SIGTERM", () => {
	Logger.info("Received SIGTERM, shutting down gracefully");
	missingPulseDetector.stop();
	process.exit(0);
});

process.on("SIGINT", () => {
	Logger.info("Received SIGINT, shutting down gracefully");
	missingPulseDetector.stop();
	process.exit(0);
});
