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
		interval: "1 MINUTE",
		intervalSec: 60,
		range: "1 HOUR",
		rangeSec: 3600,
	},
	"24h": {
		interval: "10 MINUTE",
		intervalSec: 600,
		range: "24 HOUR",
		rangeSec: 86400,
	},
	"7d": {
		interval: "1 HOUR",
		intervalSec: 3600,
		range: "7 DAY",
		rangeSec: 604800,
	},
	"30d": {
		interval: "1 DAY",
		intervalSec: 86400,
		range: "30 DAY",
		rangeSec: 2592000,
	},
	"90d": {
		interval: "1 DAY",
		intervalSec: 86400,
		range: "90 DAY",
		rangeSec: 7776000,
	},
	"365d": {
		interval: "1 DAY",
		intervalSec: 86400,
		range: "1 YEAR",
		rangeSec: 31536000,
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
				SELECT
					(countIf(is_up) / ${Math.floor(3600 / monitor.interval)}.0) * 100 AS uptime
				FROM (
					SELECT
						toStartOfInterval(timestamp, INTERVAL ${monitor.interval} SECOND) AS window_start,
						max(status = 'up') AS is_up
					FROM pulses
					WHERE
						monitor_id = '${monitorId}'
						AND timestamp > now() - INTERVAL 1 HOUR
					GROUP BY window_start
				)
			`,
			uptime24h: `
				SELECT
					(countIf(is_up) / ${Math.floor(86400 / monitor.interval)}.0) * 100 AS uptime
				FROM (
					SELECT
						toStartOfInterval(timestamp, INTERVAL ${monitor.interval} SECOND) AS window_start,
						max(status = 'up') AS is_up
					FROM pulses
					WHERE
						monitor_id = '${monitorId}'
						AND timestamp > now() - INTERVAL 24 HOUR
					GROUP BY window_start
				)
			`,
			uptime7d: `
				SELECT
					(countIf(is_up) / ${Math.floor(604800 / monitor.interval)}.0) * 100 AS uptime
				FROM (
					SELECT
						toStartOfInterval(timestamp, INTERVAL ${monitor.interval} SECOND) AS window_start,
						max(status = 'up') AS is_up
					FROM pulses
					WHERE
						monitor_id = '${monitorId}'
						AND timestamp > now() - INTERVAL 7 DAY
					GROUP BY window_start
				)
			`,
			uptime30d: `
				SELECT
					(countIf(is_up) / ${Math.floor(2592000 / monitor.interval)}.0) * 100 AS uptime
				FROM (
					SELECT
						toStartOfInterval(timestamp, INTERVAL ${monitor.interval} SECOND) AS window_start,
						max(status = 'up') AS is_up
					FROM pulses
					WHERE
						monitor_id = '${monitorId}'
						AND timestamp > now() - INTERVAL 30 DAY
					GROUP BY window_start
				)
			`,
			uptime90d: `
				SELECT
					(countIf(is_up) / ${Math.floor(7776000 / monitor.interval)}.0) * 100 AS uptime
				FROM (
					SELECT
						toStartOfInterval(timestamp, INTERVAL ${monitor.interval} SECOND) AS window_start,
						max(status = 'up') AS is_up
					FROM pulses
					WHERE
						monitor_id = '${monitorId}'
						AND timestamp > now() - INTERVAL 90 DAY
					GROUP BY window_start
				)
			`,
			uptime365d: `
				SELECT
					(countIf(is_up) / ${Math.floor(31536000 / monitor.interval)}.0) * 100 AS uptime
				FROM (
					SELECT
						toStartOfInterval(timestamp, INTERVAL ${monitor.interval} SECOND) AS window_start,
						max(status = 'up') AS is_up
					FROM pulses
					WHERE
						monitor_id = '${monitorId}'
						AND timestamp > now() - INTERVAL 365 DAY
					GROUP BY window_start
				)
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

		if (!latestData.length) {
			const statusData: StatusData = {
				id: monitorId,
				type: "monitor",
				name: monitor.name,
				status: "down",
				latency: 0,
				lastCheck: new Date(),
				uptime1h: 0,
				uptime24h: 0,
				uptime7d: 0,
				uptime30d: 0,
				uptime90d: 0,
				uptime365d: 0,
			};
			statusCache.set(monitorId, statusData);
			return;
		}

		const statusData: StatusData = {
			id: monitorId,
			type: "monitor",
			name: monitor.name,
			status: latestData[0]!.status,
			latency: latestData[0]!.latency,
			lastCheck: new Date(latestData[0]!.last_check),
			uptime1h: uptime1hData[0]?.uptime || 0,
			uptime24h: uptime24hData[0]?.uptime || 0,
			uptime7d: uptime7dData[0]?.uptime || 0,
			uptime30d: uptime30dData[0]?.uptime || 0,
			uptime90d: uptime90dData[0]?.uptime || 0,
			uptime365d: uptime365dData[0]?.uptime || 0,
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

	const getAllMonitorIds = (gId: string): string[] => {
		const monitors = config.monitors.filter((m) => m.groupId === gId).map((m) => m.id);
		const subgroups = config.groups.filter((g) => g.parentId === gId);
		const subgroupMonitors = subgroups.flatMap((sg) => getAllMonitorIds(sg.id));
		return [...monitors, ...subgroupMonitors];
	};

	const allMonitorIds = getAllMonitorIds(groupId);

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

	const [uptime1h, uptime24h, uptime7d, uptime30d, uptime90d, uptime365d] = await Promise.all([
		calculateGroupUptime(group, allMonitorIds, "1h"),
		calculateGroupUptime(group, allMonitorIds, "24h"),
		calculateGroupUptime(group, allMonitorIds, "7d"),
		calculateGroupUptime(group, allMonitorIds, "30d"),
		calculateGroupUptime(group, allMonitorIds, "90d"),
		calculateGroupUptime(group, allMonitorIds, "365d"),
	]);

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
		lastCheck: new Date(),
		uptime1h: Math.min(uptime1h, 100),
		uptime24h: Math.min(uptime24h, 100),
		uptime7d: Math.min(uptime7d, 100),
		uptime30d: Math.min(uptime30d, 100),
		uptime90d: Math.min(uptime90d, 100),
		uptime365d: Math.min(uptime365d, 100),
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

export async function calculateGroupUptime(group: Group, childMonitorIds: string[], period: string): Promise<number> {
	if (childMonitorIds.length === 0) return 100; // Empty group is considered 100% up

	const periodMap: Record<string, string> = {
		"1h": "1 HOUR",
		"24h": "24 HOUR",
		"7d": "7 DAY",
		"30d": "30 DAY",
		"90d": "90 DAY",
		"365d": "365 DAY",
	};

	const clickhousePeriod = periodMap[period];
	if (!clickhousePeriod) return 0;

	const intervalSeconds = group.interval;
	const toleranceFactor = group.toleranceFactor;
	const strategy = group.strategy;

	let query: string;

	switch (strategy) {
		case "any-up":
			// For any-up: at least one monitor must be up in each time interval
			query = `
				WITH
					${intervalSeconds} AS check_interval,
					${toleranceFactor} AS tolerance,
					toStartOfInterval(now() - INTERVAL ${clickhousePeriod}, INTERVAL ${intervalSeconds} SECOND) AS period_start,
					now() AS period_end,

					-- Get all time slots in the period
					time_slots AS (
						SELECT
							toUInt64(number) AS slot_number,
							period_start + (number * check_interval) AS slot_start,
							period_start + ((number + 1) * check_interval) AS slot_end
						FROM numbers(
							toUInt32(greatest(1, (period_end - period_start) / check_interval))
						)
					),

					-- Get pulses and determine which slot they belong to
					pulses_in_slots AS (
						SELECT
							toUInt64(greatest(0, floor((timestamp - period_start) / check_interval))) AS slot_number,
							monitor_id,
							status,
							timestamp
						FROM pulses
						WHERE monitor_id IN (${childMonitorIds.map((id) => `'${id}'`).join(",")})
							AND timestamp >= period_start - INTERVAL ${Math.ceil(intervalSeconds * toleranceFactor)} SECOND
							AND timestamp <= period_end + INTERVAL ${Math.ceil(intervalSeconds * toleranceFactor)} SECOND
							AND timestamp >= period_start  -- Ensure no negative slot numbers
					),

					-- Account for tolerance by also including adjacent slots
					expanded_pulses AS (
						SELECT DISTINCT
							slot_number AS original_slot,
							toUInt64(greatest(0, toInt64(slot_number) + offset)) AS effective_slot,
							monitor_id,
							status
						FROM pulses_in_slots
						CROSS JOIN (
							SELECT -1 AS offset UNION ALL SELECT 0 UNION ALL SELECT 1
						) offsets
						WHERE status = 'up'
							AND toInt64(slot_number) + offset >= 0
							AND toUInt64(toInt64(slot_number) + offset) < (SELECT COUNT(*) FROM time_slots)
					),

					-- Count slots with at least one up monitor
					slots_with_up AS (
						SELECT COUNT(DISTINCT effective_slot) AS up_slots
						FROM expanded_pulses
					)

				SELECT
					CASE
						WHEN (SELECT COUNT(*) FROM time_slots) = 0 THEN 100
						ELSE (up_slots * 100.0) / (SELECT COUNT(*) FROM time_slots)
					END AS uptime
				FROM slots_with_up
			`;
			break;

		case "all-up":
			// For all-up: all monitors must be up in each time interval
			query = `
				WITH
					${intervalSeconds} AS check_interval,
					${toleranceFactor} AS tolerance,
					${childMonitorIds.length} AS total_monitors,
					toStartOfInterval(now() - INTERVAL ${clickhousePeriod}, INTERVAL ${intervalSeconds} SECOND) AS period_start,
					now() AS period_end,

					-- Get all time slots in the period
					time_slots AS (
						SELECT
							toUInt64(number) AS slot_number,
							period_start + (number * check_interval) AS slot_start,
							period_start + ((number + 1) * check_interval) AS slot_end
						FROM numbers(
							toUInt32(greatest(1, (period_end - period_start) / check_interval))
						)
					),

					-- Get pulses and determine which slot they belong to
					pulses_in_slots AS (
						SELECT
							toUInt64(greatest(0, floor((timestamp - period_start) / check_interval))) AS slot_number,
							monitor_id,
							status,
							timestamp
						FROM pulses
						WHERE monitor_id IN (${childMonitorIds.map((id) => `'${id}'`).join(",")})
							AND timestamp >= period_start - INTERVAL ${Math.ceil(intervalSeconds * toleranceFactor)} SECOND
							AND timestamp <= period_end + INTERVAL ${Math.ceil(intervalSeconds * toleranceFactor)} SECOND
							AND timestamp >= period_start  -- Ensure no negative slot numbers
					),

					-- Account for tolerance by also including adjacent slots
					expanded_pulses AS (
						SELECT DISTINCT
							slot_number AS original_slot,
							toUInt64(greatest(0, toInt64(slot_number) + offset)) AS effective_slot,
							monitor_id,
							status
						FROM pulses_in_slots
						CROSS JOIN (
							SELECT -1 AS offset UNION ALL SELECT 0 UNION ALL SELECT 1
						) offsets
						WHERE status = 'up'
							AND toInt64(slot_number) + offset >= 0
							AND toUInt64(toInt64(slot_number) + offset) < (SELECT COUNT(*) FROM time_slots)
					),

					-- Count monitors up per slot
					monitors_per_slot AS (
						SELECT
							effective_slot,
							COUNT(DISTINCT monitor_id) AS monitors_up
						FROM expanded_pulses
						GROUP BY effective_slot
					),

					-- Join with all slots to include empty ones
					all_slots_status AS (
						SELECT
							ts.slot_number,
							COALESCE(mps.monitors_up, 0) AS monitors_up
						FROM time_slots ts
						LEFT JOIN monitors_per_slot mps ON ts.slot_number = mps.effective_slot
					)

				SELECT
					CASE
						WHEN COUNT(*) = 0 THEN 100
						ELSE (countIf(monitors_up = total_monitors) * 100.0) / COUNT(*)
					END AS uptime
				FROM all_slots_status
			`;
			break;

		case "percentage":
		default:
			// For percentage: calculate weighted average of individual monitor uptimes
			// This considers each monitor's own interval for more accurate calculation
			const monitorConfigs = childMonitorIds.map((id) => {
				const monitor = config.monitors.find((m) => m.id === id);
				const monitorInterval = monitor?.interval || 30;
				const periodSeconds = periodMap[period] ? { "1h": 3600, "24h": 86400, "7d": 604800, "30d": 2592000, "90d": 7776000, "365d": 31536000 }[period] : 86400;
				const expectedPulses = Math.floor(periodSeconds! / monitorInterval);
				return { id, expectedPulses };
			});

			const monitorConfigQuery = monitorConfigs
				.map(({ id, expectedPulses }) => `SELECT '${id}' as monitor_id, ${expectedPulses} as expected_pulses`)
				.join(" UNION ALL ");

			query = `
				WITH
					monitor_configs AS (
						${monitorConfigQuery}
					),
					monitor_uptimes AS (
						SELECT
							mc.monitor_id,
							mc.expected_pulses,
							COUNT(p.status) as actual_pulses,
							countIf(p.status = 'up') as up_pulses,
							CASE
								WHEN COUNT(p.status) = 0 THEN 0
								WHEN COUNT(p.status) < mc.expected_pulses THEN
									(countIf(p.status = 'up') * 100.0) / mc.expected_pulses
								ELSE
									(countIf(p.status = 'up') * 100.0) / COUNT(p.status)
							END as uptime
						FROM monitor_configs mc
						LEFT JOIN pulses p ON p.monitor_id = mc.monitor_id
							AND p.timestamp > now() - INTERVAL ${clickhousePeriod}
						GROUP BY mc.monitor_id, mc.expected_pulses
					)
				SELECT
					CASE
						WHEN SUM(expected_pulses) = 0 THEN 0
						ELSE SUM(uptime * expected_pulses) / SUM(expected_pulses)
					END AS uptime
				FROM monitor_uptimes
			`;
			break;
	}

	try {
		const result = await clickhouse.query({ query, format: "JSONEachRow" });
		const data = await result.json<{ uptime: number }>();
		return data[0]?.uptime || 0;
	} catch (err: any) {
		Logger.error("Failed to calculate group uptime", {
			groupId: group.id,
			period,
			strategy,
			"error.message": err?.message,
		});
		return 0;
	}
}

export async function getMonitorHistory(monitorId: string, period: string): Promise<HistoryRecord[]> {
	const { interval, intervalSec, range, rangeSec }: IntervalConfig = INTERVALS[period] || INTERVALS["24h"]!;

	const monitor: Monitor | undefined = config.monitors.find((m: Monitor) => m.id === monitorId);
	if (!monitor) return [];

	const rawQuery = `
		SELECT
			formatDateTime(toStartOfInterval(window_start, INTERVAL ${interval}), '%Y-%m-%dT%H:%i:%sZ') AS time,
			avg(avg_latency) AS avg_latency,
			min(min_latency) AS min_latency,
			max(max_latency) AS max_latency,
			(countIf(is_up) / ${Math.floor(intervalSec / monitor.interval)}.0) * 100 AS uptime
		FROM (
			SELECT
				toStartOfInterval(timestamp, INTERVAL ${monitor.interval} SECOND) AS window_start,
				max(status = 'up') AS is_up,
				avg(latency) AS avg_latency,
				min(latency) AS min_latency,
				max(latency) AS max_latency
			FROM pulses
			WHERE
				monitor_id = '${monitorId}'
				AND timestamp > now() - INTERVAL ${range}
			GROUP BY window_start
		)
		GROUP BY time
		ORDER BY time
	`;

	const rawResult = await clickhouse.query({ query: rawQuery, format: "JSONEachRow" });
	const rawData = await rawResult.json<HistoryRecord>();

	// Generate complete time series
	const now = new Date();
	const startTime = new Date(now.getTime() - rangeSec * 1000);
	const completeSeries: HistoryRecord[] = [];

	const dataMap = new Map<string, HistoryRecord>();
	rawData.forEach((item) => {
		dataMap.set(item.time, item);
	});

	for (
		let time = new Date(Math.ceil(startTime.getTime() / (intervalSec * 1000)) * (intervalSec * 1000));
		time <= now;
		time = new Date(time.getTime() + intervalSec * 1000)
	) {
		const timeStr = time.toISOString().replace(/\.\d+Z$/, "Z");
		const existingData = dataMap.get(timeStr);

		completeSeries.push({
			time: timeStr,
			avg_latency: existingData?.avg_latency ?? null,
			min_latency: existingData?.min_latency ?? null,
			max_latency: existingData?.max_latency ?? null,
			uptime: existingData?.uptime ?? 0,
		});
	}

	return completeSeries;
}
