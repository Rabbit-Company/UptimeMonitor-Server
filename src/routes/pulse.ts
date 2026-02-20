import type { Web } from "@rabbit-company/web";
import { cache } from "../cache";
import type { Monitor, CustomMetrics } from "../types";
import { storePulse } from "../clickhouse";
import { Algorithm, rateLimit } from "@rabbit-company/web-middleware/rate-limit";

export function registerPulseRoutes(app: Web): void {
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
				const custom1Value = query.get("custom1") ?? query.get(monitor.custom1.id);
				if (custom1Value !== null) {
					const parsed = parseFloat(custom1Value);
					if (!isNaN(parsed)) {
						customMetrics.custom1 = parsed;
					}
				}
			}

			if (monitor.custom2) {
				const custom2Value = query.get("custom2") ?? query.get(monitor.custom2.id);
				if (custom2Value !== null) {
					const parsed = parseFloat(custom2Value);
					if (!isNaN(parsed)) {
						customMetrics.custom2 = parsed;
					}
				}
			}

			if (monitor.custom3) {
				const custom3Value = query.get("custom3") ?? query.get(monitor.custom3.id);
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
}
