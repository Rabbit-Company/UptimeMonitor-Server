import { Web } from "@rabbit-company/web";
import { Logger } from "./logger";
import { config, reloadConfig } from "./config";
import { cache } from "./cache";
import type { StatusPage, CustomMetrics, Monitor } from "./types";
import { initClickHouse, storePulse, updateMonitorStatus } from "./clickhouse";
import { missingPulseDetector } from "./missing-pulse-detector";
import { aggregationJob } from "./aggregation";
import { logger } from "@rabbit-company/web-middleware/logger";
import { cors } from "@rabbit-company/web-middleware/cors";
import { cache as webCache } from "@rabbit-company/web-middleware/cache";
import { Algorithm, rateLimit } from "@rabbit-company/web-middleware/rate-limit";
import { selfMonitor } from "./selfmonitor";
import { ipExtract } from "@rabbit-company/web-middleware/ip-extract";
import { handlePulseMonitorSubscription, notifyAllPulseMonitorClients } from "./pulsemonitor";
import { groupStateTracker } from "./group-state-tracker";
import { openapi } from "./openapi";
import { registerAdminAPI } from "./admin";
import { registerPublicRoutes } from "./routes";

await initClickHouse();

const app = new Web();

app.use(ipExtract(config.server.proxy));
app.use(
	rateLimit({
		algorithm: Algorithm.TOKEN_BUCKET,
		max: 500,
		refillRate: 100,
		refillInterval: 1000,
		skip(ctx) {
			const { pathname } = new URL(ctx.req.url);
			return pathname.startsWith("/v1/push/");
		},
	}),
);
app.use(logger({ logger: Logger, preset: "minimal", logResponses: false }));
app.use(cors());

// Health endpoints
app.get("/health", (ctx) => {
	return ctx.json({ status: "ok", timestamp: new Date().toISOString(), pendingWebSockets: server.pendingWebSockets });
});

app.get("/v1/health/missing-pulse-detector", (ctx) => {
	return ctx.json(missingPulseDetector.getStatus());
});

app.get("/openapi.json", webCache({ ttl: 3600, generateETags: false }), (ctx) => {
	return ctx.json(openapi);
});

// Register admin and public route modules
registerAdminAPI(app, () => server);
registerPublicRoutes(app);

