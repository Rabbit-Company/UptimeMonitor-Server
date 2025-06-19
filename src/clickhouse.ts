import { createClient } from "@clickhouse/client";
import { config } from "./config";
import { Logger } from "./logger";
import { EventEmitter } from "events";
import type { Group, HistoryRecord, IntervalConfig, Monitor, PulseRecord, StatusData, UptimeRecord } from "./types";
import { missingPulseDetector } from "./missing-pulse-detector";
import { NotificationManager } from "./notifications";

export const statusCache = new Map<string, StatusData>();
export const eventEmitter = new EventEmitter();

export const updateQueue = new Set<string>();
export const BATCH_INTERVAL = 5000; // 5 seconds

export const clickhouse = createClient(config.clickhouse);

const INTERVALS: Record<string, IntervalConfig> = {
	"1h": {
		interval: "1 minute",
		intervalMs: 60 * 1000, // 1 minute
		range: "1 HOUR",
		rangeMs: 60 * 60 * 1000, // 1 hour
	},
	"24h": {
		interval: "5 minute",
		intervalMs: 5 * 60 * 1000, // 5 minutes
		range: "24 HOUR",
		rangeMs: 24 * 60 * 60 * 1000, // 24 hours
	},
	"7d": {
		interval: "1 hour",
		intervalMs: 60 * 60 * 1000, // 1 hour
		range: "7 DAY",
		rangeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
	},
	"30d": {
		interval: "1 day",
		intervalMs: 24 * 60 * 60 * 1000, // 1 day
		range: "30 DAY",
		rangeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
	},
	"90d": {
		interval: "1 day",
		intervalMs: 24 * 60 * 60 * 1000, // 1 day
		range: "90 DAY",
		rangeMs: 90 * 24 * 60 * 60 * 1000, // 90 days
	},
	"365d": {
		interval: "1 day",
		intervalMs: 24 * 60 * 60 * 1000, // 1 day
		range: "1 YEAR",
		rangeMs: 365 * 24 * 60 * 60 * 1000, // 1 year
	},
};

export async function initClickHouse(): Promise<void> {
	try {
		await clickhouse.exec({
			query: `
      CREATE TABLE IF NOT EXISTS pulses (
        monitor_id String,
        status Enum('up' = 1, 'down' = 2),
        latency Nullable(Float32),
        timestamp DateTime64(3)
      ) ENGINE = MergeTree()
      ORDER BY (monitor_id, timestamp)
      PARTITION BY toYYYYMM(timestamp)
			TTL toDateTime(timestamp) + INTERVAL 1 YEAR DELETE
    `,
		});

		await clickhouse.exec({
			query: `
      CREATE TABLE IF NOT EXISTS monitor_status (
        monitor_id String,
        status Enum('up' = 1, 'down' = 2),
        latency Float32,
        last_check DateTime64(3),
        uptime_24h Float32,
        uptime_7d Float32,
        uptime_30d Float32,
        updated_at DateTime64(3)
      ) ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY monitor_id
			TTL toDateTime(updated_at) + INTERVAL 1 YEAR DELETE
    `,
		});
	} catch (err: any) {
		Logger.error("ClickHouse connection failed", { "error.message": err?.message });
	}
}

setInterval(async () => {
	const monitors = [...updateQueue];
	updateQueue.clear();

	await Promise.all(monitors.map(updateMonitorStatus));
}, BATCH_INTERVAL);

export async function storePulse(monitorId: string, status: "up" | "down", latency: number | null): Promise<void> {
	const timestamp = new Date();

	try {
		await clickhouse.insert({
			table: "pulses",
			values: [
				{
					monitor_id: monitorId,
					status,
					latency,
					timestamp: timestamp.toISOString().replace("T", " ").replace("Z", ""),
				},
			],
			format: "JSONEachRow",
		});
	} catch (err: any) {
		Logger.error("Storing pulse into ClickHouse failed", { monitorId: monitorId, "error.message": err?.message });
	}

	updateQueue.add(monitorId);

	// Reset missed pulse counter when we receive a pulse
	if (status === "up") {
		missingPulseDetector.resetMonitor(monitorId);
	}

	// Emit event for real-time updates
	eventEmitter.emit("pulse", { monitorId, status, latency, timestamp });
}

