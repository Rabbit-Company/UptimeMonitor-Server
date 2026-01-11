import { createClient } from "@clickhouse/client";
import { config } from "./config";
import { Logger } from "./logger";
import { EventEmitter } from "events";
import type { PulseRaw, PulseHourly, PulseDaily, StatusData } from "./types";
import { missingPulseDetector } from "./missing-pulse-detector";
import { NotificationManager } from "./notifications";
import { cache } from "./cache";
import { formatDateTimeISOCompact, isInGracePeriod } from "./times";

export const eventEmitter = new EventEmitter();
export const updateQueue = new Set<string>();
export const BATCH_INTERVAL = 5000; // 5 seconds

export const clickhouse = createClient(config.clickhouse);

export async function initClickHouse(): Promise<void> {
	try {
		// Raw pulses - kept for 1 day
		await clickhouse.exec({
			query: `
				CREATE TABLE IF NOT EXISTS pulses (
					monitor_id LowCardinality(String),
					timestamp DateTime64(3),
					latency Nullable(Float32),
					synthetic Boolean DEFAULT false
				) ENGINE = MergeTree()
				ORDER BY (monitor_id, timestamp)
				PARTITION BY toYYYYMMDD(timestamp)
				TTL toDateTime(timestamp) + INTERVAL 1 DAY DELETE
				SETTINGS index_granularity = 8192
			`,
		});

		// Hourly aggregates - kept for 90 days
		await clickhouse.exec({
			query: `
				CREATE TABLE IF NOT EXISTS pulses_hourly (
					monitor_id LowCardinality(String),
					timestamp DateTime('UTC'),
					uptime Float32,
					latency_min Nullable(Float32),
					latency_max Nullable(Float32),
					latency_avg Nullable(Float32)
				) ENGINE = MergeTree()
				ORDER BY (monitor_id, timestamp)
				PARTITION BY toYYYYMM(timestamp)
				TTL timestamp + INTERVAL 90 DAY DELETE
				SETTINGS index_granularity = 8192
			`,
		});

		// Daily aggregates - kept forever
		await clickhouse.exec({
			query: `
				CREATE TABLE IF NOT EXISTS pulses_daily (
					monitor_id LowCardinality(String),
					timestamp Date,
					uptime Float32,
					latency_min Nullable(Float32),
					latency_max Nullable(Float32),
					latency_avg Nullable(Float32)
				) ENGINE = MergeTree()
				ORDER BY (monitor_id, timestamp)
				PARTITION BY toYear(timestamp)
				SETTINGS index_granularity = 8192
			`,
		});

		Logger.info("ClickHouse tables initialized");
	} catch (err: any) {
		Logger.error("ClickHouse initialization failed", { "error.message": err?.message });
	}
}

// Batch update interval
setInterval(async () => {
	const monitors = [...updateQueue];
	updateQueue.clear();
	await Promise.all(monitors.map(updateMonitorStatus));
}, BATCH_INTERVAL);

export async function storePulse(monitorId: string, latency: number | null, timestamp: Date, synthetic: boolean = false): Promise<void> {
	try {
		await clickhouse.insert({
			table: "pulses",
			values: [{ monitor_id: monitorId, latency, timestamp: formatDateTimeISOCompact(timestamp, { includeMilliseconds: true }), synthetic }],
			format: "JSONEachRow",
		});
	} catch (err: any) {
		Logger.error("Storing pulse failed", { monitorId, "error.message": err?.message });
	}

	if (synthetic) return;

	updateQueue.add(monitorId);
	missingPulseDetector.resetMonitor(monitorId);
	eventEmitter.emit("pulse", { monitorId, status: "up", latency, timestamp });
}

/**
 * Get raw pulses aggregated per-interval for a monitor (last ~24h due to TTL)
 * Computes uptime and latency stats in real-time.
 * Output interval is the larger of: monitor interval or 60 seconds (to reduce data volume)
 * Uptime = (pulses received / expected pulses per output interval) * 100
 */
