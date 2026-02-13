import { Web } from "@rabbit-company/web";
import { Logger } from "./logger";
import { config, reloadConfig } from "./config";
import { cache } from "./cache";
import type { StatusData, StatusPage, CustomMetrics, Group, Monitor } from "./types";
import {
	getMonitorHistoryRaw,
	getMonitorHistoryHourly,
	getMonitorHistoryDaily,
	getGroupHistoryRaw,
	getGroupHistoryHourly,
	getGroupHistoryDaily,
	initClickHouse,
	storePulse,
	updateMonitorStatus,
} from "./clickhouse";
import { buildStatusTree } from "./statuspage";
import { missingPulseDetector } from "./missing-pulse-detector";
import { aggregationJob } from "./aggregation";
import { logger } from "@rabbit-company/web-middleware/logger";
import { cors } from "@rabbit-company/web-middleware/cors";
import { cache as webCache } from "@rabbit-company/web-middleware/cache";
import { bearerAuth } from "@rabbit-company/web-middleware/bearer-auth";
import { Algorithm, rateLimit } from "@rabbit-company/web-middleware/rate-limit";
import { selfMonitor } from "./selfmonitor";
import { ipExtract } from "@rabbit-company/web-middleware/ip-extract";
import { handlePulseMonitorSubscription, notifyAllPulseMonitorClients } from "./pulsemonitor";
import { groupStateTracker } from "./group-state-tracker";
import { openapi } from "./openapi";
import { registerAdminAPI } from "./admin";

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

registerAdminAPI(app, () => server);