export async function updateMonitorStatus(monitorId: string): Promise<void> {
	try {
		const monitor: Monitor | undefined = config.monitors.find((m: Monitor) => m.id === monitorId);
		if (!monitor) return;

		const queries = {
			latest: `
				SELECT status, latency, timestamp as last_check
				FROM pulses
				WHERE monitor_id = '${monitorId}'
				ORDER BY timestamp DESC
				LIMIT 1
			`,
			uptime1h: `
				WITH
					${(1 * 60 * 60) / monitor.interval} as expected_pulses_1h,
					(
						SELECT countIf(status = 'up')
						FROM pulses
						WHERE monitor_id = '${monitorId}'
							AND timestamp > now() - INTERVAL 1 HOUR
					) as actual_up_pulses
				SELECT (actual_up_pulses * 100.0) / expected_pulses_1h as uptime
			`,
			uptime24h: `
				WITH
					${(24 * 60 * 60) / monitor.interval} as expected_pulses_24h,
					(
						SELECT countIf(status = 'up')
						FROM pulses
						WHERE monitor_id = '${monitorId}'
							AND timestamp > now() - INTERVAL 24 HOUR
					) as actual_up_pulses
				SELECT (actual_up_pulses * 100.0) / expected_pulses_24h as uptime
			`,
			uptime7d: `
				WITH
					${(7 * 24 * 60 * 60) / monitor.interval} as expected_pulses_7d,
					(
						SELECT countIf(status = 'up')
						FROM pulses
						WHERE monitor_id = '${monitorId}'
							AND timestamp > now() - INTERVAL 7 DAY
					) as actual_up_pulses
				SELECT (actual_up_pulses * 100.0) / expected_pulses_7d as uptime
			`,
			uptime30d: `
				WITH
					${(30 * 24 * 60 * 60) / monitor.interval} as expected_pulses_30d,
					(
						SELECT countIf(status = 'up')
						FROM pulses
						WHERE monitor_id = '${monitorId}'
							AND timestamp > now() - INTERVAL 30 DAY
					) as actual_up_pulses
				SELECT (actual_up_pulses * 100.0) / expected_pulses_30d as uptime
			`,
			uptime90d: `
				WITH
					${(90 * 24 * 60 * 60) / monitor.interval} as expected_pulses_90d,
					(
						SELECT countIf(status = 'up')
						FROM pulses
						WHERE monitor_id = '${monitorId}'
							AND timestamp > now() - INTERVAL 90 DAY
					) as actual_up_pulses
				SELECT (actual_up_pulses * 100.0) / expected_pulses_90d as uptime
			`,
			uptime365d: `
				WITH
					${(365 * 24 * 60 * 60) / monitor.interval} as expected_pulses_365d,
					(
						SELECT countIf(status = 'up')
						FROM pulses
						WHERE monitor_id = '${monitorId}'
							AND timestamp > now() - INTERVAL 365 DAY
					) as actual_up_pulses
				SELECT (actual_up_pulses * 100.0) / expected_pulses_365d as uptime
			`,
		};

		const [latest, uptime1h, uptime24h, uptime7d, uptime30d, uptime90d, uptime365d] = await Promise.all([
			clickhouse.query({ query: queries.latest, format: "JSONEachRow" }),
			clickhouse.query({ query: queries.uptime1h, format: "JSONEachRow" }),
			clickhouse.query({ query: queries.uptime24h, format: "JSONEachRow" }),
			clickhouse.query({ query: queries.uptime7d, format: "JSONEachRow" }),
			clickhouse.query({ query: queries.uptime30d, format: "JSONEachRow" }),
			clickhouse.query({ query: queries.uptime90d, format: "JSONEachRow" }),
			clickhouse.query({ query: queries.uptime365d, format: "JSONEachRow" }),
		]);

		const latestData = await latest.json<PulseRecord>();
		const uptime1hData = await uptime1h.json<UptimeRecord>();
		const uptime24hData = await uptime24h.json<UptimeRecord>();
		const uptime7dData = await uptime7d.json<UptimeRecord>();
		const uptime30dData = await uptime30d.json<UptimeRecord>();
		const uptime90dData = await uptime90d.json<UptimeRecord>();
		const uptime365dData = await uptime365d.json<UptimeRecord>();

		if (!latestData.length) return;

		const statusData: StatusData = {
			id: monitorId,
			type: "monitor",
			name: monitor.name,
			status: latestData[0]!.status,
			latency: latestData[0]!.latency,
			lastCheck: new Date(latestData[0]!.last_check),
			uptime1h: Math.min(uptime1hData[0]?.uptime || 0, 100),
			uptime24h: Math.min(uptime24hData[0]?.uptime || 0, 100),
			uptime7d: Math.min(uptime7dData[0]?.uptime || 0, 100),
			uptime30d: Math.min(uptime30dData[0]?.uptime || 0, 100),
			uptime90d: Math.min(uptime90dData[0]?.uptime || 0, 100),
			uptime365d: Math.min(uptime365dData[0]?.uptime || 0, 100),
		};

		statusCache.set(monitorId, statusData);

		// Update parent groups
		if (monitor.groupId) {
			await updateGroupStatus(monitor.groupId);
		}
	} catch (err: any) {
		Logger.error("Updating monitor status failed", { monitorId: monitorId, "error.message": err?.message });
	}
}