export async function getMonitorHistoryRaw(monitorId: string): Promise<PulseRaw[]> {
	const monitor = cache.getMonitor(monitorId);
	if (!monitor) return [];

	const monitorInterval = monitor.interval;
	const outputInterval = Math.max(monitorInterval, 60);
	const expectedPulsesPerInterval = outputInterval / monitorInterval;

	try {
		// Get the timestamp of first pulse
		const firstPulseQuery = `
			SELECT
				timestamp AS first_pulse
			FROM pulses
			WHERE monitor_id = {monitorId:String}
			ORDER BY timestamp ASC
			LIMIT 1;
		`;

		const firstPulseResult = await clickhouse.query({
			query: firstPulseQuery,
			query_params: { monitorId },
			format: "JSONEachRow",
		});
		const firstPulseData = await firstPulseResult.json<{ first_pulse: string | null }>();

		if (!firstPulseData[0]?.first_pulse) {
			return []; // No pulses yet
		}

		// Calculate interval boundaries
		const firstPulse = new Date(new Date(firstPulseData[0].first_pulse).getTime() + outputInterval * 1000);
		const lastPulse = new Date(Date.now() - outputInterval * 1000);

		if (firstPulse.getFullYear() < 2000) {
			return []; // No pulses yet
		}

		// Align to interval boundaries
		const startInterval = new Date(Math.floor(firstPulse.getTime() / (outputInterval * 1000)) * outputInterval * 1000);
		const endInterval = new Date(Math.floor(lastPulse.getTime() / (outputInterval * 1000)) * outputInterval * 1000);

		const intervalsToGenerate = Math.floor((endInterval.getTime() - startInterval.getTime()) / (outputInterval * 1000)) + 1;

		if (intervalsToGenerate <= 0) {
			return [];
		}

		const startIntervalFormatted = formatDateTimeISOCompact(startInterval);

		// Generate all intervals and join with pulse stats
		// Count DISTINCT monitor intervals that have pulses, then calculate uptime percentage
		const query = `
			WITH
				-- Generate all output intervals
				all_intervals AS (
					SELECT toStartOfInterval(
						toDateTime('${startIntervalFormatted}') + INTERVAL number * ${outputInterval} SECOND,
						INTERVAL ${outputInterval} SECOND
					) AS interval_start
					FROM numbers(0, ${intervalsToGenerate})
				),
				-- Aggregate pulse data per output interval
				-- Count distinct monitor intervals that received at least one pulse
				pulse_stats AS (
					SELECT
						toStartOfInterval(timestamp, INTERVAL ${outputInterval} SECOND) AS interval_start,
						COUNT(DISTINCT toStartOfInterval(timestamp, INTERVAL ${monitorInterval} SECOND)) AS distinct_monitor_intervals,
						min(latency) AS latency_min,
						max(latency) AS latency_max,
						avg(latency) AS latency_avg
					FROM pulses
					WHERE monitor_id = {monitorId:String}
						AND timestamp >= toDateTime('${startIntervalFormatted}')
						AND timestamp < toDateTime('${startIntervalFormatted}') + INTERVAL ${intervalsToGenerate * outputInterval} SECOND
					GROUP BY interval_start
				)
			SELECT
				formatDateTime(ai.interval_start, '%Y-%m-%dT%H:%i:%sZ') AS timestamp,
				COALESCE(LEAST(100, ps.distinct_monitor_intervals * 100.0 / ${expectedPulsesPerInterval}), 0) AS uptime,
				ps.latency_min AS latency_min,
				ps.latency_max AS latency_max,
				ps.latency_avg AS latency_avg
			FROM all_intervals ai
			LEFT JOIN pulse_stats ps ON ai.interval_start = ps.interval_start
			ORDER BY ai.interval_start ASC
		`;

		const result = await clickhouse.query({
			query,
			query_params: { monitorId },
			format: "JSONEachRow",
		});
		return result.json<PulseRaw>();
	} catch (err: any) {
		Logger.error("getMonitorHistoryRaw failed", { monitorId, "error.message": err?.message });
		return [];
	}
}