// Configuration reload endpoint
app.get("/v1/reload/:token", async (ctx) => {
	const token: string = ctx.params["token"]!;

	if (token !== config.server.reloadToken) {
		return ctx.json({ error: "Invalid token" }, 401);
	}

	try {
		const newConfig = reloadConfig();
		cache.reload();
		missingPulseDetector.updateNotificationConfig(newConfig.notifications || { channels: {} });
		groupStateTracker.updateNotificationConfig();
		cache.getAllMonitors().map((m) => updateMonitorStatus(m.id));
		notifyAllPulseMonitorClients(server);

		Logger.info("Configuration reloaded successfully via API", {
			monitors: newConfig.monitors.length,
			groups: newConfig.groups.length,
			statusPages: newConfig.statusPages.length,
			pulseMonitors: newConfig.pulseMonitors.length,
			notificationChannels: Object.keys(newConfig.notifications?.channels || {}).length,
		});

		return ctx.json({
			success: true,
			message: "Configuration reloaded successfully",
			stats: {
				monitors: newConfig.monitors.length,
				groups: newConfig.groups.length,
				statusPages: newConfig.statusPages.length,
				pulseMonitors: newConfig.pulseMonitors.length,
				notificationChannels: Object.keys(newConfig.notifications?.channels || {}).length,
			},
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		Logger.error("Configuration reload failed", {
			error: error instanceof Error ? error.message : "Unknown error",
		});

		return ctx.json(
			{
				success: false,
				error: error instanceof Error ? error.message : "Configuration reload failed",
				timestamp: new Date().toISOString(),
			},
			500,
		);
	}
});

// WebSocket endpoint
app.get("/ws", async (ctx) => {
	if (ctx.req.headers.get("upgrade") === "websocket") {
		return new Response(null, { status: 101 });
	}
	return ctx.text("Use WebSocket protocol to connect");
});

app.websocket({
	idleTimeout: 120,
	maxPayloadLength: 1024 * 1024, // 1 MB
	open(ws) {
		Logger.audit("WebSocket connection opened", { ip: ws.data.clientIp || ws.remoteAddress });
		ws.send(
			JSON.stringify({
				action: "connected",
				message: "WebSocket connection established",
				timestamp: new Date().toISOString(),
			}),
		);
	},
	async message(ws, message) {
		if (typeof message !== "string") {
			ws.send(
				JSON.stringify({
					action: "error",
					message: "Invalid message format: expected string",
					timestamp: new Date().toISOString(),
				}),
			);
			return;
		}
		let data: any = {};
		try {
			data = JSON.parse(message);
		} catch {
			ws.send(
				JSON.stringify({
					action: "error",
					message: "Invalid JSON payload",
					timestamp: new Date().toISOString(),
				}),
			);
			return;
		}

		// Handle pulse push via WebSocket
		if (data?.action === "push") {
			if (typeof data?.token !== "string") {
				ws.send(
					JSON.stringify({
						action: "error",
						message: "Missing or invalid 'token' parameter",
						timestamp: new Date().toISOString(),
					}),
				);
				return;
			}

			const monitor: Monitor | undefined = cache.getMonitorByToken(data.token);
			if (!monitor) {
				ws.send(
					JSON.stringify({
						action: "error",
						message: "Invalid token",
						timestamp: new Date().toISOString(),
					}),
				);
				return;
			}

			// Parse latency
			let latency: number | null = null;
			if (data.latency !== undefined && data.latency !== null) {
				latency = parseFloat(String(data.latency));
				if (isNaN(latency) || latency <= 0) {
					ws.send(
						JSON.stringify({
							action: "error",
							message: "Invalid latency",
							timestamp: new Date().toISOString(),
						}),
					);
					return;
				}
				latency = Math.min(latency, 600000);
			}

			// Parse custom metrics
			const customMetrics: CustomMetrics = {
				custom1: null,
				custom2: null,
				custom3: null,
			};

			if (monitor.custom1) {
				const custom1Value = data.custom1 ? parseFloat(String(data.custom1)) : null;
				if (custom1Value !== null && !isNaN(custom1Value)) customMetrics.custom1 = custom1Value;
			}
			if (monitor.custom2) {
				const custom2Value = data.custom2 ? parseFloat(String(data.custom2)) : null;
				if (custom2Value !== null && !isNaN(custom2Value)) customMetrics.custom2 = custom2Value;
			}
			if (monitor.custom3) {
				const custom3Value = data.custom3 ? parseFloat(String(data.custom3)) : null;
				if (custom3Value !== null && !isNaN(custom3Value)) customMetrics.custom3 = custom3Value;
			}

			// Parse timing
			let startTime: Date | null = null;
			let endTime: Date | null = null;

			if (data.startTime) {
				const parsed = isNaN(Number(data.startTime)) ? new Date(data.startTime) : new Date(Number(data.startTime));
				if (!isNaN(parsed.getTime())) startTime = parsed;
			}
			if (data.endTime) {
				const parsed = isNaN(Number(data.endTime)) ? new Date(data.endTime) : new Date(Number(data.endTime));
				if (!isNaN(parsed.getTime())) endTime = parsed;
			}

			if (startTime && endTime) {
				const calculatedLatency = endTime.getTime() - startTime.getTime();
				if (calculatedLatency < 0) {
					ws.send(JSON.stringify({ action: "error", message: "endTime must be after startTime", timestamp: new Date().toISOString() }));
					return;
				}
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

			// Validate timestamp bounds
			const now = new Date();
			if (endTime.getTime() > now.getTime() + 60000) {
				ws.send(JSON.stringify({ action: "error", message: "Timestamp too far in the future", timestamp: new Date().toISOString() }));
				return;
			}
			if (startTime.getTime() < now.getTime() - 600000) {
				ws.send(JSON.stringify({ action: "error", message: "Timestamp too far in the past", timestamp: new Date().toISOString() }));
				return;
			}

			try {
				await storePulse(monitor.id, latency, startTime, false, customMetrics);
			} catch (err: any) {
				Logger.error("Storing pulse failed", { monitorId: monitor.id, "error.message": err?.message });
				ws.send(JSON.stringify({ action: "error", message: "Failed to store pulse", timestamp: new Date().toISOString() }));
				return;
			}

			ws.send(JSON.stringify({ action: "pushed", pulseId: data?.pulseId ?? null, monitorId: monitor.id, timestamp: new Date().toISOString() }));
			return;
		}

		// Handle PulseMonitor subscription
		if (data?.action === "subscribe" && typeof data?.token === "string") {
			const result = handlePulseMonitorSubscription(ws, data.token);

			if (!result.success) {
				ws.send(JSON.stringify({ action: "error", message: result.error, timestamp: new Date().toISOString() }));
				return;
			}

			ws.send(
				JSON.stringify({
					action: "subscribed",
					pulseMonitorId: result.pulseMonitor.id,
					pulseMonitorName: result.pulseMonitor.name,
					data: { monitors: result.configs },
					timestamp: new Date().toISOString(),
				}),
			);
			return;
		}

		// Handle status page subscription
		if (data?.action === "subscribe" && typeof data?.slug === "string") {
			const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(data.slug);
			if (!statusPage) {
				ws.send(JSON.stringify({ action: "error", message: "Status page not found", slug: data.slug, timestamp: new Date().toISOString() }));
				return;
			}

			if (cache.isStatusPageProtected(data.slug)) {
				const password: string | null = typeof data?.password === "string" ? data.password : null;
				if (!password) {
					ws.send(
						JSON.stringify({
							action: "error",
							message: "This status page is password protected. 'password' is required.",
							slug: data.slug,
							timestamp: new Date().toISOString(),
						}),
					);
					return;
				}

				if (!cache.verifyStatusPagePassword(data.slug, password)) {
					ws.send(JSON.stringify({ action: "error", message: "Invalid password", slug: data.slug, timestamp: new Date().toISOString() }));
					return;
				}
			}

			const channel = `slug-${data.slug}`;
			ws.subscribe(channel);

			Logger.audit(`WebSocket subscribed to channel: ${channel}`, { ip: ws.data.clientIp || ws.remoteAddress });

			ws.send(JSON.stringify({ action: "subscribed", slug: data.slug, timestamp: new Date().toISOString() }));
			return;
		}

		// Handle unsubscribe
		if (data?.action === "unsubscribe" && typeof data?.slug === "string") {
			const channel = `slug-${data.slug}`;
			ws.unsubscribe(channel);

			Logger.audit(`WebSocket unsubscribed from ${channel}`, { ip: ws.data.clientIp || ws.remoteAddress });

			ws.send(JSON.stringify({ action: "unsubscribed", slug: data.slug, timestamp: new Date().toISOString() }));
			return;
		}

		if (data?.action === "list_subscriptions") {
			const slugs: string[] = [];

			ws.subscriptions.forEach((subscription) => {
				if (subscription.startsWith("slug-")) {
					slugs.push(subscription.replace("slug-", ""));
				}
			});

			ws.send(JSON.stringify({ action: "subscriptions", type: "slug", items: slugs, timestamp: new Date().toISOString() }));
			return;
		}

		ws.send(JSON.stringify({ action: "error", message: "Unknown action", timestamp: new Date().toISOString() }));
	},
	close(ws, code, reason) {
		Logger.audit(`WebSocket connection closed`, { ip: ws.data.clientIp || ws.remoteAddress, code, reason: reason || "none" });

		ws.subscriptions.forEach((subscription) => {
			ws.unsubscribe(subscription);
		});
	},
	error(ws, error) {
		Logger.error("WebSocket runtime error", {
			ip: ws.data.clientIp || ws.remoteAddress,
			error,
		});
	},
});

export const server = await app.listen({ hostname: "0.0.0.0", port: config.server?.port || 3000 });

Logger.info(`Server running on port ${config.server?.port || 3000}`);
Logger.info(`Configuration reload endpoint: /v1/reload/:token`, {
	reloadToken: config.server.reloadToken,
});
if (config.pulseMonitors.length > 0) {
	Logger.info(`PulseMonitor WebSocket endpoint: /ws`, {
		pulseMonitorCount: config.pulseMonitors.length,
		pulseMonitorIds: config.pulseMonitors.map((pm) => pm.id),
	});
}

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

selfMonitor.start().catch((err) => Logger.error("SelfMonitor error", err));
aggregationJob.start().catch((err) => Logger.error("AggregationJob error", err));

await Promise.all(cache.getAllMonitors().map((monitor) => updateMonitorStatus(monitor.id)));
missingPulseDetector.start();
