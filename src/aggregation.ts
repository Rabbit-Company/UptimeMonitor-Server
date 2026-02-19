import { clickhouse } from "./clickhouse";
import { cache } from "./cache";
import { Logger } from "./logger";

export class AggregationJob {
	private currentRunAbort: AbortController | null = null;
	private intervalId: NodeJS.Timeout | null = null;
	private readonly INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
	private isRunning: boolean = false;
	private readonly MAX_RUN_TIME_MS = 5 * 60 * 1000; // 5 minutes max runtime
	private lastRunStartTime: number = 0;

	private readonly CH_SELECT_MAX_EXEC_S = 20;
	private readonly CH_INSERT_MAX_EXEC_S = 240;

	async start(): Promise<void> {
		if (this.intervalId) return;

		Logger.info("Starting aggregation job (runs every 10 minutes)");

		await this.runAggregation();

		this.intervalId = setInterval(() => {
			this.runAggregation();
		}, this.INTERVAL_MS);
	}

	stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
		Logger.info("Aggregation job stopped");
	}

	private async runAggregation(): Promise<void> {
		// Check if previous run is stuck
		if (this.isRunning) {
			const currentTime = Date.now();
			const runDuration = currentTime - this.lastRunStartTime;

			if (runDuration > this.MAX_RUN_TIME_MS) {
				Logger.warn("Aggregation: Previous run appears stuck, aborting + forcing reset", {
					durationMs: runDuration,
					maxAllowedMs: this.MAX_RUN_TIME_MS,
				});

				try {
					this.currentRunAbort?.abort(new Error("Aggregation run timed out"));
				} catch {}

				this.currentRunAbort = null;
				this.isRunning = false;
			} else {
				Logger.debug("Aggregation: Previous run still in progress, skipping");
				return;
			}
		}

		this.isRunning = true;
		this.lastRunStartTime = Date.now();

		const runAbort = new AbortController();
		this.currentRunAbort = runAbort;
		const runTimer = setTimeout(() => {
			try {
				runAbort.abort(new Error(`Aggregation exceeded ${this.MAX_RUN_TIME_MS}ms`));
			} catch {}
		}, this.MAX_RUN_TIME_MS);

		try {
			Logger.debug("Aggregation: Running...");
			await this.aggregateHourly(runAbort.signal);
			await this.aggregateDaily(runAbort.signal);
			Logger.debug("Aggregation: Completed");
		} catch (error: any) {
			Logger.error("Aggregation failed", {
				"error.message": error?.message,
				"error.stack": error?.stack,
			});

			// Add a small delay before retrying on error
			await new Promise((resolve) => setTimeout(resolve, 1000));
		} finally {
			clearTimeout(runTimer);
			this.currentRunAbort = null;
			this.isRunning = false;
		}
	}

	/**
	 * Aggregate completed hours from pulses into pulses_hourly
	 *
	 * Uptime = (distinct intervals with ≥1 pulse / expected intervals) × 100
	 * Each monitor has its own interval, so we aggregate per-monitor.
	 *
	 * Only NEW hours are aggregated - already aggregated hours are never re-processed.
	 * This ensures data integrity (TTL can't affect already-aggregated data) and improves performance.
	 *
	 * Hours without any pulses are recorded as 0% uptime.
	 *
	 * For the first hour (when the monitor started mid-hour), expected intervals are calculated
	 * based on when the first pulse actually arrived, not from the start of the hour.
	 */
	private async aggregateHourly(abortSignal: AbortSignal): Promise<void> {
		const monitors = cache.getAllMonitors();

		for (const monitor of monitors) {
			const expectedIntervalsPerHour = Math.floor(3600 / monitor.interval);

			try {
				// Find the last aggregated hour for this monitor
				const lastAggregatedQuery = `
					SELECT
						formatDateTime(timestamp, '%Y-%m-%dT%H:00:00Z') AS last_hour
					FROM pulses_hourly
					WHERE monitor_id = {monitorId:String}
					ORDER BY timestamp DESC
					LIMIT 1;
				`;
				const lastAggregatedResult = await clickhouse.query({
					query: lastAggregatedQuery,
					query_params: { monitorId: monitor.id },
					format: "JSONEachRow",
					abort_signal: abortSignal,
					clickhouse_settings: {
						max_execution_time: this.CH_SELECT_MAX_EXEC_S,
						wait_end_of_query: 1,
					},
				});
				const lastAggregatedData = await lastAggregatedResult.json<{ last_hour: string | null }>();

				let startHour: Date;

				if (lastAggregatedData[0]?.last_hour) {
					// Start from the hour after the last aggregated one
					startHour = new Date(lastAggregatedData[0].last_hour);
					startHour.setUTCHours(startHour.getUTCHours() + 1);
				} else {
					// No aggregated data yet - find first pulse
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
						query_params: { monitorId: monitor.id },
						format: "JSONEachRow",
						abort_signal: abortSignal,
						clickhouse_settings: {
							max_execution_time: this.CH_SELECT_MAX_EXEC_S,
							wait_end_of_query: 1,
						},
					});
					const firstPulseData = await firstPulseResult.json<{ first_pulse: string | null }>();

					if (!firstPulseData[0]?.first_pulse) {
						continue;
					}

					startHour = new Date(firstPulseData[0].first_pulse);
					startHour.setUTCMinutes(0, 0, 0);
				}

				if (startHour.getFullYear() < 2000) {
					Logger.warn("Skipping hourly aggregation - invalid start hour detected", {
						monitorId: monitor.id,
						startHour: startHour.toISOString(),
					});
					continue;
				}

				// Calculate hours to aggregate (from startHour to last completed hour)
				const now = new Date();
				const currentHourStart = new Date(now);
				currentHourStart.setUTCMinutes(0, 0, 0);

				const hoursToAggregate = Math.floor((currentHourStart.getTime() - startHour.getTime()) / (60 * 60 * 1000));

				if (hoursToAggregate <= 0) {
					continue;
				}

				// Limit to prevent too many partitions error
				const maxHoursPerBatch = 2000;
				const batchedHours = Math.min(hoursToAggregate, maxHoursPerBatch);

				if (hoursToAggregate > maxHoursPerBatch) {
					Logger.info("Hourly aggregation: processing in batches", {
						monitorId: monitor.id,
						totalHours: hoursToAggregate,
						thisBatch: batchedHours,
					});
				}

				const startHourFormatted = startHour.toISOString().slice(0, 19).replace("T", " ");

				// Check if this is the first aggregation for this monitor (no existing hourly data)
				const isFirstAggregation = !lastAggregatedData[0]?.last_hour;

				// Only aggregate NEW hours (not already in pulses_hourly)
				// For the first hour (only when isFirstAggregation), we need to calculate expected intervals
				// based on when the monitor actually started, not from the start of the hour
				const query = isFirstAggregation
					? `
					INSERT INTO pulses_hourly (
						monitor_id, timestamp, uptime,
						latency_min, latency_max, latency_avg,
						custom1_min, custom1_max, custom1_avg,
						custom2_min, custom2_max, custom2_avg,
						custom3_min, custom3_max, custom3_avg
					)
					WITH
						-- Generate only the new hours that need aggregating
						all_hours AS (
							SELECT toStartOfHour(toDateTime('${startHourFormatted}') + INTERVAL number HOUR) AS hour
							FROM numbers(0, ${batchedHours})
						),
						-- Get the first pulse timestamp for calculating partial hour expected intervals
						first_pulse AS (
							SELECT timestamp AS first_pulse_time
							FROM pulses
							WHERE monitor_id = {monitorId:String}
							ORDER BY timestamp ASC
							LIMIT 1
						),
						-- Aggregate pulse data for these hours only
						pulse_stats AS (
							SELECT
								toStartOfHour(timestamp) AS hour,
								COUNT(DISTINCT toStartOfInterval(timestamp, INTERVAL ${monitor.interval} SECOND)) AS distinct_intervals,
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
								AND timestamp >= toDateTime('${startHourFormatted}')
								AND timestamp < toDateTime('${startHourFormatted}') + INTERVAL ${batchedHours} HOUR
							GROUP BY toStartOfHour(timestamp)
						)
					SELECT
						{monitorId:String} AS monitor_id,
						ah.hour AS timestamp,
						COALESCE(
							LEAST(100,
								ps.distinct_intervals * 100.0 /
								-- For the first hour (where first pulse is in this hour), calculate expected intervals
								-- based on remaining seconds in the hour from when the first pulse arrived
								CASE
									WHEN toStartOfHour((SELECT first_pulse_time FROM first_pulse)) = ah.hour
									THEN GREATEST(1, floor((3600 - toSecond((SELECT first_pulse_time FROM first_pulse)) - toMinute((SELECT first_pulse_time FROM first_pulse)) * 60) / ${monitor.interval}))
									ELSE ${expectedIntervalsPerHour}
								END
							),
							0
						) AS uptime,
						ps.latency_min, ps.latency_max, ps.latency_avg,
						ps.custom1_min, ps.custom1_max, ps.custom1_avg,
						ps.custom2_min, ps.custom2_max, ps.custom2_avg,
						ps.custom3_min, ps.custom3_max, ps.custom3_avg
					FROM all_hours ah
					LEFT JOIN pulse_stats ps ON ah.hour = ps.hour
				`
					: `
					INSERT INTO pulses_hourly (
						monitor_id, timestamp, uptime,
						latency_min, latency_max, latency_avg,
						custom1_min, custom1_max, custom1_avg,
						custom2_min, custom2_max, custom2_avg,
						custom3_min, custom3_max, custom3_avg
					)
					WITH
						-- Generate only the new hours that need aggregating
						all_hours AS (
							SELECT toStartOfHour(toDateTime('${startHourFormatted}') + INTERVAL number HOUR) AS hour
							FROM numbers(0, ${batchedHours})
						),
						-- Aggregate pulse data for these hours only
						pulse_stats AS (
							SELECT
								toStartOfHour(timestamp) AS hour,
								COUNT(DISTINCT toStartOfInterval(timestamp, INTERVAL ${monitor.interval} SECOND)) AS distinct_intervals,
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
								AND timestamp >= toDateTime('${startHourFormatted}')
								AND timestamp < toDateTime('${startHourFormatted}') + INTERVAL ${batchedHours} HOUR
							GROUP BY toStartOfHour(timestamp)
						)
					SELECT
						{monitorId:String} AS monitor_id,
						ah.hour AS timestamp,
						COALESCE(LEAST(100, ps.distinct_intervals * 100.0 / ${expectedIntervalsPerHour}), 0) AS uptime,
						ps.latency_min, ps.latency_max, ps.latency_avg,
						ps.custom1_min, ps.custom1_max, ps.custom1_avg,
						ps.custom2_min, ps.custom2_max, ps.custom2_avg,
						ps.custom3_min, ps.custom3_max, ps.custom3_avg
					FROM all_hours ah
					LEFT JOIN pulse_stats ps ON ah.hour = ps.hour
				`;

				await clickhouse.command({
					query,
					query_params: { monitorId: monitor.id },
					abort_signal: abortSignal,
					clickhouse_settings: {
						max_execution_time: this.CH_INSERT_MAX_EXEC_S,
						wait_end_of_query: 1,
					},
				});

				Logger.debug("Hourly aggregation completed", {
					monitorId: monitor.id,
					hoursAggregated: batchedHours,
					remaining: hoursToAggregate - batchedHours,
				});
			} catch (err: any) {
				Logger.error("Hourly aggregation failed for monitor", {
					monitorId: monitor.id,
					"error.message": err?.message,
					"error.stack": err?.stack,
				});
				// Continue with next monitor instead of stopping entire process
			}
		}
	}

	/**
	 * Aggregate completed days from pulses_hourly into pulses_daily
	 * Daily uptime = average of hourly uptimes (24 hours expected per day)
	 *
	 * Only NEW days are aggregated - already aggregated days are never re-processed.
	 * This ensures data integrity and improves performance.
	 *
	 * Days without any hourly records are recorded as 0% uptime.
	 */
	private async aggregateDaily(abortSignal: AbortSignal): Promise<void> {
		const monitors = cache.getAllMonitors();

		for (const monitor of monitors) {
			try {
				// Find the last aggregated day for this monitor
				const lastAggregatedQuery = `
					SELECT
						toString(timestamp) AS last_date
					FROM pulses_daily
					WHERE monitor_id = {monitorId:String}
					ORDER BY timestamp DESC
					LIMIT 1;
				`;
				const lastAggregatedResult = await clickhouse.query({
					query: lastAggregatedQuery,
					query_params: { monitorId: monitor.id },
					format: "JSONEachRow",
					abort_signal: abortSignal,
					clickhouse_settings: {
						max_execution_time: this.CH_SELECT_MAX_EXEC_S,
						wait_end_of_query: 1,
					},
				});
				const lastAggregatedData = await lastAggregatedResult.json<{ last_date: string | null }>();

				let startDate: Date;

				if (lastAggregatedData[0]?.last_date) {
					// Start from the day after the last aggregated one
					startDate = new Date(lastAggregatedData[0].last_date);
					startDate.setUTCDate(startDate.getUTCDate() + 1);
				} else {
					// No aggregated data yet - find first hourly record
					const firstHourQuery = `
						SELECT
							formatDateTime(timestamp, '%Y-%m-%dT%H:00:00Z') AS first_hour
						FROM pulses_hourly
						WHERE monitor_id = {monitorId:String}
						ORDER BY timestamp ASC
						LIMIT 1;
					`;
					const firstHourResult = await clickhouse.query({
						query: firstHourQuery,
						query_params: { monitorId: monitor.id },
						format: "JSONEachRow",
						abort_signal: abortSignal,
						clickhouse_settings: {
							max_execution_time: this.CH_SELECT_MAX_EXEC_S,
							wait_end_of_query: 1,
						},
					});
					const firstHourData = await firstHourResult.json<{ first_hour: string | null }>();

					if (!firstHourData[0]?.first_hour) {
						continue;
					}

					startDate = new Date(firstHourData[0].first_hour);
					startDate.setUTCHours(0, 0, 0, 0);
				}

				if (startDate.getFullYear() < 2000) {
					Logger.warn("Skipping daily aggregation - invalid start date detected", {
						monitorId: monitor.id,
						startDate: startDate.toISOString(),
					});
					continue;
				}

				// Calculate days to aggregate (from startDate to yesterday)
				const now = new Date();
				const today = new Date(now);
				today.setUTCHours(0, 0, 0, 0);

				const daysToAggregate = Math.floor((today.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));

				if (daysToAggregate <= 0) {
					continue;
				}

				const maxDaysPerBatch = 365;
				const batchedDays = Math.min(daysToAggregate, maxDaysPerBatch);

				if (daysToAggregate > maxDaysPerBatch) {
					Logger.info("Daily aggregation: processing in batches", {
						monitorId: monitor.id,
						totalDays: daysToAggregate,
						thisBatch: batchedDays,
					});
				}

				const startDateFormatted = startDate.toISOString().slice(0, 10);

				// Only aggregate NEW days (not already in pulses_daily)
				const query = `
					INSERT INTO pulses_daily (
						monitor_id, timestamp, uptime,
						latency_min, latency_max, latency_avg,
						custom1_min, custom1_max, custom1_avg,
						custom2_min, custom2_max, custom2_avg,
						custom3_min, custom3_max, custom3_avg
					)
					WITH
						-- Generate only the new days that need aggregating
						all_days AS (
							SELECT toDate('${startDateFormatted}') + INTERVAL number DAY AS date
							FROM numbers(0, ${batchedDays})
						),
						-- Aggregate hourly data for these days only
						daily_stats AS (
							SELECT
								toDate(timestamp) AS date,
								avg(uptime) AS uptime,
								min(latency_min) AS latency_min,
								max(latency_max) AS latency_max,
								avg(latency_avg) AS latency_avg,
								min(custom1_min) AS custom1_min,
								max(custom1_max) AS custom1_max,
								avg(custom1_avg) AS custom1_avg,
								min(custom2_min) AS custom2_min,
								max(custom2_max) AS custom2_max,
								avg(custom2_avg) AS custom2_avg,
								min(custom3_min) AS custom3_min,
								max(custom3_max) AS custom3_max,
								avg(custom3_avg) AS custom3_avg
							FROM pulses_hourly
							WHERE monitor_id = {monitorId:String}
								AND toDate(timestamp) >= toDate('${startDateFormatted}')
								AND toDate(timestamp) < toDate('${startDateFormatted}') + INTERVAL ${batchedDays} DAY
							GROUP BY toDate(timestamp)
						)
					SELECT
						{monitorId:String} AS monitor_id,
						ad.date AS timestamp,
						COALESCE(ds.uptime, 0) AS uptime,
						ds.latency_min, ds.latency_max, ds.latency_avg,
						ds.custom1_min, ds.custom1_max, ds.custom1_avg,
						ds.custom2_min, ds.custom2_max, ds.custom2_avg,
						ds.custom3_min, ds.custom3_max, ds.custom3_avg
					FROM all_days ad
					LEFT JOIN daily_stats ds ON ad.date = ds.date
				`;

				await clickhouse.command({
					query,
					query_params: { monitorId: monitor.id },
					abort_signal: abortSignal,
					clickhouse_settings: {
						max_execution_time: this.CH_INSERT_MAX_EXEC_S,
						wait_end_of_query: 1,
					},
				});

				Logger.debug("Daily aggregation completed", {
					monitorId: monitor.id,
					daysAggregated: batchedDays,
					remaining: daysToAggregate - batchedDays,
				});
			} catch (err: any) {
				Logger.error("Daily aggregation failed for monitor", {
					monitorId: monitor.id,
					"error.message": err?.message,
					"error.stack": err?.stack,
				});
				// Continue with next monitor instead of stopping entire process
			}
		}
	}
}

export const aggregationJob = new AggregationJob();