export async function updateGroupStatus(groupId: string): Promise<void> {
	const group: Group | undefined = config.groups.find((g: Group) => g.id === groupId);
	if (!group) return;

	// Get all children (monitors and subgroups)
	const childMonitors: Monitor[] = config.monitors.filter((m: Monitor) => m.groupId === groupId);
	const childGroups: Group[] = config.groups.filter((g: Group) => g.parentId === groupId);

	let totalUp = 0;
	let totalChildren = 0;
	let totalLatency = 0;
	let latencyCount = 0;

	// Process monitors
	for (const monitor of childMonitors) {
		totalChildren++;
		const status = statusCache.get(monitor.id);
		if (status) {
			if (status.status === "up") totalUp++;
			if (status.latency) {
				totalLatency += status.latency;
				latencyCount++;
			}
		}
	}

	// Process subgroups
	for (const subgroup of childGroups) {
		totalChildren++;
		const status = statusCache.get(subgroup.id);
		if (status) {
			if (status.status === "up") totalUp++;
			if (status.latency) {
				totalLatency += status.latency;
				latencyCount++;
			}
		}
	}

	const strategy = group.strategy || "percentage";
	const avgLatency = latencyCount > 0 ? totalLatency / latencyCount : 0;
	const upPercentage = totalChildren > 0 ? (totalUp / totalChildren) * 100 : 0;

	let status: "up" | "down" | "degraded";

	switch (strategy) {
		case "any-up":
			// If ANY child is up, group is up
			if (totalUp > 0) {
				status = "up";
			} else if (totalChildren === 0) {
				status = "up"; // Empty group
			} else {
				status = "down";
			}
			break;

		case "all-up":
			// ALL children must be up for group to be up
			if (totalChildren === 0) {
				status = "up"; // Empty group
			} else if (totalUp === totalChildren) {
				status = "up";
			} else {
				status = "down";
			}
			break;

		case "percentage":
		default:
			// Percentage-based logic
			if (upPercentage === 100) {
				status = "up";
			} else if (upPercentage >= group.degradedThreshold) {
				status = "degraded";
			} else {
				status = "down";
			}
			break;
	}

	const previousStatus = statusCache.get(groupId)?.status;

	const groupStatus: StatusData = {
		id: groupId,
		type: "group",
		name: group.name,
		status,
		latency: avgLatency,
	};

	statusCache.set(groupId, groupStatus);

	if (previousStatus && previousStatus !== status && group.notificationChannels && group.notificationChannels.length > 0) {
		const notificationManager = new NotificationManager(config.notifications || { channels: {} });

		if (status === "down" || status === "degraded") {
			await notificationManager.sendNotification(group.notificationChannels, {
				type: "down",
				monitorId: groupId,
				monitorName: group.name,
				timestamp: new Date(),
				sourceType: "group",
				groupInfo: {
					strategy: group.strategy,
					childrenUp: totalUp,
					totalChildren,
					upPercentage,
				},
			});
		} else if (status === "up" && (previousStatus === "down" || previousStatus === "degraded")) {
			await notificationManager.sendNotification(group.notificationChannels, {
				type: "recovered",
				monitorId: groupId,
				monitorName: group.name,
				timestamp: new Date(),
				sourceType: "group",
				groupInfo: {
					strategy: group.strategy,
					childrenUp: totalUp,
					totalChildren,
					upPercentage,
				},
			});
		}
	}

	// Update parent group if exists
	if (group.parentId) {
		await updateGroupStatus(group.parentId);
	}
}

