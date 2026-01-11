import { Web } from "@rabbit-company/web";
import { Logger } from "./logger";
import { config } from "./config";
import { cache } from "./cache";
import type { Monitor, StatusData, StatusPage } from "./types";
import { getMonitorHistoryRaw, getMonitorHistoryHourly, getMonitorHistoryDaily, initClickHouse, storePulse, updateMonitorStatus } from "./clickhouse";
import { buildStatusTree } from "./statuspage";
import { missingPulseDetector } from "./missing-pulse-detector";
import { aggregationJob } from "./aggregation";
import { logger } from "@rabbit-company/web-middleware/logger";
import { cors } from "@rabbit-company/web-middleware/cors";
import { cache as webCache } from "@rabbit-company/web-middleware/cache";
import { selfMonitor } from "./selfmonitor";

await initClickHouse();

await selfMonitor.start();

// Start aggregation job
aggregationJob.start();

// Initialize all monitors status
await Promise.all(cache.getAllMonitors().map((monitor) => updateMonitorStatus(monitor.id)));

missingPulseDetector.start();

const app = new Web();

app.use(logger({ logger: Logger, preset: "minimal", logResponses: false }));
app.use(cors());

// Health endpoints
app.get("/health", (ctx) => {
	return ctx.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/v1/health/missing-pulse-detector", (ctx) => {
	return ctx.json(missingPulseDetector.getStatus());
});

// Push endpoint
app.get("/v1/push/:token", async (ctx) => {
	const token: string = ctx.params["token"] || "";
	const query = ctx.query();

	const monitor: Monitor | undefined = cache.getMonitorByToken(token);
	if (!monitor) {
		return ctx.json({ error: "Invalid token" }, 401);
	}

	let latency: number | null = query.get("latency") ? parseFloat(query.get("latency") || "") : null;
	if (latency !== null) {
		if (!latency || isNaN(latency) || latency <= 0) {
			return ctx.json({ error: "Invalid latency" }, 400);
		}
		latency = Math.min(latency, 600000);
	}

	let startTime: Date | null = null;
	const startTimeParam = query.get("startTime");
	if (startTimeParam) {
		const parsed = isNaN(Number(startTimeParam)) ? new Date(startTimeParam) : new Date(Number(startTimeParam));
		if (isNaN(parsed.getTime())) return ctx.json({ error: "Invalid startTime format" }, 400);
		startTime = parsed;
	}

	let endTime: Date | null = null;
	const endTimeParam = query.get("endTime");
	if (endTimeParam) {
		const parsed = isNaN(Number(endTimeParam)) ? new Date(endTimeParam) : new Date(Number(endTimeParam));
		if (isNaN(parsed.getTime())) return ctx.json({ error: "Invalid endTime format" }, 400);
		endTime = parsed;
	}

	if (startTime && endTime) {
		const calculatedLatency = endTime.getTime() - startTime.getTime();
		if (calculatedLatency < 0) return ctx.json({ error: "endTime must be after startTime" }, 400);
		if (!latency) latency = Math.min(calculatedLatency, 600000);
	} else if (startTime && latency !== null) {
		endTime = new Date(startTime.getTime() + latency);
	} else if (endTime && latency !== null) {
		startTime = new Date(endTime.getTime() - latency);
	} else if (latency !== null) {
		endTime = new Date();
		startTime = new Date(endTime.getTime() - latency);
	} else {
		endTime = new Date();
		startTime = endTime;
	}

	const now = new Date();
	if (endTime.getTime() > now.getTime() + 60000) return ctx.json({ error: "Timestamp too far in the future" }, 400);
	if (startTime.getTime() < now.getTime() - 600000) return ctx.json({ error: "Timestamp too far in the past" }, 400);

	await storePulse(monitor.id, latency, startTime);

	return ctx.json({ success: true, monitorId: monitor.id });
});

// Status page endpoints
app.get("/v1/status/:slug", webCache({ ttl: 60, generateETags: false }), async (ctx) => {
	const slug: string = ctx.params["slug"] || "";
	const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
	if (!statusPage) return ctx.json({ error: "Status page not found" }, 404);

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
	const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
	if (!statusPage) return ctx.json({ error: "Status page not found" }, 404);

	let totalUp = 0,
		totalDegraded = 0,
		totalDown = 0;

	for (const id of statusPage.items) {
		const status = cache.getStatus(id);
		if (!status) continue;
		if (status.status === "up") totalUp++;
		else if (status.status === "degraded") totalDegraded++;
		else if (status.status === "down") totalDown++;
	}

	const overallStatus = totalDown > 0 ? "down" : totalDegraded > 0 ? "degraded" : "up";

	return ctx.json({
		status: overallStatus,
		monitors: { up: totalUp, degraded: totalDegraded, down: totalDown, total: totalUp + totalDegraded + totalDown },
	});
});

/**
 * GET /v1/monitors/:id/history
 * Returns all raw pulses (~24h due to TTL)
 */
app.get("/v1/monitors/:id/history", webCache({ ttl: 30, generateETags: false }), async (ctx) => {
	const monitorId = ctx.params["id"] || "";
	if (!cache.getMonitor(monitorId)) return ctx.json({ error: "Monitor not found" }, 404);

	const data = await getMonitorHistoryRaw(monitorId);
	return ctx.json({ monitorId, type: "raw", data });
});

/**
 * GET /v1/monitors/:id/history/hourly
 * Returns all hourly aggregates (~90 days due to TTL)
 */
app.get("/v1/monitors/:id/history/hourly", webCache({ ttl: 60, generateETags: false }), async (ctx) => {
	const monitorId = ctx.params["id"] || "";
	if (!cache.getMonitor(monitorId)) return ctx.json({ error: "Monitor not found" }, 404);

	const data = await getMonitorHistoryHourly(monitorId);
	return ctx.json({ monitorId, type: "hourly", data });
});

/**
 * GET /v1/monitors/:id/history/daily
 * Returns all daily aggregates (all time)
 */
app.get("/v1/monitors/:id/history/daily", webCache({ ttl: 300, generateETags: false }), async (ctx) => {
	const monitorId = ctx.params["id"] || "";
	if (!cache.getMonitor(monitorId)) return ctx.json({ error: "Monitor not found" }, 404);

	const data = await getMonitorHistoryDaily(monitorId);
	return ctx.json({ monitorId, type: "daily", data });
});

app.listen({ hostname: "0.0.0.0", port: config.server?.port || 3000 });

Logger.info(`Server running on port ${config.server?.port || 3000}`);

// Graceful shutdown
process.on("SIGTERM", () => {
	Logger.info("Received SIGTERM, shutting down gracefully");
	missingPulseDetector.stop();
	aggregationJob.stop();
	process.exit(0);
});

process.on("SIGINT", () => {
	Logger.info("Received SIGINT, shutting down gracefully");
	missingPulseDetector.stop();
	aggregationJob.stop();
	process.exit(0);
});
