import { createClient } from "@clickhouse/client";
import { config } from "./config";
import { Logger } from "./logger";
import { EventEmitter } from "events";
import type { Group, HistoryRecord, IntervalConfig, Monitor, PulseRecord, StatusData, UptimeRecord } from "./types";
import { missingPulseDetector } from "./missing-pulse-detector";
import { NotificationManager } from "./notifications";
import { cache } from "./cache";
import { formatDateTimeISOCompact, formatDateTimeISOString, GRACE_PERIOD, isInGracePeriod, STARTUP_TIME } from "./times";

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
        latency Nullable(Float32),
        timestamp DateTime64(3)
      ) ENGINE = MergeTree()
      ORDER BY (monitor_id, timestamp)
      PARTITION BY toYYYYMM(timestamp)
			TTL toDateTime(timestamp) + INTERVAL 1 YEAR DELETE
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

export async function storePulse(monitorId: string, latency: number | null): Promise<void> {
	const timestamp = new Date();

	try {
		await clickhouse.insert({
			table: "pulses",
			values: [
				{
					monitor_id: monitorId,
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
	missingPulseDetector.resetMonitor(monitorId);

	// Emit event for real-time updates
	eventEmitter.emit("pulse", { monitorId, status: "up", latency, timestamp });
}

export async function updateMonitorStatus(monitorId: string): Promise<void> {
	try {
		const monitor: Monitor | undefined = cache.getMonitor(monitorId);
		if (!monitor) return;

		const now = Date.now();
		const maxAllowedInterval = monitor.interval * monitor.toleranceFactor * 1000;
		const toleranceSeconds = monitor.interval * monitor.toleranceFactor;

		const generateUptimeQuery = (period: string): string => {
			const periodMap: Record<string, string> = {
				"1h": "1 HOUR",
				"24h": "24 HOUR",
				"7d": "7 DAY",
				"30d": "30 DAY",
				"90d": "90 DAY",
				"365d": "365 DAY",
			};

			const periodSeconds: Record<string, number> = {
				"1h": 3600,
				"24h": 86400,
				"7d": 604800,
				"30d": 2592000,
				"90d": 7776000,
				"365d": 31536000,
			};

			const clickhousePeriod = periodMap[period]!;
			const totalSeconds = periodSeconds[period]!;

			const effectiveSeconds = totalSeconds - toleranceSeconds;
			const expectedIntervals = Math.max(0, Math.floor(effectiveSeconds / monitor.interval));

			return `
				SELECT
					CASE
						WHEN ${expectedIntervals} <= 0 THEN 100
						ELSE (
							COUNT(DISTINCT toStartOfInterval(timestamp, INTERVAL ${monitor.interval} SECOND)) * 100.0 / ${expectedIntervals}
						)
					END AS uptime
				FROM pulses
				WHERE
					monitor_id = '${monitorId}'
					AND timestamp > now() - INTERVAL ${clickhousePeriod}
					AND timestamp <= now() - INTERVAL ${toleranceSeconds} SECOND
			`;
		};

		const queries = {
			latest: `
				SELECT latency, timestamp as last_check
				FROM pulses
				WHERE monitor_id = '${monitorId}'
				ORDER BY timestamp DESC
				LIMIT 1
			`,
			uptime1h: generateUptimeQuery("1h"),
			uptime24h: generateUptimeQuery("24h"),
			uptime7d: generateUptimeQuery("7d"),
			uptime30d: generateUptimeQuery("30d"),
			uptime90d: generateUptimeQuery("90d"),
			uptime365d: generateUptimeQuery("365d"),
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
			Logger.debug("No pulse data found for monitor", {
				monitorId,
				monitorName: monitor.name,
			});
			return;
		}

		const lastCheckTime = new Date(latestData[0]!.last_check + "Z").getTime();
		const timeSinceLastCheck = now - lastCheckTime;

		const status: "up" | "down" = timeSinceLastCheck <= maxAllowedInterval ? "up" : "down";

		const statusData: StatusData = {
			id: monitorId,
			type: "monitor",
			name: monitor.name,
			status,
			latency: latestData[0]!.latency,
			lastCheck: new Date(latestData[0]!.last_check + "Z"),
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
	let totalDown = 0;
	let totalUnknown = 0;
	let totalLatency = 0;
	let latencyCount = 0;

	// Get direct children IDs (both monitors and groups)
	const directChildIds = [...childMonitors.map((m) => m.id), ...childGroups.map((g) => g.id)];

	// Process monitors
	for (const monitor of childMonitors) {
		const status = cache.getStatus(monitor.id);
		if (status) {
			if (status.status === "up") {
				totalUp++;
			} else if (status.status === "down") {
				totalDown++;
			}
			if (status.latency) {
				totalLatency += status.latency;
				latencyCount++;
			}
		} else {
			// No status yet - count as unknown
			totalUnknown++;
		}
	}

	// Process subgroups
	for (const subgroup of childGroups) {
		const status = cache.getStatus(subgroup.id);
		if (status) {
			if (status.status === "up") {
				totalUp++;
			} else if (status.status === "down" || status.status === "degraded") {
				totalDown++;
			}
			if (status.latency) {
				totalLatency += status.latency;
				latencyCount++;
			}
		} else {
			// No status yet - count as unknown
			totalUnknown++;
		}
	}

	const totalKnown = totalUp + totalDown;
	const totalChildren = totalKnown + totalUnknown;

	// Skip update if more than 50% of children have unknown status
	if (totalChildren > 0 && totalUnknown > totalChildren / 2) {
		Logger.debug("Skipping group status update - too many unknown children", {
			groupId,
			groupName: group.name,
			totalUp,
			totalDown,
			totalUnknown,
			totalChildren,
		});
		return;
	}

	// If no known children, skip update
	if (totalKnown === 0) {
		Logger.debug("Skipping group status update - no known children", {
			groupId,
			groupName: group.name,
			totalUnknown,
		});
		return;
	}

	const strategy = group.strategy || "percentage";
	const avgLatency = latencyCount > 0 ? totalLatency / latencyCount : 0;
	const upPercentage = totalKnown > 0 ? (totalUp / totalKnown) * 100 : 0;

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
			} else if (totalKnown === 0) {
				return;
			} else {
				status = "down";
			}
			break;

		case "all-up":
			// ALL children must be up for group to be up
			if (totalChildren === 0) {
				return;
			} else if (totalUp === totalKnown) {
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

	// Don't send notifications during startup grace period
	const isStartup = !previousStatus && totalUnknown > 0;

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

	// Log if we're skipping notifications during grace period
	if (!previousStatus && isInGracePeriod()) {
		Logger.info("Skipping group notifications during grace period", {
			groupId,
			groupName: group.name,
			status,
			gracePeriodRemaining: Math.round((GRACE_PERIOD - (Date.now() - STARTUP_TIME)) / 1000) + "s",
		});
	}

	if (previousStatus && previousStatus !== status && !isInGracePeriod() && group.notificationChannels && group.notificationChannels.length > 0) {
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
					totalChildren: totalKnown,
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
					totalChildren: totalKnown,
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
		let query: string = "";

		switch (strategy) {
			case "any-up":
				// For any-up with only monitors: at least one monitor must be up in each time interval
				const monitorIntervalsAnyUp = directMonitorIds.map((id) => {
					const monitor = cache.getMonitor(id);
					return { id, interval: monitor?.interval || 30, toleranceFactor: monitor?.toleranceFactor || 1.5 };
				});

				const minInterval = Math.min(...monitorIntervalsAnyUp.map((m) => m.interval));
				const maxTolerance = Math.max(...monitorIntervalsAnyUp.map((m) => m.interval * m.toleranceFactor));

				const effectiveSecondsAnyUp = periodSeconds - maxTolerance;
				const expectedWindows = Math.max(0, Math.floor(effectiveSecondsAnyUp / minInterval));

				query = `
					WITH distinct_windows AS (
						SELECT DISTINCT toStartOfInterval(timestamp, INTERVAL ${minInterval} SECOND) AS window_start
						FROM pulses
						WHERE monitor_id IN (${directMonitorIds.map((id) => `'${id}'`).join(",")})
							AND timestamp > now() - INTERVAL ${clickhousePeriod}
							AND timestamp <= now() - INTERVAL ${maxTolerance} SECOND
					)
					SELECT
						CASE
							WHEN ${expectedWindows} = 0 THEN 100
							ELSE (COUNT(*) * 100.0) / ${expectedWindows}
						END AS uptime
					FROM distinct_windows
				`;
				break;

			case "all-up":
				// For all-up with only monitors: ALL monitors must be up in each time interval
				const monitorIntervalsAllUp = directMonitorIds.map((id) => {
					const monitor = cache.getMonitor(id);
					return { id, interval: monitor?.interval || 30, toleranceFactor: monitor?.toleranceFactor || 1.5 };
				});

				const minIntervalAllUp = Math.min(...monitorIntervalsAllUp.map((m) => m.interval));
				const maxToleranceAllUp = Math.max(...monitorIntervalsAllUp.map((m) => m.interval * m.toleranceFactor));

				const effectiveSecondsAllUp = periodSeconds - maxToleranceAllUp;
				const expectedWindowsAllUp = Math.max(0, Math.floor(effectiveSecondsAllUp / minIntervalAllUp));
				const totalMonitors = directMonitorIds.length;

				query = `
					WITH
						monitor_windows AS (
							SELECT
								monitor_id,
								toStartOfInterval(timestamp, INTERVAL ${minIntervalAllUp} SECOND) AS window_start
							FROM pulses
							WHERE monitor_id IN (${directMonitorIds.map((id) => `'${id}'`).join(",")})
								AND timestamp > now() - INTERVAL ${clickhousePeriod}
								AND timestamp <= now() - INTERVAL ${maxToleranceAllUp} SECOND
						),
						window_monitor_counts AS (
							SELECT
								window_start,
								COUNT(DISTINCT monitor_id) as monitors_present
							FROM monitor_windows
							GROUP BY window_start
						),
						complete_windows AS (
							SELECT window_start
							FROM window_monitor_counts
							WHERE monitors_present = ${totalMonitors}
						)
					SELECT
						CASE
							WHEN ${expectedWindowsAllUp} = 0 THEN 100
							ELSE (COUNT(*) * 100.0) / ${expectedWindowsAllUp}
						END AS uptime
					FROM complete_windows
				`;
				break;

			case "percentage":
			default:
				// For percentage with only monitors: calculate weighted average
				const monitorQueries = directMonitorIds.map((id) => {
					const monitor = cache.getMonitor(id);
					const interval = monitor?.interval || 30;
					const toleranceFactor = monitor?.toleranceFactor || 1.5;
					const toleranceSeconds = interval * toleranceFactor;

					// Calculate expected intervals for this specific monitor
					const effectiveSeconds = periodSeconds - toleranceSeconds;
					const expectedIntervals = Math.max(0, Math.floor(effectiveSeconds / interval));

					return `
						SELECT
							'${id}' as monitor_id,
							${expectedIntervals} as expected_intervals,
							CASE
								WHEN ${expectedIntervals} = 0 THEN 100
								ELSE (
									COUNT(DISTINCT toStartOfInterval(timestamp, INTERVAL ${interval} SECOND)) * 100.0 / ${expectedIntervals}
								)
							END as uptime
						FROM pulses
						WHERE monitor_id = '${id}'
							AND timestamp > now() - INTERVAL ${clickhousePeriod}
							AND timestamp <= now() - INTERVAL ${toleranceSeconds} SECOND
					`;
				});

				if (monitorQueries.length === 0) {
					monitorUptime = 100;
				} else {
					query = `
						WITH monitor_uptimes AS (
							${monitorQueries.join(" UNION ALL ")}
						)
						SELECT
							CASE
								WHEN SUM(expected_intervals) = 0 THEN 100
								ELSE SUM(uptime * expected_intervals) / SUM(expected_intervals)
							END as uptime
						FROM monitor_uptimes
					`;
				}
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

	const toleranceSeconds = monitor.interval * monitor.toleranceFactor;
	const intervalsPerWindow = Math.floor(intervalSec / monitor.interval);

	const rawQuery = `
		WITH
			-- Get all time windows in the period
			time_windows AS (
				SELECT toStartOfInterval(
					now() - INTERVAL ${rangeSec} SECOND + INTERVAL number * ${intervalSec} SECOND,
					INTERVAL ${interval}
				) AS window_start
				FROM numbers(0, ${Math.ceil(rangeSec / intervalSec)})
				WHERE window_start <= now() - INTERVAL ${toleranceSeconds} SECOND
			),
			-- Get pulse data aggregated by monitor interval within each time window
			pulse_data AS (
				SELECT
					toStartOfInterval(timestamp, INTERVAL ${interval}) AS window_start,
					toStartOfInterval(timestamp, INTERVAL ${monitor.interval} SECOND) AS monitor_interval,
					avg(latency) AS avg_latency,
					min(latency) AS min_latency,
					max(latency) AS max_latency
				FROM pulses
				WHERE
					monitor_id = '${monitorId}'
					AND timestamp > now() - INTERVAL ${range}
					AND timestamp <= now() - INTERVAL ${toleranceSeconds} SECOND
				GROUP BY window_start, monitor_interval
			),
			-- Aggregate by time window
			window_aggregates AS (
				SELECT
					window_start,
					avg(avg_latency) AS avg_latency,
					min(min_latency) AS min_latency,
					max(max_latency) AS max_latency,
					COUNT(DISTINCT monitor_interval) AS intervals_with_pulses
				FROM pulse_data
				GROUP BY window_start
			)
		SELECT
			formatDateTime(tw.window_start, '%Y-%m-%dT%H:%i:%sZ') AS time,
			wa.avg_latency,
			wa.min_latency,
			wa.max_latency,
			CASE
				-- If this window is in the future or within tolerance, return 100
				WHEN tw.window_start > now() - INTERVAL ${toleranceSeconds} SECOND THEN 100
				-- If we're looking at a window that should have data
				WHEN tw.window_start <= now() - INTERVAL ${toleranceSeconds} SECOND THEN
					CASE
						WHEN ${intervalsPerWindow} = 0 THEN 100
						ELSE (COALESCE(wa.intervals_with_pulses, 0) * 100.0) / ${intervalsPerWindow}
					END
				ELSE 100
			END AS uptime
		FROM time_windows tw
		LEFT JOIN window_aggregates wa ON tw.window_start = wa.window_start
		ORDER BY tw.window_start
	`;

	const rawResult = await clickhouse.query({ query: rawQuery, format: "JSONEachRow" });
	const rawData = await rawResult.json<HistoryRecord>();

	// Filter out any future windows that might have been included
	const now = new Date();
	return rawData.filter((record) => new Date(record.time) <= now);
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