export async function getMonitorHistory(monitorId: string, period: string): Promise<HistoryRecord[]> {
	const { interval, intervalMs, range, rangeMs }: IntervalConfig = INTERVALS[period] || INTERVALS["24h"]!;

	const monitor: Monitor | undefined = config.monitors.find((m: Monitor) => m.id === monitorId);
	if (!monitor) return [];

	const expectedPulsesPerInterval = Math.floor(intervalMs / (monitor.interval * 1000));

	const query = `
		WITH
			-- Calculate interval duration in seconds for expected pulse count
			${intervalMs / 1000} AS interval_seconds,
			${monitor.interval} AS check_interval_seconds,
			${expectedPulsesPerInterval} AS expected_pulses,

			-- Get all pulses in the period
			raw_pulses AS (
				SELECT
					toStartOfInterval(timestamp, INTERVAL ${interval}) AS interval_time,
					status,
					latency
				FROM pulses
				WHERE monitor_id = '${monitorId}'
					AND timestamp > now() - INTERVAL ${range}
			),

			-- Aggregate by interval
			interval_data AS (
				SELECT
					interval_time,
					avg(latency) AS avg_latency,
					min(latency) AS min_latency,
					max(latency) AS max_latency,
					countIf(status = 'up') AS up_count,
					count() AS actual_count
				FROM raw_pulses
				GROUP BY interval_time
			),

			-- Generate complete time series
			time_series AS (
				SELECT
					arrayJoin(
							arrayMap(
								x -> toDateTime(toStartOfInterval(now(), INTERVAL ${interval}) - x * interval_seconds),
								range(0, toUInt32(${rangeMs / intervalMs}))
							)
					) AS time
			)

		-- Join time series with data
		SELECT
			ts.time,
			coalesce(d.avg_latency, 0) AS avg_latency,
			coalesce(d.min_latency, 0) AS min_latency,
			coalesce(d.max_latency, 0) AS max_latency,
			-- Calculate uptime with missing pulse detection
			if(d.actual_count IS NULL, 0,
				if(d.actual_count < expected_pulses,
					(d.up_count * 100.0) / expected_pulses,
					(d.up_count * 100.0) / d.actual_count
				)
			) AS uptime
		FROM time_series ts
		LEFT JOIN interval_data d ON d.interval_time = ts.time
		WHERE ts.time > now() - INTERVAL ${range}
			AND ts.time <= now()
		ORDER BY ts.time
	`;

	const result = await clickhouse.query({ query, format: "JSONEachRow" });
	return await result.json<HistoryRecord>();
}
