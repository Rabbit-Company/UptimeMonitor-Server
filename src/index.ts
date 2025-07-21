import { Web } from "@rabbit-company/web";
import { Logger } from "./logger";
import { config } from "./config";
import { cache } from "./cache";
import type { Group, Monitor, StatusData, StatusPage } from "./types";
import { getGroupHistory, getMonitorHistory, initClickHouse, storePulse, updateMonitorStatus } from "./clickhouse";
import { buildStatusTree } from "./statuspage";
import { missingPulseDetector } from "./missing-pulse-detector";
import { logger } from "@rabbit-company/web-middleware/logger";
import { cors } from "@rabbit-company/web-middleware/cors";
import { cache as webCache } from "@rabbit-company/web-middleware/cache";

await initClickHouse();

// Initialize all monitors and groups status
await Promise.all(cache.getAllMonitors().map((monitor) => updateMonitorStatus(monitor.id)));

missingPulseDetector.start();

const app = new Web();

app.use(logger({ logger: Logger, preset: "minimal", logResponses: false }));

app.use(cors());

app.get("/health", (ctx) => {
	return ctx.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/v1/health/missing-pulse-detector", (ctx) => {
	const status = missingPulseDetector.getStatus();
	return ctx.json(status);
});

app.get("/v1/push/:token", async (ctx) => {
	const token: string = ctx.params["token"] || "";
	const query = ctx.query();

	const monitor: Monitor | undefined = cache.getMonitorByToken(token);
	if (!monitor) {
		return ctx.json({ error: "Invalid token" }, 401);
	}

	// Parse latency
	let latency: number | null = query.get("latency") ? parseFloat(query.get("latency") || "") : null;
	if (latency !== null) {
		if (!latency || isNaN(latency) || latency <= 0) {
			return ctx.json({ error: "Invalid latency" }, 400);
		}
		// Cap latency at 10 minutes
		latency = Math.min(latency, 600000);
	}

	// Parse startTime (when the check started)
	let startTime: Date | null = null;
	const startTimeParam = query.get("startTime");
	if (startTimeParam) {
		try {
			// Handle ISO format or timestamp
			const parsed = isNaN(Number(startTimeParam)) ? new Date(startTimeParam) : new Date(Number(startTimeParam));

			if (!isNaN(parsed.getTime())) {
				startTime = parsed;
			} else {
				return ctx.json({ error: "Invalid startTime format" }, 400);
			}
		} catch (error) {
			return ctx.json({ error: "Invalid startTime format" }, 400);
		}
	}

	// Parse endTime (when the check completed)
	let endTime: Date | null = null;
	const endTimeParam = query.get("endTime");
	if (endTimeParam) {
		try {
			// Handle ISO format or timestamp
			const parsed = isNaN(Number(endTimeParam)) ? new Date(endTimeParam) : new Date(Number(endTimeParam));

			if (!isNaN(parsed.getTime())) {
				endTime = parsed;
			} else {
				return ctx.json({ error: "Invalid endTime format" }, 400);
			}
		} catch (error) {
			return ctx.json({ error: "Invalid endTime format" }, 400);
		}
	}

	// Validate timing logic
	if (startTime && endTime) {
		// If both are provided, calculate latency from them
		const calculatedLatency = endTime.getTime() - startTime.getTime();
		if (calculatedLatency < 0) {
			return ctx.json({ error: "endTime must be after startTime" }, 400);
		}
		// Update latency with calculated value
		if (!latency) latency = Math.min(calculatedLatency, 600000); // Cap at 10 minutes
	} else if (startTime && latency !== null) {
		// If startTime and latency are provided, calculate endTime
		endTime = new Date(startTime.getTime() + latency);
	} else if (endTime && latency !== null) {
		// If endTime and latency are provided, calculate startTime
		startTime = new Date(endTime.getTime() - latency);
	} else if (latency !== null) {
		// If only latency is provided, calculate based on current time
		endTime = new Date();
		startTime = new Date(endTime.getTime() - latency);
	} else {
		// No timing information provided, use current time
		endTime = new Date();
		startTime = endTime;
	}

	// Validate timestamps aren't too far in the future or past
	const now = new Date();
	const maxFuture = 60000; // 1 minute in the future (for clock drift)
	const maxPast = 31536000000; // 1 year in the past

	if (endTime.getTime() > now.getTime() + maxFuture) {
		return ctx.json({ error: "Timestamp too far in the future" }, 400);
	}

	if (startTime.getTime() < now.getTime() - maxPast) {
		return ctx.json({ error: "Timestamp too far in the past" }, 400);
	}

	await storePulse(monitor.id, latency, startTime);

	return ctx.json({ success: true, monitorId: monitor.id });
});

app.get(
	"/v1/status/:slug",
	webCache({
		ttl: 60,
		generateETags: false,
	}),
	async (ctx) => {
		const slug: string = ctx.params["slug"] || "";

		const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
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
	}
);

app.get("/v1/status/:slug/summary", async (ctx) => {
	const slug: string = ctx.params["slug"] || "";

	const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
	if (!statusPage) {
		return ctx.json({ error: "Status page not found" }, 404);
	}

	let totalUp = 0;
	let totalDegraded = 0;
	let totalDown = 0;

	const countStatus = (items: string[]): void => {
		for (const id of items) {
			const status = cache.getStatus(id);
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

app.get(
	"/v1/monitors/:id/history",
	webCache({
		ttl: 60,
		generateETags: false,
	}),
	async (ctx) => {
		const monitorId: string = ctx.params["id"] || "";
		const period: string = ctx.query().get("period") || "24h";

		const monitor: Monitor | undefined = cache.getMonitor(monitorId);
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
	}
);

app.get(
	"/v1/groups/:id/history",
	webCache({
		ttl: 60,
		generateETags: false,
	}),
	async (ctx) => {
		const groupId: string = ctx.params["id"] || "";
		const period: string = ctx.query().get("period") || "24h";

		const group: Group | undefined = cache.getGroup(groupId);
		if (!group) {
			return ctx.json({ error: "Group not found" }, 404);
		}

		if (!["1h", "24h", "7d", "30d", "90d", "365d"].includes(period)) {
			return ctx.json({ error: "Invalid period" }, 401);
		}
		let data;

		try {
			data = await getGroupHistory(groupId, period);
		} catch (err: any) {
			Logger.error("Retrieval of group history failed", { groupId: groupId, period: period, "error.message": err?.message });
		}

		return ctx.json({
			groupId,
			period,
			data,
		});
	}
);

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