/**
 * Get all hourly aggregates for a monitor (last ~90 days due to TTL)
 */
export async function getMonitorHistoryHourly(monitorId: string): Promise<PulseHourly[]> {
	const query = `
		SELECT
			formatDateTime(timestamp, '%Y-%m-%dT%H:00:00Z') AS timestamp,
			uptime,
			latency_min,
			latency_max,
			latency_avg
		FROM pulses_hourly
		WHERE monitor_id = {monitorId:String}
		ORDER BY timestamp ASC
	`;

	try {
		const result = await clickhouse.query({
			query,
			query_params: { monitorId },
			format: "JSONEachRow",
		});
		return result.json<PulseHourly>();
	} catch (err: any) {
		Logger.error("getMonitorHistoryHourly failed", { monitorId, "error.message": err?.message });
		return [];
	}
}

/**
 * Get all daily aggregates for a monitor (all time)
 */
export async function getMonitorHistoryDaily(monitorId: string): Promise<PulseDaily[]> {
	const query = `
		SELECT
			toString(timestamp) AS timestamp,
			uptime,
			latency_min,
			latency_max,
			latency_avg
		FROM pulses_daily
		WHERE monitor_id = {monitorId:String}
		ORDER BY timestamp ASC
	`;

	try {
		const result = await clickhouse.query({
			query,
			query_params: { monitorId },
			format: "JSONEachRow",
		});
		return result.json<PulseDaily>();
	} catch (err: any) {
		Logger.error("getMonitorHistoryDaily failed", { monitorId, "error.message": err?.message });
		return [];
	}
}

export async function updateMonitorStatus(monitorId: string): Promise<void> {
	try {
		const monitor = cache.getMonitor(monitorId);
		if (!monitor) return;

		const now = Date.now();
		const maxAllowedInterval = monitor.interval * 1000;
		const prevStatus = cache.getStatus(monitorId);

		// Get first pulse date
		let firstPulse = prevStatus?.firstPulse;
		if (!firstPulse) {
			const query = `
				SELECT MIN(ts) AS first_pulse FROM (
					SELECT MIN(timestamp) AS ts FROM pulses WHERE monitor_id = {monitorId:String}
					UNION ALL
					SELECT MIN(toDateTime(timestamp)) AS ts FROM pulses_daily WHERE monitor_id = {monitorId:String}
				)
			`;
			const result = await clickhouse.query({ query, query_params: { monitorId }, format: "JSONEachRow" });
			const data = await result.json<{ first_pulse: string | null }>();
			if (data[0]?.first_pulse) firstPulse = new Date(data[0].first_pulse);
		}

		// Get latest pulse
		const latestQuery = `
			SELECT latency, timestamp AS last_check
			FROM pulses
			WHERE monitor_id = {monitorId:String}
			ORDER BY timestamp DESC
			LIMIT 1
		`;
		const latestResult = await clickhouse.query({ query: latestQuery, query_params: { monitorId }, format: "JSONEachRow" });
		const latestData = await latestResult.json<{ latency: number | null; last_check: string }>();

		if (!latestData.length) {
			const statusData: StatusData = {
				id: monitorId,
				type: "monitor",
				name: monitor.name,
				status: "down",
				latency: 0,
				lastCheck: new Date(0),
				uptime1h: 0,
				uptime24h: 0,
				uptime7d: 0,
				uptime30d: 0,
				uptime90d: 0,
				uptime365d: 0,
			};
			cache.setStatus(monitorId, statusData);

			if (monitor.groupId) {
				await updateGroupStatus(monitor.groupId);
			}
			return;
		}

		const lastCheckTime = new Date(latestData[0]!.last_check + "Z").getTime();
		const timeSinceLastCheck = now - lastCheckTime;
		const status: "up" | "down" = timeSinceLastCheck <= maxAllowedInterval ? "up" : "down";

		// Calculate uptimes
		const uptimes = await calculateUptimes(monitorId, monitor.interval, firstPulse);

		const statusData: StatusData = {
			id: monitorId,
			type: "monitor",
			name: monitor.name,
			status,
			latency: latestData[0]!.latency ?? 0,
			firstPulse,
			lastCheck: new Date(latestData[0]!.last_check + "Z"),
			...uptimes,
		};

		cache.setStatus(monitorId, statusData);

		if (monitor.groupId) {
			await updateGroupStatus(monitor.groupId);
		}
	} catch (err: any) {
		Logger.error("updateMonitorStatus failed", { monitorId, "error.message": err?.message });
	}
}