// Configuration reload endpoint
app.get("/v1/reload/:token", async (ctx) => {
	const token: string = ctx.params["token"]!;

	if (token !== config.server.reloadToken) {
		return ctx.json({ error: "Invalid token" }, 401);
	}

	try {
		// Reload configuration
		const newConfig = reloadConfig();

		// Reload cache with new configuration
		cache.reload();

		// Update notification configuration in missing pulse detector
		missingPulseDetector.updateNotificationConfig(newConfig.notifications || { channels: {} });
		groupStateTracker.updateNotificationConfig();

		// Update all monitor statuses
		await Promise.all(cache.getAllMonitors().map((m) => updateMonitorStatus(m.id)));

		// Notify all PulseMonitor clients about the configuration change
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

// Push endpoint
app.get(
	"/v1/push/:token",
	rateLimit({
		algorithm: Algorithm.TOKEN_BUCKET,
		max: 60,
		refillRate: 12,
		refillInterval: 1000,
		keyGenerator(ctx) {
			return ctx.params["token"] || ctx.clientIp || "";
		},
	}),
	async (ctx) => {
		const token: string = ctx.params["token"]!;
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

		const customMetrics: CustomMetrics = {
			custom1: null,
			custom2: null,
			custom3: null,
		};

		if (monitor.custom1) {
			const custom1Value = query.get(monitor.custom1.id) ?? query.get("custom1");
			if (custom1Value !== null) {
				const parsed = parseFloat(custom1Value);
				if (!isNaN(parsed)) {
					customMetrics.custom1 = parsed;
				}
			}
		} else {
			const custom1Value = query.get("custom1");
			if (custom1Value !== null) {
				const parsed = parseFloat(custom1Value);
				if (!isNaN(parsed)) {
					customMetrics.custom1 = parsed;
				}
			}
		}

		if (monitor.custom2) {
			const custom2Value = query.get(monitor.custom2.id) ?? query.get("custom2");
			if (custom2Value !== null) {
				const parsed = parseFloat(custom2Value);
				if (!isNaN(parsed)) {
					customMetrics.custom2 = parsed;
				}
			}
		} else {
			const custom2Value = query.get("custom2");
			if (custom2Value !== null) {
				const parsed = parseFloat(custom2Value);
				if (!isNaN(parsed)) {
					customMetrics.custom2 = parsed;
				}
			}
		}

		if (monitor.custom3) {
			const custom3Value = query.get(monitor.custom3.id) ?? query.get("custom3");
			if (custom3Value !== null) {
				const parsed = parseFloat(custom3Value);
				if (!isNaN(parsed)) {
					customMetrics.custom3 = parsed;
				}
			}
		} else {
			const custom3Value = query.get("custom3");
			if (custom3Value !== null) {
				const parsed = parseFloat(custom3Value);
				if (!isNaN(parsed)) {
					customMetrics.custom3 = parsed;
				}
			}
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

		await storePulse(monitor.id, latency, startTime, false, customMetrics);

		return ctx.json({ success: true, monitorId: monitor.id });
	},
);

// Status page endpoints
app.get(
	"/v1/status/:slug",
	bearerAuth({
		skip(ctx) {
			const slug = ctx.params["slug"]!;
			const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
			if (!statusPage) return true;
			if (cache.isStatusPageProtected(slug)) return false;
			return true;
		},
		validate(token, ctx) {
			const slug = ctx.params["slug"]!;
			const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
			if (!statusPage) return false;
			if (token.length !== statusPage.hashedPassword!.length) return false;
			return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(statusPage.hashedPassword!));
		},
	}),
	webCache({
		ttl: 30,
		generateETags: false,
		shouldCache(ctx, res) {
			const slug = ctx.params["slug"]!;
			const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
			if (!statusPage) return false;
			if (cache.isStatusPageProtected(slug)) return false;
			return res.status >= 200 && res.status < 300;
		},
	}),
	async (ctx) => {
		const slug: string = ctx.params["slug"]!;
		const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
		if (!statusPage) return ctx.json({ error: "Status page not found" }, 404);

		const statusData: StatusData[] = buildStatusTree(statusPage.items);
		return ctx.json({
			name: statusPage.name,
			slug: statusPage.slug,
			items: statusData,
			lastUpdated: new Date(),
		});
	},
);

app.get(
	"/v1/status/:slug/summary",
	bearerAuth({
		skip(ctx) {
			const slug = ctx.params["slug"]!;
			const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
			if (!statusPage) return true;
			if (cache.isStatusPageProtected(slug)) return false;
			return true;
		},
		validate(token, ctx) {
			const slug = ctx.params["slug"]!;
			const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
			if (!statusPage) return false;
			if (token.length !== statusPage.hashedPassword!.length) return false;
			return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(statusPage.hashedPassword!));
		},
	}),
	webCache({
		ttl: 30,
		generateETags: false,
		shouldCache(ctx, res) {
			const slug = ctx.params["slug"]!;
			const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
			if (!statusPage) return false;
			if (cache.isStatusPageProtected(slug)) return false;
			return res.status >= 200 && res.status < 300;
		},
	}),
	async (ctx) => {
		const slug: string = ctx.params["slug"]!;
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
	},
);

/**
 * GET /v1/monitors/:id/history
 * Returns all raw pulses (~24h due to TTL)
 */
app.get("/v1/monitors/:id/history", webCache({ ttl: 30, generateETags: false }), async (ctx) => {
	const monitorId = ctx.params["id"]!;
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
});

/**
 * GET /v1/monitors/:id/history/hourly
 * Returns hourly aggregated data (~90 days due to TTL)
 */
app.get("/v1/monitors/:id/history/hourly", webCache({ ttl: 300, generateETags: false }), async (ctx) => {
	const monitorId = ctx.params["id"]!;
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
});

/**
 * GET /v1/monitors/:id/history/daily
 * Returns daily aggregated data (all time)
 */
app.get("/v1/monitors/:id/history/daily", webCache({ ttl: 900, generateETags: false }), async (ctx) => {
	const monitorId = ctx.params["id"]!;
	const monitor = cache.getMonitor(monitorId);
	if (!monitor) return ctx.json({ error: "Monitor not found" }, 404);

	const data = await getMonitorHistoryDaily(monitorId);

	// Include custom metric configuration in response
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
});

/**
 * GET /v1/groups/:id/history
 * Returns raw history for a group (~24h due to TTL)
 * Group uptime is computed from child monitors based on the group's strategy:
 * - "any-up": Group is UP (100%) if at least one child monitor is up in that time window
 * - "all-up": Group is UP (100%) only if all child monitors are up in that time window
 * - "percentage": Group uptime is the percentage of child monitors that are up
 */
app.get("/v1/groups/:id/history", webCache({ ttl: 30, generateETags: false }), async (ctx) => {
	const groupId = ctx.params["id"]!;
	const group: Group | undefined = cache.getGroup(groupId);
	if (!group) return ctx.json({ error: "Group not found" }, 404);

	const data = await getGroupHistoryRaw(groupId);

	return ctx.json({
		groupId,
		type: "raw",
		strategy: group.strategy,
		data,
	});
});

/**
 * GET /v1/groups/:id/history/hourly
 * Returns hourly history for a group (~90 days due to TTL)
 */
app.get("/v1/groups/:id/history/hourly", webCache({ ttl: 300, generateETags: false }), async (ctx) => {
	const groupId = ctx.params["id"]!;
	const group: Group | undefined = cache.getGroup(groupId);
	if (!group) return ctx.json({ error: "Group not found" }, 404);

	const data = await getGroupHistoryHourly(groupId);

	return ctx.json({
		groupId,
		type: "hourly",
		strategy: group.strategy,
		data,
	});
});

/**
 * GET /v1/groups/:id/history/daily
 * Returns daily history for a group (all time)
 */
app.get("/v1/groups/:id/history/daily", webCache({ ttl: 900, generateETags: false }), async (ctx) => {
	const groupId = ctx.params["id"]!;
	const group: Group | undefined = cache.getGroup(groupId);
	if (!group) return ctx.json({ error: "Group not found" }, 404);

	const data = await getGroupHistoryDaily(groupId);

	return ctx.json({
		groupId,
		type: "daily",
		strategy: group.strategy,
		data,
	});
});

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

			// Custom1
			if (monitor.custom1) {
				const custom1Value = data[monitor.custom1.id] ?? data.custom1;
				if (custom1Value !== undefined && custom1Value !== null) {
					const parsed = parseFloat(String(custom1Value));
					if (!isNaN(parsed)) {
						customMetrics.custom1 = parsed;
					}
				}
			} else if (data.custom1 !== undefined && data.custom1 !== null) {
				const parsed = parseFloat(String(data.custom1));
				if (!isNaN(parsed)) {
					customMetrics.custom1 = parsed;
				}
			}

			// Custom2
			if (monitor.custom2) {
				const custom2Value = data[monitor.custom2.id] ?? data.custom2;
				if (custom2Value !== undefined && custom2Value !== null) {
					const parsed = parseFloat(String(custom2Value));
					if (!isNaN(parsed)) {
						customMetrics.custom2 = parsed;
					}
				}
			} else if (data.custom2 !== undefined && data.custom2 !== null) {
				const parsed = parseFloat(String(data.custom2));
				if (!isNaN(parsed)) {
					customMetrics.custom2 = parsed;
				}
			}

			// Custom3
			if (monitor.custom3) {
				const custom3Value = data[monitor.custom3.id] ?? data.custom3;
				if (custom3Value !== undefined && custom3Value !== null) {
					const parsed = parseFloat(String(custom3Value));
					if (!isNaN(parsed)) {
						customMetrics.custom3 = parsed;
					}
				}
			} else if (data.custom3 !== undefined && data.custom3 !== null) {
				const parsed = parseFloat(String(data.custom3));
				if (!isNaN(parsed)) {
					customMetrics.custom3 = parsed;
				}
			}

			// Parse timing parameters
			let startTime: Date | null = null;
			if (data.startTime !== undefined && data.startTime !== null) {
				const parsed = isNaN(Number(data.startTime)) ? new Date(String(data.startTime)) : new Date(Number(data.startTime));
				if (isNaN(parsed.getTime())) {
					ws.send(
						JSON.stringify({
							action: "error",
							message: "Invalid startTime format",
							timestamp: new Date().toISOString(),
						}),
					);
					return;
				}
				startTime = parsed;
			}

			let endTime: Date | null = null;
			if (data.endTime !== undefined && data.endTime !== null) {
				const parsed = isNaN(Number(data.endTime)) ? new Date(String(data.endTime)) : new Date(Number(data.endTime));
				if (isNaN(parsed.getTime())) {
					ws.send(
						JSON.stringify({
							action: "error",
							message: "Invalid endTime format",
							timestamp: new Date().toISOString(),
						}),
					);
					return;
				}
				endTime = parsed;
			}

			// Apply timing logic (same as HTTP endpoint)
			if (startTime && endTime) {
				const calculatedLatency = endTime.getTime() - startTime.getTime();
				if (calculatedLatency < 0) {
					ws.send(
						JSON.stringify({
							action: "error",
							message: "endTime must be after startTime",
							timestamp: new Date().toISOString(),
						}),
					);
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
				ws.send(
					JSON.stringify({
						action: "error",
						message: "Timestamp too far in the future",
						timestamp: new Date().toISOString(),
					}),
				);
				return;
			}
			if (startTime.getTime() < now.getTime() - 600000) {
				ws.send(
					JSON.stringify({
						action: "error",
						message: "Timestamp too far in the past",
						timestamp: new Date().toISOString(),
					}),
				);
				return;
			}

			// Store the pulse
			await storePulse(monitor.id, latency, startTime, false, customMetrics);

			ws.send(
				JSON.stringify({
					action: "pushed",
					monitorId: monitor.id,
					timestamp: new Date().toISOString(),
				}),
			);
			return;
		}

		// Handle PulseMonitor subscription
		if (data?.action === "subscribe" && typeof data?.token === "string") {
			const result = handlePulseMonitorSubscription(ws, data.token);

			if (!result.success) {
				ws.send(
					JSON.stringify({
						action: "error",
						message: result.error,
						timestamp: new Date().toISOString(),
					}),
				);
				return;
			}

			ws.send(
				JSON.stringify({
					action: "subscribed",
					pulseMonitorId: result.pulseMonitor.id,
					pulseMonitorName: result.pulseMonitor.name,
					data: {
						monitors: result.configs,
					},
					timestamp: new Date().toISOString(),
				}),
			);

			return;
		}

		// Handle status page subscription (existing functionality)
		if (data?.action === "subscribe" && typeof data?.slug === "string") {
			const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(data.slug);
			if (!statusPage) {
				ws.send(
					JSON.stringify({
						action: "error",
						message: "Status page not found",
						slug: data.slug,
						timestamp: new Date().toISOString(),
					}),
				);
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

				if (password?.length !== statusPage.hashedPassword?.length) {
					ws.send(
						JSON.stringify({
							action: "error",
							message: "Password needs to be Blake2b-512 hashed",
							slug: data.slug,
							timestamp: new Date().toISOString(),
						}),
					);
					return;
				}

				if (!crypto.timingSafeEqual(Buffer.from(password), Buffer.from(statusPage.hashedPassword))) {
					ws.send(
						JSON.stringify({
							action: "error",
							message: "Password is incorrect",
							slug: data.slug,
							timestamp: new Date().toISOString(),
						}),
					);
					return;
				}
			}

			const channel = `slug-${data.slug}`;
			ws.subscribe(channel);

			Logger.audit(`WebSocket subscribed to channel: ${channel}`, { ip: ws.data.clientIp || ws.remoteAddress });

			ws.send(
				JSON.stringify({
					action: "subscribed",
					slug: data.slug,
					message: "Subscription successful",
					timestamp: new Date().toISOString(),
				}),
			);

			return;
		}

		if (data?.action === "unsubscribe") {
			if (typeof data.slug !== "string") {
				ws.send(
					JSON.stringify({
						action: "error",
						message: "Missing or invalid 'slug' parameter",
						timestamp: new Date().toISOString(),
					}),
				);
				return;
			}

			const channel = `slug-${data.slug}`;

			if (!ws.subscriptions.includes(channel)) {
				ws.send(
					JSON.stringify({
						action: "unsubscribed",
						slug: data.slug,
						message: "Already unsubscribed",
						timestamp: new Date().toISOString(),
					}),
				);
				return;
			}

			ws.unsubscribe(channel);

			Logger.audit(`WebSocket unsubscribed from ${channel}`, { ip: ws.data.clientIp || ws.remoteAddress });

			ws.send(
				JSON.stringify({
					action: "unsubscribed",
					slug: data.slug,
					message: "Unsubscription successful",
					timestamp: new Date().toISOString(),
				}),
			);
			return;
		}

		if (data?.action === "list_subscriptions") {
			const slugs: string[] = [];

			ws.subscriptions.forEach((subscription) => {
				if (subscription.startsWith("slug-")) {
					slugs.push(subscription.replace("slug-", ""));
				}
			});

			ws.send(
				JSON.stringify({
					action: "subscriptions",
					type: "slug",
					items: slugs,
					timestamp: new Date().toISOString(),
				}),
			);
			return;
		}

		ws.send(
			JSON.stringify({
				action: "error",
				message: "Unknown action",
				timestamp: new Date().toISOString(),
			}),
		);
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
