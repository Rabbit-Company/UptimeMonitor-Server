import { createClient } from "@clickhouse/client";
import { config } from "./config";
import { Logger } from "./logger";
import type { PulseRaw, PulseHourly, PulseDaily, StatusData, CustomMetrics, GroupHistoryRecord, Group } from "./types";
import { missingPulseDetector } from "./missing-pulse-detector";
import { NotificationManager } from "./notifications";
import { cache } from "./cache";
import { formatDateTimeISOCompact, isInGracePeriod } from "./times";
import { server } from ".";

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
					custom1 Nullable(Float32),
					custom2 Nullable(Float32),
					custom3 Nullable(Float32),
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
					latency_avg Nullable(Float32),
					custom1_min Nullable(Float32),
					custom1_max Nullable(Float32),
					custom1_avg Nullable(Float32),
					custom2_min Nullable(Float32),
					custom2_max Nullable(Float32),
					custom2_avg Nullable(Float32),
					custom3_min Nullable(Float32),
					custom3_max Nullable(Float32),
					custom3_avg Nullable(Float32)
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
					latency_avg Nullable(Float32),
					custom1_min Nullable(Float32),
					custom1_max Nullable(Float32),
					custom1_avg Nullable(Float32),
					custom2_min Nullable(Float32),
					custom2_max Nullable(Float32),
					custom2_avg Nullable(Float32),
					custom3_min Nullable(Float32),
					custom3_max Nullable(Float32),
					custom3_avg Nullable(Float32)
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