async function calculateUptimes(
	monitorId: string,
	interval: number,
	firstPulse: Date | undefined
): Promise<{ uptime1h: number; uptime24h: number; uptime7d: number; uptime30d: number; uptime90d: number; uptime365d: number }> {
	const pulseDate = firstPulse ? formatDateTimeISOCompact(firstPulse) : "2001-10-15 00:00:00";

	// Uptime = (distinct intervals with at least 1 pulse / expected intervals) * 100
	// We count DISTINCT intervals, so multiple pulses in same interval = 1 "up" interval
	const uptimeQuery = (period: string) => `
		WITH
			time_range AS (
				SELECT
					GREATEST(toDateTime('${pulseDate}'), now() - INTERVAL ${period}) AS start_time,
					now() AS end_time
			),
			expected AS (
				SELECT floor((toUnixTimestamp(end_time) - toUnixTimestamp(start_time)) / ${interval}) AS cnt FROM time_range
			),
			actual AS (
				SELECT COUNT(DISTINCT toStartOfInterval(timestamp, INTERVAL ${interval} SECOND)) AS cnt
				FROM pulses, time_range
				WHERE monitor_id = {monitorId:String} AND timestamp >= start_time AND timestamp < end_time
			)
		SELECT CASE WHEN (SELECT cnt FROM expected) = 0 THEN 100 ELSE LEAST(100, (SELECT cnt FROM actual) * 100.0 / (SELECT cnt FROM expected)) END AS uptime
	`;

	try {
		const [u1h, u24h, u7d, u30d, u90d, u365d] = await Promise.all([
			clickhouse.query({ query: uptimeQuery("1 HOUR"), query_params: { monitorId }, format: "JSONEachRow" }),
			clickhouse.query({ query: uptimeQuery("24 HOUR"), query_params: { monitorId }, format: "JSONEachRow" }),
			clickhouse.query({ query: uptimeQuery("7 DAY"), query_params: { monitorId }, format: "JSONEachRow" }),
			clickhouse.query({ query: uptimeQuery("30 DAY"), query_params: { monitorId }, format: "JSONEachRow" }),
			clickhouse.query({ query: uptimeQuery("90 DAY"), query_params: { monitorId }, format: "JSONEachRow" }),
			clickhouse.query({ query: uptimeQuery("365 DAY"), query_params: { monitorId }, format: "JSONEachRow" }),
		]);

		const parse = async (r: any) => ((await r.json()) as { uptime: number }[])[0]?.uptime ?? 0;

		return {
			uptime1h: await parse(u1h),
			uptime24h: await parse(u24h),
			uptime7d: await parse(u7d),
			uptime30d: await parse(u30d),
			uptime90d: await parse(u90d),
			uptime365d: await parse(u365d),
		};
	} catch {
		return { uptime1h: 0, uptime24h: 0, uptime7d: 0, uptime30d: 0, uptime90d: 0, uptime365d: 0 };
	}
}

