import { createClient } from "@clickhouse/client";
import { config } from "./config";
import { Logger } from "./logger";
import { EventEmitter } from "events";
import type { Group, HistoryRecord, IntervalConfig, Monitor, PulseRecord, StatusData, UptimeRecord } from "./types";
import { missingPulseDetector } from "./missing-pulse-detector";
import { NotificationManager } from "./notifications";
import { cache } from "./cache";
import { formatDateTimeISOCompact, formatDateTimeISOString } from "./times";

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
					timestamp: formatDateTimeISOCompact(timestamp, { includeMilliseconds: true }),
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
		const monitor: Monitor | undefined = cache.getMonitor(monitorId);
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
			cache.setStatus(monitorId, statusData);
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

		cache.setStatus(monitorId, statusData);

		// Update parent groups
		if (monitor.groupId) {
			await updateGroupStatus(monitor.groupId);
		}
	} catch (err: any) {
		Logger.error("Updating monitor status failed", { monitorId: monitorId, "error.message": err?.message });
	}
}

export async function updateGroupStatus(groupId: string): Promise<void> {
	const group: Group | undefined = cache.getGroup(groupId);
	if (!group) return;

	// Get all children (monitors and subgroups)
	const { monitors: childMonitors, groups: childGroups } = cache.getDirectChildren(groupId);

	let totalUp = 0;
	let totalChildren = 0;
	let totalLatency = 0;
	let latencyCount = 0;

	// Get direct children IDs (both monitors and groups)
	const directChildIds = [...childMonitors.map((m) => m.id), ...childGroups.map((g) => g.id)];

	// Process monitors
	for (const monitor of childMonitors) {
		totalChildren++;
		const status = cache.getStatus(monitor.id);
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
		const status = cache.getStatus(subgroup.id);
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
		calculateGroupUptime(group, directChildIds, "1h"),
		calculateGroupUptime(group, directChildIds, "24h"),
		calculateGroupUptime(group, directChildIds, "7d"),
		calculateGroupUptime(group, directChildIds, "30d"),
		calculateGroupUptime(group, directChildIds, "90d"),
		calculateGroupUptime(group, directChildIds, "365d"),
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

	const previousStatus = cache.getStatus(groupId)?.status;

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

	cache.setStatus(groupId, groupStatus);

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

export async function calculateGroupUptime(group: Group, directChildIds: string[], period: string): Promise<number> {
	if (directChildIds.length === 0) return 100; // Empty group is considered 100% up

	const periodMap: Record<string, number> = {
		"1h": 3600,
		"24h": 86400,
		"7d": 604800,
		"30d": 2592000,
		"90d": 7776000,
		"365d": 31536000,
	};

	const periodSeconds = periodMap[period];
	if (!periodSeconds) return 0;

	const clickhousePeriod = {
		"1h": "1 HOUR",
		"24h": "24 HOUR",
		"7d": "7 DAY",
		"30d": "30 DAY",
		"90d": "90 DAY",
		"365d": "365 DAY",
	}[period];

	const strategy = group.strategy;

	// Separate monitors and groups
	const directMonitorIds = directChildIds.filter((id) => cache.hasMonitor(id));
	const directGroupIds = directChildIds.filter((id) => cache.hasGroup(id));

	// Collect uptimes from all direct children
	const uptimes: number[] = [];

	// Get uptimes from direct child groups (from cache)
	for (const groupId of directGroupIds) {
		const groupStatus = cache.getStatus(groupId);
		if (groupStatus) {
			const uptimeKey = `uptime${period.replace("d", "d").replace("h", "h")}` as keyof StatusData;
			const uptime = groupStatus[uptimeKey];
			if (typeof uptime === "number") {
				uptimes.push(uptime);
			}
		} else {
			uptimes.push(0); // No status means 0% uptime
		}
	}

	// Get uptimes from direct monitors (from database)
	if (directMonitorIds.length > 0) {
		// Calculate monitor uptimes based on the strategy
		let monitorUptime: number = 0;
		let query: string;

		switch (strategy) {
			case "any-up":
				// For any-up with only monitors: at least one monitor must be up in each time interval
				const monitorIntervalsAnyUp = directMonitorIds.map((id) => {
					const monitor = cache.getMonitor(id);
					return { id, interval: monitor?.interval || 30 };
				});

				const minInterval = Math.min(...monitorIntervalsAnyUp.map((m) => m.interval));
				const expectedWindows = Math.floor(periodSeconds / minInterval);

				query = `
					WITH
						monitor_pulses AS (
							SELECT
								monitor_id,
								status,
								timestamp,
								toStartOfInterval(timestamp, INTERVAL ${minInterval} SECOND) AS window_start
							FROM pulses
							WHERE monitor_id IN (${directMonitorIds.map((id) => `'${id}'`).join(",")})
								AND timestamp > now() - INTERVAL ${clickhousePeriod}
								AND status = 'up'
						),
						windows_with_up AS (
							SELECT DISTINCT window_start
							FROM monitor_pulses
						)
					SELECT
						CASE
							WHEN ${expectedWindows} = 0 THEN 100
							ELSE (COUNT(*) * 100.0) / ${expectedWindows}
						END AS uptime
					FROM windows_with_up
				`;
				break;

			case "all-up":
				// For all-up with only monitors: ALL monitors must be up in each time interval
				const monitorIntervalsAllUp = directMonitorIds.map((id) => {
					const monitor = cache.getMonitor(id);
					return { id, interval: monitor?.interval || 30 };
				});

				const minIntervalAllUp = Math.min(...monitorIntervalsAllUp.map((m) => m.interval));
				const expectedWindowsAllUp = Math.floor(periodSeconds / minIntervalAllUp);
				const totalMonitors = directMonitorIds.length;

				query = `
					WITH
						monitor_pulses AS (
							SELECT
								monitor_id,
								status,
								timestamp,
								toStartOfInterval(timestamp, INTERVAL ${minIntervalAllUp} SECOND) AS window_start
							FROM pulses
							WHERE monitor_id IN (${directMonitorIds.map((id) => `'${id}'`).join(",")})
								AND timestamp > now() - INTERVAL ${clickhousePeriod}
						),
						window_monitor_status AS (
							SELECT
								window_start,
								COUNT(DISTINCT CASE WHEN status = 'up' THEN monitor_id END) as monitors_up
							FROM monitor_pulses
							GROUP BY window_start
						),
						windows_all_up AS (
							SELECT window_start
							FROM window_monitor_status
							WHERE monitors_up = ${totalMonitors}
						)
					SELECT
						CASE
							WHEN ${expectedWindowsAllUp} = 0 THEN 100
							ELSE (COUNT(DISTINCT window_start) * 100.0) / ${expectedWindowsAllUp}
						END AS uptime
					FROM windows_all_up
				`;
				break;

			case "percentage":
			default:
				// For percentage with only monitors: calculate weighted average
				const monitorQueriesPerc = directMonitorIds.map((id) => {
					const monitor = cache.getMonitor(id);
					const interval = monitor?.interval || 30;
					const expectedIntervals = Math.floor(periodSeconds / interval);

					return `
						SELECT
							'${id}' as monitor_id,
							${expectedIntervals} as expected_intervals,
							COUNT(DISTINCT window_start) as intervals_with_up,
							CASE
								WHEN ${expectedIntervals} = 0 THEN 100
								ELSE (COUNT(DISTINCT window_start) * 100.0) / ${expectedIntervals}
							END as uptime
						FROM (
							SELECT
								toStartOfInterval(timestamp, INTERVAL ${interval} SECOND) AS window_start
							FROM pulses
							WHERE monitor_id = '${id}'
								AND timestamp > now() - INTERVAL ${clickhousePeriod}
								AND status = 'up'
						)
					`;
				});

				query = `
					WITH monitor_uptimes AS (
						${monitorQueriesPerc.join(" UNION ALL ")}
					)
					SELECT
						CASE
							WHEN SUM(expected_intervals) = 0 THEN 100
							ELSE SUM(uptime * expected_intervals) / SUM(expected_intervals)
						END as uptime
					FROM monitor_uptimes
				`;
				break;
		}

		try {
			const result = await clickhouse.query({ query, format: "JSONEachRow" });
			const data = await result.json<{ uptime: number }>();
			monitorUptime = data[0]?.uptime || 0;
			uptimes.push(monitorUptime);
		} catch (err: any) {
			Logger.error("Failed to calculate monitor uptime", {
				groupId: group.id,
				period,
				strategy,
				"error.message": err?.message,
			});
			uptimes.push(0);
		}
	}

	// Apply the group's strategy to all collected uptimes
	if (uptimes.length === 0) return 100; // No children means 100% up

	switch (strategy) {
		case "any-up":
			return Math.max(...uptimes);
		case "all-up":
			return Math.min(...uptimes);
		case "percentage":
		default:
			return uptimes.reduce((sum, u) => sum + u, 0) / uptimes.length;
	}
}

export async function getMonitorHistory(monitorId: string, period: string): Promise<HistoryRecord[]> {
	const { interval, intervalSec, range, rangeSec }: IntervalConfig = INTERVALS[period] || INTERVALS["24h"]!;

	const monitor: Monitor | undefined = cache.getMonitor(monitorId);
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
		const timeStr = formatDateTimeISOString(time);
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

export async function getGroupHistory(groupId: string, period: string): Promise<HistoryRecord[]> {
	const { interval, intervalSec, range, rangeSec }: IntervalConfig = INTERVALS[period] || INTERVALS["24h"]!;

	const group: Group | undefined = cache.getGroup(groupId);
	if (!group) return [];

	// Get direct children only (monitors and subgroups)
	const { monitors: childMonitors, groups: childGroups } = cache.getDirectChildren(groupId);

	if (childMonitors.length === 0 && childGroups.length === 0) {
		return [];
	}

	// Get history data for all direct child monitors
	const monitorHistoryPromises = childMonitors.map((monitor) => getMonitorHistory(monitor.id, period));

	// Get history data for all direct child groups (recursive)
	const groupHistoryPromises = childGroups.map((childGroup) => getGroupHistory(childGroup.id, period));

	const allHistoryData = await Promise.all([...monitorHistoryPromises, ...groupHistoryPromises]);

	const timeSeriesMap = new Map<
		string,
		{
			avg_latency: number[];
			min_latency: number[];
			max_latency: number[];
			uptimes: { value: number; isMonitor: boolean; monitorInterval?: number }[];
		}
	>();

	// Process all history data and group by timestamp
	allHistoryData.forEach((historyData, index) => {
		const isMonitor = index < childMonitors.length;
		const monitorInterval = isMonitor ? childMonitors[index]?.interval : undefined;

		historyData.forEach((record) => {
			if (!timeSeriesMap.has(record.time)) {
				timeSeriesMap.set(record.time, { avg_latency: [], min_latency: [], max_latency: [], uptimes: [] });
			}

			const entry = timeSeriesMap.get(record.time)!;

			if (record.avg_latency !== null) {
				entry.avg_latency.push(record.avg_latency);
			}

			if (record.min_latency !== null) {
				entry.min_latency.push(record.min_latency);
			}

			if (record.max_latency !== null) {
				entry.max_latency.push(record.max_latency);
			}

			entry.uptimes.push({
				value: record.uptime,
				isMonitor,
				monitorInterval,
			});
		});
	});

	const aggregatedHistory: HistoryRecord[] = [];

	// Generate complete time series
	const now = new Date();
	const startTime = new Date(now.getTime() - rangeSec * 1000);

	for (
		let time = new Date(Math.ceil(startTime.getTime() / (intervalSec * 1000)) * (intervalSec * 1000));
		time <= now;
		time = new Date(time.getTime() + intervalSec * 1000)
	) {
		const timeStr = formatDateTimeISOString(time);
		const data = timeSeriesMap.get(timeStr);

		let minLatency: number | null = null;
		let avgLatency: number | null = null;
		let maxLatency: number | null = null;
		let uptime: number = 0;

		if (data) {
			if (data.avg_latency.length > 0) {
				avgLatency = data.avg_latency.reduce((sum, lat) => sum + lat, 0) / data.avg_latency.length;
			}

			if (data.min_latency.length > 0) {
				minLatency = data.min_latency.reduce((sum, lat) => sum + lat, 0) / data.min_latency.length;
			}

			if (data.max_latency.length > 0) {
				maxLatency = data.max_latency.reduce((sum, lat) => sum + lat, 0) / data.max_latency.length;
			}

			// Calculate uptime based on strategy
			switch (group.strategy) {
				case "any-up":
					uptime = Math.max(...data.uptimes.flatMap((u) => u.value));
					break;

				case "all-up":
					uptime = Math.min(...data.uptimes.flatMap((u) => u.value));
					break;

				case "percentage":
				default:
					// For percentage: weighted average of child uptimes
					if (data.uptimes.length === 0) {
						uptime = 100;
					} else {
						// For monitors, weight by their expected intervals in this time window
						let totalWeight = 0;
						let weightedSum = 0;

						data.uptimes.forEach((uptimeData) => {
							let weight = 1;

							// If it's a monitor, weight by expected intervals
							if (uptimeData.isMonitor && uptimeData.monitorInterval) {
								weight = Math.floor(intervalSec / uptimeData.monitorInterval);
							}

							totalWeight += weight;
							weightedSum += uptimeData.value * weight;
						});

						uptime = totalWeight > 0 ? weightedSum / totalWeight : 0;
					}
					break;
			}
		}

		aggregatedHistory.push({
			time: timeStr,
			avg_latency: avgLatency,
			min_latency: minLatency,
			max_latency: maxLatency,
			uptime: Math.min(Math.max(uptime, 0), 100),
		});
	}

	return aggregatedHistory;
}
