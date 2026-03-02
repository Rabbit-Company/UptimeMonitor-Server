import { cache } from "./cache";
import { clickhouse } from "./clickhouse";
import { Logger } from "./logger";
import type { Monitor } from "./types";
import { propagateGroupStatus } from "./group-updater";

interface HistoricalDaily {
	total_uptime: number | null;
	days_with_data: number;
	historical_days: number;
}

interface MonitorUptimeCache {
	uptime1h: number;
	uptime24h: number;
	uptime7d: number;
	uptime30d: number;
	uptime90d: number;
	uptime365d: number;
	hist7d: HistoricalDaily;
	hist30d: HistoricalDaily;
	hist90d: HistoricalDaily;
	hist365d: HistoricalDaily;
	shortRefreshedAt: number;
	longRefreshedAt: number;
}

const SHORT_MAX_AGE = 30_000;
const LONG_MAX_AGE = 300_000;
const UPTIME_PENDING = -1;

/** Max monitors per bulk query to keep query params reasonable */
const BULK_CHUNK_SIZE = 500;

const QUERY_TIMEOUT_MS = 15_000;
const MAX_CYCLE_TIME_MS = 30_000;

/**
 * Race a promise against a hard timeout that rejects.
 * This ensures no await can hang the loop indefinitely,
 * even if the underlying operation ignores abort signals.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;

	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`Timeout: ${label} exceeded ${ms}ms`)), ms);
	});

	return Promise.race([promise, timeout]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}

class UptimeUpdater {
	private cache = new Map<string, MonitorUptimeCache>();
	private running = false;
	private abortController: AbortController | null = null;
	private currentCycleAbort: AbortController | null = null;
	private lastCycleStartTime = 0;
	private isCycling = false;
	private cycleCount = 0;

	start(): void {
		if (this.running) return;
		this.running = true;
		this.abortController = new AbortController();
		this.loop(this.abortController.signal);
		Logger.info("Background uptime updater started");
	}

	stop(): void {
		this.running = false;
		this.abortController?.abort();
		this.abortController = null;
		Logger.info("Background uptime updater stopped");
	}

	getUptimes(monitorId: string): {
		uptime1h: number;
		uptime24h: number;
		uptime7d: number;
		uptime30d: number;
		uptime90d: number;
		uptime365d: number;
	} {
		const cached = this.cache.get(monitorId);
		if (cached) {
			return {
				uptime1h: cached.uptime1h,
				uptime24h: cached.uptime24h,
				uptime7d: cached.uptime7d,
				uptime30d: cached.uptime30d,
				uptime90d: cached.uptime90d,
				uptime365d: cached.uptime365d,
			};
		}

		const status = cache.getStatus(monitorId);
		if (status && status.uptime1h !== UPTIME_PENDING) {
			return {
				uptime1h: status.uptime1h,
				uptime24h: status.uptime24h,
				uptime7d: status.uptime7d,
				uptime30d: status.uptime30d,
				uptime90d: status.uptime90d,
				uptime365d: status.uptime365d,
			};
		}

		return {
			uptime1h: UPTIME_PENDING,
			uptime24h: UPTIME_PENDING,
			uptime7d: UPTIME_PENDING,
			uptime30d: UPTIME_PENDING,
			uptime90d: UPTIME_PENDING,
			uptime365d: UPTIME_PENDING,
		};
	}

	hasUptimes(monitorId: string): boolean {
		return this.cache.has(monitorId);
	}

	clearMonitor(monitorId: string): void {
		this.cache.delete(monitorId);
	}

	getCacheSize(): number {
		return this.cache.size;
	}

	private async loop(signal: AbortSignal): Promise<void> {
		while (!signal.aborted) {
			if (this.isCycling) {
				const dur = Date.now() - this.lastCycleStartTime;
				if (dur > MAX_CYCLE_TIME_MS) {
					Logger.warn("Uptime updater: previous cycle appears stuck, aborting", { duration_ms: dur });
					try {
						this.currentCycleAbort?.abort(new Error("Uptime cycle timed out"));
					} catch {}
					this.currentCycleAbort = null;
					this.isCycling = false;
				} else {
					await sleep(1000, signal);
					continue;
				}
			}

			this.isCycling = true;
			this.lastCycleStartTime = Date.now();

			const cycleAbort = new AbortController();
			this.currentCycleAbort = cycleAbort;

			const cycleTimer = setTimeout(() => {
				try {
					cycleAbort.abort(new Error(`Uptime cycle exceeded ${MAX_CYCLE_TIME_MS}ms`));
				} catch {}
			}, MAX_CYCLE_TIME_MS);

			try {
				const monitors = cache.getAllMonitors();

				if (monitors.length === 0) {
					await sleep(1000, signal);
					continue;
				}

				this.cycleCount++;
				const cycleStart = Date.now();
				const now = Date.now();

				// Classify what needs updating
				const needsShort: Monitor[] = [];
				const needsLong: Monitor[] = [];
				const missingFirstPulse: string[] = [];

				for (const m of monitors) {
					const c = this.cache.get(m.id);
					if (!c || now - c.shortRefreshedAt >= SHORT_MAX_AGE) needsShort.push(m);
					if (!c || now - c.longRefreshedAt >= LONG_MAX_AGE) needsLong.push(m);
					if (!cache.getStatus(m.id)?.firstPulse) missingFirstPulse.push(m.id);
				}

				// Step 1: Batch fetch first pulses (once per monitor lifetime)
				if (missingFirstPulse.length > 0) {
					await this.batchFetchFirstPulses(missingFirstPulse, cycleAbort.signal);
				}

				// Step 2: Batch short uptimes
				let refreshedShort = 0;
				if (needsShort.length > 0) {
					refreshedShort = await this.batchRefreshShort(needsShort, now, cycleAbort.signal);
				}

				// Step 3: Batch long uptimes
				let refreshedLong = 0;
				if (needsLong.length > 0) {
					refreshedLong = await this.batchRefreshLong(needsLong, now, cycleAbort.signal);
				}

				// Step 4: Recombine and write to status cache
				const updatedIds = new Set<string>();
				for (const m of needsShort) updatedIds.add(m.id);
				for (const m of needsLong) updatedIds.add(m.id);

				for (const monitorId of updatedIds) {
					this.writeToStatusCache(monitorId);
				}

				// Step 5: Update parent groups
				for (const monitorId of updatedIds) {
					propagateGroupStatus(monitorId);
				}

				const skipped = monitors.length - updatedIds.size;

				Logger.debug("Uptime updater cycle complete", {
					cycle: this.cycleCount,
					monitors: monitors.length,
					refreshedShort,
					refreshedLong,
					skipped,
					duration_ms: Date.now() - cycleStart,
					cacheSize: this.cache.size,
				});

				await sleep(1000, signal);
			} catch (err) {
				if (!signal.aborted) {
					Logger.error("Background uptime loop error", {
						error: err instanceof Error ? err.message : "Unknown",
						cycle: this.cycleCount,
					});
				}
				await sleep(5000, signal);
			} finally {
				clearTimeout(cycleTimer);
				this.currentCycleAbort = null;
				this.isCycling = false;
			}
		}
	}

	private async batchFetchFirstPulses(monitorIds: string[], abortSignal: AbortSignal): Promise<void> {
		try {
			for (let i = 0; i < monitorIds.length; i += BULK_CHUNK_SIZE) {
				const chunk = monitorIds.slice(i, i + BULK_CHUNK_SIZE);

				const query = `
					SELECT monitor_id, min(ts) AS first_pulse
					FROM (
						SELECT monitor_id, timestamp AS ts
						FROM pulses
						WHERE monitor_id IN ({monitorIds:Array(String)})
						UNION ALL
						SELECT monitor_id, toDateTime(timestamp) AS ts
						FROM pulses_daily
						WHERE monitor_id IN ({monitorIds:Array(String)})
					)
					GROUP BY monitor_id
				`;

				const result = await queryWithTimeout(query, { monitorIds: chunk }, abortSignal);
				const data = await withTimeout(result.json<{ monitor_id: string; first_pulse: string }>(), QUERY_TIMEOUT_MS, "batchFetchFirstPulses.json()");

				for (const row of data) {
					const prevStatus = cache.getStatus(row.monitor_id);
					if (prevStatus && !prevStatus.firstPulse) {
						cache.setStatus(row.monitor_id, {
							...prevStatus,
							firstPulse: new Date(row.first_pulse),
						});
					}
				}
			}
		} catch (err) {
			Logger.error("Batch fetch first pulses failed", {
				error: err instanceof Error ? err.message : "Unknown",
				count: monitorIds.length,
			});
		}
	}

	private async batchRefreshShort(monitors: Monitor[], now: number, abortSignal: AbortSignal): Promise<number> {
		const byInterval = new Map<number, Monitor[]>();
		let refreshed = 0;

		for (const m of monitors) {
			const group = byInterval.get(m.interval) || [];
			group.push(m);
			byInterval.set(m.interval, group);
		}

		for (const [interval, intervalMonitors] of byInterval) {
			const monitorIds = intervalMonitors.map((m) => m.id);

			try {
				for (let i = 0; i < monitorIds.length; i += BULK_CHUNK_SIZE) {
					const chunk = monitorIds.slice(i, i + BULK_CHUNK_SIZE);

					const [uptimes1h, uptimes24h] = await Promise.all([
						this.bulkPulseCounts(chunk, interval, "1 HOUR", abortSignal),
						this.bulkPulseCounts(chunk, interval, "24 HOUR", abortSignal),
					]);

					for (const monitorId of chunk) {
						const uptime1h = this.adjustForNewMonitor(uptimes1h.get(monitorId), monitorId, interval, 3_600_000);
						const uptime24h = this.adjustForNewMonitor(uptimes24h.get(monitorId), monitorId, interval, 86_400_000);

						const existing = this.cache.get(monitorId);
						if (existing) {
							existing.uptime1h = uptime1h;
							existing.uptime24h = uptime24h;
							existing.shortRefreshedAt = now;
						} else {
							this.cache.set(monitorId, {
								uptime1h,
								uptime24h,
								uptime7d: UPTIME_PENDING,
								uptime30d: UPTIME_PENDING,
								uptime90d: UPTIME_PENDING,
								uptime365d: UPTIME_PENDING,
								hist7d: { total_uptime: null, days_with_data: 0, historical_days: 0 },
								hist30d: { total_uptime: null, days_with_data: 0, historical_days: 0 },
								hist90d: { total_uptime: null, days_with_data: 0, historical_days: 0 },
								hist365d: { total_uptime: null, days_with_data: 0, historical_days: 0 },
								shortRefreshedAt: now,
								longRefreshedAt: 0,
							});
						}

						refreshed++;
					}
				}
			} catch (err) {
				Logger.error("Batch short uptime refresh failed", {
					error: err instanceof Error ? err.message : "Unknown",
					interval,
					count: monitorIds.length,
				});
			}
		}

		return refreshed;
	}

	private adjustForNewMonitor(uptimeFromCH: number | undefined, monitorId: string, interval: number, periodMs: number): number {
		const firstPulse = cache.getStatus(monitorId)?.firstPulse;

		// Monitor didn't exist during this period at all
		if (firstPulse && Date.now() - firstPulse.getTime() < periodMs) {
			const monitorAgeMs = Date.now() - firstPulse.getTime();
			const adjustedExpected = Math.floor(monitorAgeMs / (interval * 1000));
			if (adjustedExpected === 0) return 100;

			if (uptimeFromCH !== undefined) {
				const fullExpected = Math.floor(periodMs / (interval * 1000));
				if (fullExpected === 0) return 100;
				const actualCount = (uptimeFromCH / 100) * fullExpected;
				return Math.min(100, (actualCount * 100) / adjustedExpected);
			}

			return 100; // no pulses but monitor just started
		}

		// Established monitor with no pulses in period
		if (uptimeFromCH === undefined) return 0;

		return uptimeFromCH;
	}

	/**
	 * Single CH query: count distinct pulse intervals per monitor for a time period.
	 * Returns Map<monitorId, count>.
	 */
	private async bulkPulseCounts(monitorIds: string[], interval: number, period: string, abortSignal: AbortSignal): Promise<Map<string, number>> {
		const query = `
			WITH
				expected AS (
					SELECT floor(
						(toUnixTimestamp(now()) - toUnixTimestamp(now() - INTERVAL ${period}))
						/ ${interval}
					) AS cnt
				)
			SELECT
				monitor_id,
				CASE
					WHEN (SELECT cnt FROM expected) = 0 THEN 100
					ELSE LEAST(100,
						COUNT(DISTINCT toStartOfInterval(timestamp, INTERVAL ${interval} SECOND))
						* 100.0
						/ (SELECT cnt FROM expected)
					)
				END AS uptime
			FROM pulses
			WHERE monitor_id IN ({monitorIds:Array(String)})
				AND timestamp >= now() - INTERVAL ${period}
				AND timestamp < now()
			GROUP BY monitor_id
		`;

		const result = await queryWithTimeout(query, { monitorIds }, abortSignal);
		const data = await withTimeout(result.json<{ monitor_id: string; uptime: number }>(), QUERY_TIMEOUT_MS, `bulkPulseCounts.json(${period})`);

		const map = new Map<string, number>();
		for (const row of data) {
			map.set(row.monitor_id, row.uptime);
		}
		return map;
	}

	private async batchRefreshLong(monitors: Monitor[], now: number, abortSignal: AbortSignal): Promise<number> {
		const monitorIds = monitors.map((m) => m.id);
		let refreshed = 0;

		try {
			for (let i = 0; i < monitorIds.length; i += BULK_CHUNK_SIZE) {
				const chunk = monitorIds.slice(i, i + BULK_CHUNK_SIZE);

				const [raw7d, raw30d, raw90d, raw365d] = await Promise.all([
					this.bulkHistoricalDaily(chunk, 7, abortSignal),
					this.bulkHistoricalDaily(chunk, 30, abortSignal),
					this.bulkHistoricalDaily(chunk, 90, abortSignal),
					this.bulkHistoricalDaily(chunk, 365, abortSignal),
				]);

				const today = new Date();
				today.setUTCHours(0, 0, 0, 0);
				const todayMs = today.getTime();

				for (const monitorId of chunk) {
					const firstPulse = cache.getStatus(monitorId)?.firstPulse;

					const hist7d = this.toHistoricalDaily(raw7d.get(monitorId), 7, firstPulse, todayMs);
					const hist30d = this.toHistoricalDaily(raw30d.get(monitorId), 30, firstPulse, todayMs);
					const hist90d = this.toHistoricalDaily(raw90d.get(monitorId), 90, firstPulse, todayMs);
					const hist365d = this.toHistoricalDaily(raw365d.get(monitorId), 365, firstPulse, todayMs);

					const existing = this.cache.get(monitorId);
					if (existing) {
						existing.hist7d = hist7d;
						existing.hist30d = hist30d;
						existing.hist90d = hist90d;
						existing.hist365d = hist365d;
						existing.longRefreshedAt = now;

						// Recombine with current uptime24h
						existing.uptime7d = combineHistWithToday(hist7d, existing.uptime24h);
						existing.uptime30d = combineHistWithToday(hist30d, existing.uptime24h);
						existing.uptime90d = combineHistWithToday(hist90d, existing.uptime24h);
						existing.uptime365d = combineHistWithToday(hist365d, existing.uptime24h);
					}
					// If no existing entry, short refresh will create it next cycle

					refreshed++;
				}
			}
		} catch (err) {
			Logger.error("Batch long uptime refresh failed", {
				error: err instanceof Error ? err.message : "Unknown",
				count: monitorIds.length,
			});
		}

		return refreshed;
	}

	/**
	 * Single CH query: SUM(uptime) and COUNT(*) per monitor for a day range.
	 * Returns Map<monitorId, {total_uptime, days_with_data}>.
	 */
	private async bulkHistoricalDaily(
		monitorIds: string[],
		days: number,
		abortSignal: AbortSignal,
	): Promise<Map<string, { total_uptime: number | null; days_with_data: number }>> {
		const query = `
			SELECT
				monitor_id,
				SUM(uptime) AS total_uptime,
				COUNT(*) AS days_with_data
			FROM pulses_daily
			WHERE monitor_id IN ({monitorIds:Array(String)})
				AND timestamp >= toDate(now() - INTERVAL ${days} DAY)
				AND timestamp < toDate(now())
			GROUP BY monitor_id
		`;

		const result = await queryWithTimeout(query, { monitorIds }, abortSignal);
		const data = await withTimeout(
			result.json<{ monitor_id: string; total_uptime: number | null; days_with_data: number }>(),
			QUERY_TIMEOUT_MS,
			`bulkHistoricalDaily.json(${days}d)`,
		);

		const map = new Map<string, { total_uptime: number | null; days_with_data: number }>();
		for (const row of data) {
			map.set(row.monitor_id, { total_uptime: row.total_uptime, days_with_data: row.days_with_data });
		}
		return map;
	}

	/**
	 * Convert raw CH result + firstPulse into HistoricalDaily struct
	 */
	private toHistoricalDaily(
		raw: { total_uptime: number | null; days_with_data: number } | undefined,
		days: number,
		firstPulse: Date | undefined,
		todayMs: number,
	): HistoricalDaily {
		const periodStartDate = new Date(todayMs - days * 86_400_000);
		const effectiveStartDate = firstPulse ? new Date(Math.max(periodStartDate.getTime(), firstPulse.getTime())) : periodStartDate;

		// historical_days = difference in days between today and effective start
		const historicalDays = Math.floor((todayMs - effectiveStartDate.getTime()) / 86_400_000);

		if (!raw) {
			return { total_uptime: null, days_with_data: 0, historical_days: historicalDays };
		}

		return {
			total_uptime: raw.total_uptime,
			days_with_data: raw.days_with_data,
			historical_days: historicalDays,
		};
	}

	private writeToStatusCache(monitorId: string): void {
		const cached = this.cache.get(monitorId);
		if (!cached) return;

		const prevStatus = cache.getStatus(monitorId);
		if (!prevStatus) return;

		const uptimes = {
			uptime1h: cached.uptime1h,
			uptime24h: cached.uptime24h,
			uptime7d: combineHistWithToday(cached.hist7d, cached.uptime24h),
			uptime30d: combineHistWithToday(cached.hist30d, cached.uptime24h),
			uptime90d: combineHistWithToday(cached.hist90d, cached.uptime24h),
			uptime365d: combineHistWithToday(cached.hist365d, cached.uptime24h),
		};

		cache.setStatus(monitorId, {
			...prevStatus,
			...uptimes,
		});
	}
}

function combineHistWithToday(hist: HistoricalDaily, uptime24h: number): number {
	if (uptime24h === UPTIME_PENDING) return UPTIME_PENDING;
	if (hist.historical_days <= 0 && hist.days_with_data === 0) {
		return uptime24h;
	}
	const daysToAverage = hist.days_with_data + 1;
	if (hist.total_uptime === null || hist.days_with_data === 0) {
		return uptime24h;
	}
	return (hist.total_uptime + uptime24h) / daysToAverage;
}

async function queryWithTimeout(query: string, params: Record<string, any>, abortSignal: AbortSignal) {
	return withTimeout(
		clickhouse.query({
			query,
			query_params: params,
			format: "JSONEachRow",
			abort_signal: abortSignal,
			clickhouse_settings: {
				date_time_output_format: "iso",
				max_execution_time: Math.floor(QUERY_TIMEOUT_MS / 1000),
			},
		}),
		QUERY_TIMEOUT_MS,
		"clickhouse.query()",
	);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(done, ms);

		function done() {
			clearTimeout(timer);
			if (signal) signal.removeEventListener("abort", onAbort);
			resolve();
		}

		function onAbort() {
			done();
		}

		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export const uptimeUpdater = new UptimeUpdater();