export async function storePulse(
	monitorId: string,
	latency: number | null,
	timestamp: Date,
	synthetic: boolean = false,
	customMetrics: CustomMetrics = { custom1: null, custom2: null, custom3: null },
): Promise<void> {
	try {
		await clickhouse.insert({
			table: "pulses",
			values: [
				{
					monitor_id: monitorId,
					latency,
					timestamp: formatDateTimeISOCompact(timestamp, { includeMilliseconds: true }),
					synthetic,
					custom1: customMetrics.custom1,
					custom2: customMetrics.custom2,
					custom3: customMetrics.custom3,
				},
			],
			format: "JSONEachRow",
		});
	} catch (err: any) {
		Logger.error("Storing pulse failed", { monitorId, "error.message": err?.message });
	}

	if (synthetic) return;

	missingPulseDetector.recordPulse(monitorId, timestamp);

	updateQueue.add(monitorId);
	missingPulseDetector.resetMonitor(monitorId);

	const slugs = cache.getStatusPageSlugsByMonitor(monitorId);

	const nonNullCustomMetrics = {
		...(customMetrics.custom1 !== null && { custom1: customMetrics.custom1 }),
		...(customMetrics.custom2 !== null && { custom2: customMetrics.custom2 }),
		...(customMetrics.custom3 !== null && { custom3: customMetrics.custom3 }),
	};

	slugs.forEach((slug) => {
		server.publish(
			`slug-${slug}`,
			JSON.stringify({
				action: "pulse",
				data: { slug, monitorId, status: "up", latency, timestamp, ...nonNullCustomMetrics },
				timestamp: new Date().toISOString(),
			}),
		);
	});
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
				formatDateTime(timestamp, '%Y-%m-%dT%H:%i:%sZ') AS first_pulse
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
						avg(latency) AS latency_avg,
						min(custom1) AS custom1_min,
						max(custom1) AS custom1_max,
						avg(custom1) AS custom1_avg,
						min(custom2) AS custom2_min,
						max(custom2) AS custom2_max,
						avg(custom2) AS custom2_avg,
						min(custom3) AS custom3_min,
						max(custom3) AS custom3_max,
						avg(custom3) AS custom3_avg
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
				ps.latency_avg AS latency_avg,
				ps.custom1_min AS custom1_min,
				ps.custom1_max AS custom1_max,
				ps.custom1_avg AS custom1_avg,
				ps.custom2_min AS custom2_min,
				ps.custom2_max AS custom2_max,
				ps.custom2_avg AS custom2_avg,
				ps.custom3_min AS custom3_min,
				ps.custom3_max AS custom3_max,
				ps.custom3_avg AS custom3_avg
			FROM all_intervals ai
			LEFT JOIN pulse_stats ps ON ai.interval_start = ps.interval_start
			ORDER BY ai.interval_start ASC
		`;

		const result = await clickhouse.query({
			query,
			query_params: { monitorId },
			format: "JSONEachRow",
		});
		const data = await result.json<PulseRaw>();

		// Remove null custom metric fields to reduce payload size
		return data.map((row) => {
			const cleaned: Record<string, any> = {
				timestamp: row.timestamp,
				uptime: row.uptime,
			};

			// Only include latency fields if they have values
			if (row.latency_min !== null) cleaned.latency_min = row.latency_min;
			if (row.latency_max !== null) cleaned.latency_max = row.latency_max;
			if (row.latency_avg !== null) cleaned.latency_avg = row.latency_avg;

			// Only include custom metric fields if they have values
			if (row.custom1_min !== null) cleaned.custom1_min = row.custom1_min;
			if (row.custom1_max !== null) cleaned.custom1_max = row.custom1_max;
			if (row.custom1_avg !== null) cleaned.custom1_avg = row.custom1_avg;
			if (row.custom2_min !== null) cleaned.custom2_min = row.custom2_min;
			if (row.custom2_max !== null) cleaned.custom2_max = row.custom2_max;
			if (row.custom2_avg !== null) cleaned.custom2_avg = row.custom2_avg;
			if (row.custom3_min !== null) cleaned.custom3_min = row.custom3_min;
			if (row.custom3_max !== null) cleaned.custom3_max = row.custom3_max;
			if (row.custom3_avg !== null) cleaned.custom3_avg = row.custom3_avg;

			return cleaned as PulseRaw;
		});
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
			latency_avg,
			custom1_min,
			custom1_max,
			custom1_avg,
			custom2_min,
			custom2_max,
			custom2_avg,
			custom3_min,
			custom3_max,
			custom3_avg
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
		const data = await result.json<PulseHourly>();

		// Remove null custom metric fields to reduce payload size
		return data.map((row) => {
			const cleaned: Record<string, any> = {
				timestamp: row.timestamp,
				uptime: row.uptime,
			};

			// Only include latency fields if they have values
			if (row.latency_min !== null) cleaned.latency_min = row.latency_min;
			if (row.latency_max !== null) cleaned.latency_max = row.latency_max;
			if (row.latency_avg !== null) cleaned.latency_avg = row.latency_avg;

			// Only include custom metric fields if they have values
			if (row.custom1_min !== null) cleaned.custom1_min = row.custom1_min;
			if (row.custom1_max !== null) cleaned.custom1_max = row.custom1_max;
			if (row.custom1_avg !== null) cleaned.custom1_avg = row.custom1_avg;
			if (row.custom2_min !== null) cleaned.custom2_min = row.custom2_min;
			if (row.custom2_max !== null) cleaned.custom2_max = row.custom2_max;
			if (row.custom2_avg !== null) cleaned.custom2_avg = row.custom2_avg;
			if (row.custom3_min !== null) cleaned.custom3_min = row.custom3_min;
			if (row.custom3_max !== null) cleaned.custom3_max = row.custom3_max;
			if (row.custom3_avg !== null) cleaned.custom3_avg = row.custom3_avg;

			return cleaned as PulseHourly;
		});
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
			latency_avg,
			custom1_min,
			custom1_max,
			custom1_avg,
			custom2_min,
			custom2_max,
			custom2_avg,
			custom3_min,
			custom3_max,
			custom3_avg
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
		const data = await result.json<PulseDaily>();

		// Remove null custom metric fields to reduce payload size
		return data.map((row) => {
			const cleaned: Record<string, any> = {
				timestamp: row.timestamp,
				uptime: row.uptime,
			};

			// Only include latency fields if they have values
			if (row.latency_min !== null) cleaned.latency_min = row.latency_min;
			if (row.latency_max !== null) cleaned.latency_max = row.latency_max;
			if (row.latency_avg !== null) cleaned.latency_avg = row.latency_avg;

			// Only include custom metric fields if they have values
			if (row.custom1_min !== null) cleaned.custom1_min = row.custom1_min;
			if (row.custom1_max !== null) cleaned.custom1_max = row.custom1_max;
			if (row.custom1_avg !== null) cleaned.custom1_avg = row.custom1_avg;
			if (row.custom2_min !== null) cleaned.custom2_min = row.custom2_min;
			if (row.custom2_max !== null) cleaned.custom2_max = row.custom2_max;
			if (row.custom2_avg !== null) cleaned.custom2_avg = row.custom2_avg;
			if (row.custom3_min !== null) cleaned.custom3_min = row.custom3_min;
			if (row.custom3_max !== null) cleaned.custom3_max = row.custom3_max;
			if (row.custom3_avg !== null) cleaned.custom3_avg = row.custom3_avg;

			return cleaned as PulseDaily;
		});
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
				SELECT formatDateTime(ts, '%Y-%m-%dT%H:%i:%sZ') AS first_pulse
				FROM
				(
					SELECT ts FROM
					(
						SELECT timestamp AS ts
						FROM pulses
						WHERE monitor_id = {monitorId:String}
						ORDER BY timestamp ASC
						LIMIT 1
					)

					UNION ALL

					SELECT ts FROM
					(
						SELECT toDateTime(timestamp) AS ts
						FROM pulses_daily
						WHERE monitor_id = {monitorId:String}
						ORDER BY timestamp ASC
						LIMIT 1
					)
				)
				ORDER BY ts ASC
				LIMIT 1
			`;
			const result = await clickhouse.query({ query, query_params: { monitorId }, format: "JSONEachRow" });
			const data = await result.json<{ first_pulse: string | null }>();
			if (data[0]?.first_pulse) firstPulse = new Date(data[0].first_pulse);
		}

		// Get latest pulse with custom metrics
		const latestQuery = `
			SELECT
				formatDateTime(timestamp, '%Y-%m-%dT%H:%i:%sZ') AS last_check,
				latency,
				custom1,
				custom2,
				custom3
			FROM pulses
			WHERE monitor_id = {monitorId:String}
			ORDER BY timestamp DESC
			LIMIT 1
		`;
		const latestResult = await clickhouse.query({ query: latestQuery, query_params: { monitorId }, format: "JSONEachRow" });
		const latestData = await latestResult.json<{
			last_check: string;
			latency: number | null;
			custom1: number | null;
			custom2: number | null;
			custom3: number | null;
		}>();

		if (!latestData.length) {
			const statusData: StatusData = {
				id: monitorId,
				type: "monitor",
				name: monitor.name,
				status: "down",
				latency: 0,
				uptime1h: 0,
				uptime24h: 0,
				uptime7d: 0,
				uptime30d: 0,
				uptime90d: 0,
				uptime365d: 0,
			};

			if (monitor.custom1) {
				statusData.custom1 = { config: monitor.custom1, value: undefined };
			}
			if (monitor.custom2) {
				statusData.custom2 = { config: monitor.custom2, value: undefined };
			}
			if (monitor.custom3) {
				statusData.custom3 = { config: monitor.custom3, value: undefined };
			}

			cache.setStatus(monitorId, statusData);

			if (monitor.groupId) {
				await updateGroupStatus(monitor.groupId);
			}
			return;
		}

		const lastCheckTime = new Date(latestData[0]!.last_check).getTime();
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
			lastCheck: new Date(latestData[0]!.last_check),
			...uptimes,
		};

		if (monitor.custom1) {
			statusData.custom1 = { config: monitor.custom1, value: latestData[0]!.custom1 ?? undefined };
		}
		if (monitor.custom2) {
			statusData.custom2 = { config: monitor.custom2, value: latestData[0]!.custom2 ?? undefined };
		}
		if (monitor.custom3) {
			statusData.custom3 = { config: monitor.custom3, value: latestData[0]!.custom3 ?? undefined };
		}

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
	firstPulse: Date | undefined,
): Promise<{ uptime1h: number; uptime24h: number; uptime7d: number; uptime30d: number; uptime90d: number; uptime365d: number }> {
	const pulseDate = firstPulse ? formatDateTimeISOCompact(firstPulse) : "2001-10-15 00:00:00";

	// For short periods (1h, 24h), use pulses table directly
	const shortPeriodQuery = (period: string) => `
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

	// For longer periods: get historical daily data only (excludes today)
	// We'll combine this with the 24h uptime in JavaScript
	const historicalDailyQuery = (days: number) => `
		WITH
			period_start AS (
				SELECT GREATEST(toDate('${pulseDate}'), toDate(now() - INTERVAL ${days} DAY)) AS start_date
			),
			today AS (
				SELECT toDate(now()) AS current_date
			)
		SELECT
			SUM(uptime) AS total_uptime,
			COUNT(*) AS days_with_data,
			(SELECT current_date FROM today) - (SELECT start_date FROM period_start) AS historical_days
		FROM pulses_daily
		WHERE monitor_id = {monitorId:String}
			AND timestamp >= (SELECT start_date FROM period_start)
			AND timestamp < (SELECT current_date FROM today)
	`;

	try {
		const [u1h, u24h, h7d, h30d, h90d, h365d] = await Promise.all([
			clickhouse.query({ query: shortPeriodQuery("1 HOUR"), query_params: { monitorId }, format: "JSONEachRow" }),
			clickhouse.query({ query: shortPeriodQuery("24 HOUR"), query_params: { monitorId }, format: "JSONEachRow" }),
			clickhouse.query({ query: historicalDailyQuery(7), query_params: { monitorId }, format: "JSONEachRow" }),
			clickhouse.query({ query: historicalDailyQuery(30), query_params: { monitorId }, format: "JSONEachRow" }),
			clickhouse.query({ query: historicalDailyQuery(90), query_params: { monitorId }, format: "JSONEachRow" }),
			clickhouse.query({ query: historicalDailyQuery(365), query_params: { monitorId }, format: "JSONEachRow" }),
		]);

		const parseShort = async (r: any) => ((await r.json()) as { uptime: number }[])[0]?.uptime ?? 0;
		const parseHistorical = async (r: any) => {
			const data = (await r.json()) as { total_uptime: number | null; days_with_data: number; historical_days: number }[];
			return data[0] ?? { total_uptime: null, days_with_data: 0, historical_days: 0 };
		};

		const uptime1h = await parseShort(u1h);
		const uptime24h = await parseShort(u24h);

		const hist7d = await parseHistorical(h7d);
		const hist30d = await parseHistorical(h30d);
		const hist90d = await parseHistorical(h90d);
		const hist365d = await parseHistorical(h365d);

		const combineWithToday = (hist: { total_uptime: number | null; days_with_data: number; historical_days: number }): number => {
			// If no historical data and no today data expected, return 100%
			if (hist.historical_days <= 0 && hist.days_with_data === 0) {
				return uptime24h;
			}

			// Only average over days that have data + today
			const daysToAverage = hist.days_with_data + 1; // +1 for today

			if (hist.total_uptime === null || hist.days_with_data === 0) {
				return uptime24h;
			}

			return (hist.total_uptime + uptime24h) / daysToAverage;
		};

		return {
			uptime1h,
			uptime24h,
			uptime7d: combineWithToday(hist7d),
			uptime30d: combineWithToday(hist30d),
			uptime90d: combineWithToday(hist90d),
			uptime365d: combineWithToday(hist365d),
		};
	} catch (err: any) {
		Logger.error("calculateUptimes failed", { monitorId, "error.message": err?.message });
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
	strategy: "any-up" | "percentage" | "all-up",
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

/**
 * Get all direct descendant monitor IDs for a group (recursively includes nested groups)
 */
function getAllDescendantMonitorIds(groupId: string): string[] {
	const { monitors, groups } = cache.getDirectChildren(groupId);
	const monitorIds = monitors.map((m) => m.id);

	// Recursively get monitors from child groups
	for (const childGroup of groups) {
		monitorIds.push(...getAllDescendantMonitorIds(childGroup.id));
	}

	return monitorIds;
}

/**
 * Aggregate uptime values based on group strategy
 */
function aggregateUptimeByStrategy(uptimes: number[], strategy: Group["strategy"]): number {
	if (uptimes.length === 0) return 0;

	switch (strategy) {
		case "any-up":
			// Group is UP if at least one child is up
			// Return the max uptime (if any child was up, we get that uptime)
			return Math.max(...uptimes);
		case "all-up":
			// Group is UP only if all children are up
			// Return the min uptime (all must be 100% for group to be 100%)
			return Math.min(...uptimes);
		case "percentage":
		default:
			// Average of all children
			return uptimes.reduce((sum, u) => sum + u, 0) / uptimes.length;
	}
}

/**
 * Get raw history for a group computed from child monitors (last ~24h)
 * Uses the group's strategy to aggregate child uptimes per time window
 */
export async function getGroupHistoryRaw(groupId: string): Promise<GroupHistoryRecord[]> {
	const group = cache.getGroup(groupId);
	if (!group) return [];

	const monitorIds = getAllDescendantMonitorIds(groupId);
	if (monitorIds.length === 0) return [];

	// Use the group's interval or default to 60 seconds for output
	const outputInterval = Math.max(group.interval, 60);

	try {
		// Get the earliest first pulse among all monitors
		const firstPulseQuery = `
			SELECT
				formatDateTime(timestamp, '%Y-%m-%dT%H:%i:%sZ') AS first_pulse
			FROM pulses
			WHERE monitor_id IN ({monitorIds:Array(String)})
			ORDER BY timestamp ASC
			LIMIT 1;
		`;

		const firstPulseResult = await clickhouse.query({
			query: firstPulseQuery,
			query_params: { monitorIds },
			format: "JSONEachRow",
		});
		const firstPulseData = await firstPulseResult.json<{ first_pulse: string | null }>();

		if (!firstPulseData[0]?.first_pulse) {
			return [];
		}

		const firstPulse = new Date(new Date(firstPulseData[0].first_pulse).getTime() + outputInterval * 1000);
		const lastPulse = new Date(Date.now() - outputInterval * 1000);

		if (firstPulse.getFullYear() < 2000) {
			return [];
		}

		const startInterval = new Date(Math.floor(firstPulse.getTime() / (outputInterval * 1000)) * outputInterval * 1000);
		const endInterval = new Date(Math.floor(lastPulse.getTime() / (outputInterval * 1000)) * outputInterval * 1000);

		const intervalsToGenerate = Math.floor((endInterval.getTime() - startInterval.getTime()) / (outputInterval * 1000)) + 1;

		if (intervalsToGenerate <= 0) {
			return [];
		}

		const startIntervalFormatted = formatDateTimeISOCompact(startInterval);

		// For each time window, we need to determine if each monitor was "up" (had at least 1 pulse)
		// Then apply the group strategy to determine overall group uptime
		const query = `
			WITH
				all_intervals AS (
					SELECT toStartOfInterval(
						toDateTime('${startIntervalFormatted}') + INTERVAL number * ${outputInterval} SECOND,
						INTERVAL ${outputInterval} SECOND
					) AS interval_start
					FROM numbers(0, ${intervalsToGenerate})
				),
				-- For each monitor and interval, check if there was at least one pulse
				monitor_intervals AS (
					SELECT
						monitor_id,
						toStartOfInterval(timestamp, INTERVAL ${outputInterval} SECOND) AS interval_start,
						1 AS had_pulse,
						min(latency) AS latency_min,
						max(latency) AS latency_max,
						avg(latency) AS latency_avg
					FROM pulses
					WHERE monitor_id IN ({monitorIds:Array(String)})
						AND timestamp >= toDateTime('${startIntervalFormatted}')
						AND timestamp < toDateTime('${startIntervalFormatted}') + INTERVAL ${intervalsToGenerate * outputInterval} SECOND
					GROUP BY monitor_id, interval_start
				),
				-- Cross join all monitors with all intervals to get expected combinations
				all_monitor_intervals AS (
					SELECT
						ai.interval_start,
						m.monitor_id
					FROM all_intervals ai
					CROSS JOIN (SELECT DISTINCT monitor_id FROM monitor_intervals) m
				),
				-- Join with actual data to find which monitors were up in each interval
				interval_stats AS (
					SELECT
						ami.interval_start,
						ami.monitor_id,
						COALESCE(mi.had_pulse, 0) AS was_up,
						mi.latency_min,
						mi.latency_max,
						mi.latency_avg
					FROM all_monitor_intervals ami
					LEFT JOIN monitor_intervals mi ON ami.interval_start = mi.interval_start AND ami.monitor_id = mi.monitor_id
				),
				-- Aggregate per interval
				aggregated AS (
					SELECT
						interval_start,
						-- Count monitors that were up vs total
						SUM(was_up) AS monitors_up,
						COUNT(*) AS total_monitors,
						min(latency_min) AS latency_min,
						max(latency_max) AS latency_max,
						avg(latency_avg) AS latency_avg
					FROM interval_stats
					GROUP BY interval_start
				)
			SELECT
				formatDateTime(ai.interval_start, '%Y-%m-%dT%H:%i:%sZ') AS timestamp,
				COALESCE(a.monitors_up, 0) AS monitors_up,
				COALESCE(a.total_monitors, ${monitorIds.length}) AS total_monitors,
				a.latency_min,
				a.latency_max,
				a.latency_avg
			FROM all_intervals ai
			LEFT JOIN aggregated a ON ai.interval_start = a.interval_start
			ORDER BY ai.interval_start ASC
		`;

		const result = await clickhouse.query({
			query,
			query_params: { monitorIds },
			format: "JSONEachRow",
		});

		const data = await result.json<{
			timestamp: string;
			monitors_up: number;
			total_monitors: number;
			latency_min: number | null;
			latency_max: number | null;
			latency_avg: number | null;
		}>();

		// Apply group strategy to compute uptime
		return data.map((row) => {
			let uptime: number;
			const upPercentage = row.total_monitors > 0 ? (row.monitors_up / row.total_monitors) * 100 : 0;

			switch (group.strategy) {
				case "any-up":
					// Up if at least one monitor is up
					uptime = row.monitors_up > 0 ? 100 : 0;
					break;
				case "all-up":
					// Up only if all monitors are up
					uptime = row.monitors_up === row.total_monitors && row.total_monitors > 0 ? 100 : 0;
					break;
				case "percentage":
				default:
					// Percentage of monitors that were up
					uptime = upPercentage;
			}

			const record: GroupHistoryRecord = {
				timestamp: row.timestamp,
				uptime,
			};
			if (row.latency_min !== null) {
				record.latency_min = row.latency_min;
			}
			if (row.latency_max !== null) {
				record.latency_max = row.latency_max;
			}
			if (row.latency_avg !== null) {
				record.latency_avg = row.latency_avg;
			}
			return record;
		});
	} catch (err: any) {
		Logger.error("getGroupHistoryRaw failed", { groupId, "error.message": err?.message });
		return [];
	}
}

/**
 * Get hourly history for a group computed from child monitors (last ~90 days)
 */
export async function getGroupHistoryHourly(groupId: string): Promise<GroupHistoryRecord[]> {
	const group = cache.getGroup(groupId);
	if (!group) return [];

	const monitorIds = getAllDescendantMonitorIds(groupId);
	if (monitorIds.length === 0) return [];

	try {
		// Get all hourly data for all child monitors
		const query = `
			SELECT
				formatDateTime(timestamp, '%Y-%m-%dT%H:00:00Z') AS timestamp,
				monitor_id,
				uptime,
				latency_min,
				latency_max,
				latency_avg
			FROM pulses_hourly
			WHERE monitor_id IN ({monitorIds:Array(String)})
			ORDER BY timestamp ASC
		`;

		const result = await clickhouse.query({
			query,
			query_params: { monitorIds },
			format: "JSONEachRow",
		});

		const data = await result.json<{
			timestamp: string;
			monitor_id: string;
			uptime: number;
			latency_min: number | null;
			latency_max: number | null;
			latency_avg: number | null;
		}>();

		// Group by timestamp and aggregate
		const byTimestamp = new Map<string, { uptimes: number[]; latencyMins: number[]; latencyMaxs: number[]; latencyAvgs: number[] }>();

		for (const row of data) {
			if (!byTimestamp.has(row.timestamp)) {
				byTimestamp.set(row.timestamp, { uptimes: [], latencyMins: [], latencyMaxs: [], latencyAvgs: [] });
			}
			const bucket = byTimestamp.get(row.timestamp)!;
			bucket.uptimes.push(row.uptime);
			if (row.latency_min !== null) {
				bucket.latencyMins.push(row.latency_min);
			}
			if (row.latency_max !== null) {
				bucket.latencyMaxs.push(row.latency_max);
			}
			if (row.latency_avg !== null) {
				bucket.latencyAvgs.push(row.latency_avg);
			}
		}

		// Convert to array and apply group strategy
		const records: GroupHistoryRecord[] = [];
		const sortedTimestamps = Array.from(byTimestamp.keys()).sort();

		for (const timestamp of sortedTimestamps) {
			const bucket = byTimestamp.get(timestamp)!;
			const uptime = aggregateUptimeByStrategy(bucket.uptimes, group.strategy);
			const record: GroupHistoryRecord = { timestamp, uptime };

			if (bucket.latencyMins.length > 0) {
				record.latency_min = Math.min(...bucket.latencyMins);
			}
			if (bucket.latencyMaxs.length > 0) {
				record.latency_max = Math.max(...bucket.latencyMaxs);
			}
			if (bucket.latencyAvgs.length > 0) {
				record.latency_avg = bucket.latencyAvgs.reduce((a, b) => a + b, 0) / bucket.latencyAvgs.length;
			}

			records.push(record);
		}

		return records;
	} catch (err: any) {
		Logger.error("getGroupHistoryHourly failed", { groupId, "error.message": err?.message });
		return [];
	}
}

/**
 * Get daily history for a group computed from child monitors (all time)
 */
export async function getGroupHistoryDaily(groupId: string): Promise<GroupHistoryRecord[]> {
	const group = cache.getGroup(groupId);
	if (!group) return [];

	const monitorIds = getAllDescendantMonitorIds(groupId);
	if (monitorIds.length === 0) return [];

	try {
		// Get all daily data for all child monitors
		const query = `
			SELECT
				toString(timestamp) AS timestamp,
				monitor_id,
				uptime,
				latency_min,
				latency_max,
				latency_avg
			FROM pulses_daily
			WHERE monitor_id IN ({monitorIds:Array(String)})
			ORDER BY timestamp ASC
		`;

		const result = await clickhouse.query({
			query,
			query_params: { monitorIds },
			format: "JSONEachRow",
		});

		const data = await result.json<{
			timestamp: string;
			monitor_id: string;
			uptime: number;
			latency_min: number | null;
			latency_max: number | null;
			latency_avg: number | null;
		}>();

		// Group by timestamp and aggregate
		const byTimestamp = new Map<string, { uptimes: number[]; latencyMins: number[]; latencyMaxs: number[]; latencyAvgs: number[] }>();

		for (const row of data) {
			if (!byTimestamp.has(row.timestamp)) {
				byTimestamp.set(row.timestamp, { uptimes: [], latencyMins: [], latencyMaxs: [], latencyAvgs: [] });
			}
			const bucket = byTimestamp.get(row.timestamp)!;
			bucket.uptimes.push(row.uptime);
			if (row.latency_min !== null) {
				bucket.latencyMins.push(row.latency_min);
			}
			if (row.latency_max !== null) {
				bucket.latencyMaxs.push(row.latency_max);
			}
			if (row.latency_avg !== null) {
				bucket.latencyAvgs.push(row.latency_avg);
			}
		}

		// Convert to array and apply group strategy
		const records: GroupHistoryRecord[] = [];
		const sortedTimestamps = Array.from(byTimestamp.keys()).sort();

		for (const timestamp of sortedTimestamps) {
			const bucket = byTimestamp.get(timestamp)!;
			const uptime = aggregateUptimeByStrategy(bucket.uptimes, group.strategy);
			const record: GroupHistoryRecord = { timestamp, uptime };

			if (bucket.latencyMins.length > 0) {
				record.latency_min = Math.min(...bucket.latencyMins);
			}
			if (bucket.latencyMaxs.length > 0) {
				record.latency_max = Math.max(...bucket.latencyMaxs);
			}
			if (bucket.latencyAvgs.length > 0) {
				record.latency_avg = bucket.latencyAvgs.reduce((a, b) => a + b, 0) / bucket.latencyAvgs.length;
			}

			records.push(record);
		}

		return records;
	} catch (err: any) {
		Logger.error("getGroupHistoryDaily failed", { groupId, "error.message": err?.message });
		return [];
	}
}