export async function updateGroupStatus(groupId: string): Promise<void> {
	const group = cache.getGroup(groupId);
	if (!group) return;

	const { monitors: childMonitors, groups: childGroups } = cache.getDirectChildren(groupId);

	let totalUp = 0,
		totalDown = 0,
		totalUnknown = 0,
		totalLatency = 0,
		latencyCount = 0;

	for (const monitor of childMonitors) {
		const s = cache.getStatus(monitor.id);
		if (s) {
			s.status === "up" ? totalUp++ : totalDown++;
			if (s.latency) {
				totalLatency += s.latency;
				latencyCount++;
			}
		} else {
			totalUnknown++;
		}
	}

	for (const subgroup of childGroups) {
		const s = cache.getStatus(subgroup.id);
		if (s) {
			s.status === "up" ? totalUp++ : totalDown++;
			if (s.latency) {
				totalLatency += s.latency;
				latencyCount++;
			}
		} else {
			totalUnknown++;
		}
	}

	const totalKnown = totalUp + totalDown;
	const totalChildren = totalKnown + totalUnknown;

	if (totalChildren > 0 && totalUnknown > totalChildren / 2) return;
	if (totalKnown === 0) return;

	const avgLatency = latencyCount > 0 ? totalLatency / latencyCount : 0;
	const upPercentage = totalKnown > 0 ? (totalUp / totalKnown) * 100 : 0;

	let status: "up" | "down" | "degraded";
	switch (group.strategy) {
		case "any-up":
			status = totalUp > 0 ? "up" : "down";
			break;
		case "all-up":
			status = totalUp === totalKnown ? "up" : "down";
			break;
		case "percentage":
		default:
			status = upPercentage === 100 ? "up" : upPercentage >= group.degradedThreshold ? "degraded" : "down";
	}

	const previousStatus = cache.getStatus(groupId)?.status;

	// Calculate group uptimes from child uptimes
	const childIds = [...childMonitors.map((m) => m.id), ...childGroups.map((g) => g.id)];
	const uptimes = calculateGroupUptimes(childIds, group.strategy);

	const groupStatus: StatusData = {
		id: groupId,
		type: "group",
		name: group.name,
		status,
		latency: avgLatency,
		lastCheck: new Date(),
		...uptimes,
	};

	cache.setStatus(groupId, groupStatus);

	// Notifications
	if (previousStatus && previousStatus !== status && !isInGracePeriod() && group.notificationChannels?.length) {
		const notificationManager = new NotificationManager(config.notifications || { channels: {} });
		const eventType = status === "up" ? "recovered" : "down";

		await notificationManager.sendNotification(group.notificationChannels, {
			type: eventType,
			monitorId: groupId,
			monitorName: group.name,
			timestamp: new Date(),
			sourceType: "group",
			groupInfo: { strategy: group.strategy, childrenUp: totalUp, totalChildren: totalKnown, upPercentage },
		});
	}

	if (group.parentId) {
		await updateGroupStatus(group.parentId);
	}
}

function calculateGroupUptimes(
	childIds: string[],
	strategy: "any-up" | "percentage" | "all-up"
): { uptime1h: number; uptime24h: number; uptime7d: number; uptime30d: number; uptime90d: number; uptime365d: number } {
	const uptimes: number[][] = [[], [], [], [], [], []];

	for (const id of childIds) {
		const s = cache.getStatus(id);
		if (s) {
			uptimes[0]!.push(s.uptime1h);
			uptimes[1]!.push(s.uptime24h);
			uptimes[2]!.push(s.uptime7d);
			uptimes[3]!.push(s.uptime30d);
			uptimes[4]!.push(s.uptime90d);
			uptimes[5]!.push(s.uptime365d);
		}
	}

	const aggregate = (arr: number[]) => {
		if (arr.length === 0) return 100;
		switch (strategy) {
			case "any-up":
				return Math.max(...arr);
			case "all-up":
				return Math.min(...arr);
			default:
				return arr.reduce((a, b) => a + b, 0) / arr.length;
		}
	};

	return {
		uptime1h: aggregate(uptimes[0]!),
		uptime24h: aggregate(uptimes[1]!),
		uptime7d: aggregate(uptimes[2]!),
		uptime30d: aggregate(uptimes[3]!),
		uptime90d: aggregate(uptimes[4]!),
		uptime365d: aggregate(uptimes[5]!),
	};
}
