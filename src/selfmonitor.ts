import { cache } from "./cache";
import { clickhouse, storePulse } from "./clickhouse";
import { config } from "./config";
import { Logger } from "./logger";
import { formatDateTimeISOCompact } from "./times";
import type { DowntimeRecord, SelfMonitoringConfig, CustomMetrics } from "./types";

export class SelfMonitor {
	private intervalId?: NodeJS.Timeout;
	private lastCheckTime?: Date;
	private isHealthy: boolean = true;
	private config: SelfMonitoringConfig;
	private downtimeStart?: Date;
	private nextScheduledTime?: number;
	private consecutiveFailures: number = 0;
	private isBackfilling: boolean = false;

	constructor(config: SelfMonitoringConfig) {
		this.config = config;
	}

	async start(): Promise<void> {
		if (!this.config.enabled || this.intervalId) return;

		Logger.info("Starting self-monitor", {
			monitorId: this.config.id,
			interval: this.config.interval,
			backfillOnRecovery: this.config.backfillOnRecovery,
			latencyStrategy: this.config.latencyStrategy,
		});

		await this.checkForPreviousDowntime();

		await this.performHealthCheck();

		this.nextScheduledTime = Date.now() + this.config.interval * 1000;
		this.scheduleNextCheck();
	}

	private scheduleNextCheck(): void {
		if (!this.config.enabled || !this.nextScheduledTime) return;

		const now = Date.now();
		const delay = Math.max(0, this.nextScheduledTime - now);

		if (delay === 0 && now - this.nextScheduledTime > 1000) {
			Logger.warn("Self-monitor falling behind schedule", {
				behindBy: Math.round((now - this.nextScheduledTime) / 1000) + "s",
			});
		}

		this.intervalId = setTimeout(async () => {
			this.nextScheduledTime! += this.config.interval * 1000;

			await this.performHealthCheck();

			this.scheduleNextCheck();
		}, delay);
	}

	stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = undefined;
		}

		Logger.info("Self-monitor shutting down cleanly", {
			wasHealthy: this.isHealthy,
			lastCheck: this.lastCheckTime,
		});
	}

	private async performHealthCheck(): Promise<void> {
		const checkStartTime = Date.now();

		try {
			const queryStartTime = Date.now();
			await clickhouse.query({
				query: "SELECT 1",
				format: "JSONEachRow",
			});
			const latency = Date.now() - queryStartTime;

			this.lastCheckTime = new Date(queryStartTime);

			await storePulse(this.config.id, latency, this.lastCheckTime);

			if (!this.isHealthy) {
				await this.handleRecovery();
			}

			this.isHealthy = true;
			this.consecutiveFailures = 0;

			const totalDuration = Date.now() - checkStartTime;
			if (totalDuration > this.config.interval * 500) {
				Logger.warn("Self-monitor health check took significant time", {
					totalDuration: totalDuration + "ms",
					queryLatency: latency + "ms",
					overhead: totalDuration - latency + "ms",
				});
			}
		} catch (error) {
			this.consecutiveFailures++;

			Logger.error("Self-monitor health check failed", {
				error: error instanceof Error ? error.message : "Unknown error",
				consecutiveFailures: this.consecutiveFailures,
			});

			if (this.isHealthy) {
				this.downtimeStart = new Date();
				this.isHealthy = false;

				Logger.error("Self-monitor marked as DOWN", {
					downtimeStart: this.downtimeStart,
					afterFailures: this.consecutiveFailures,
				});
			}
		}
	}

	private async checkForPreviousDowntime(): Promise<void> {
		if (!this.config.backfillOnRecovery) return;

		try {
			const lastHealthyQuery = `
				SELECT
					formatDateTime(MAX(timestamp), '%Y-%m-%dT%H:%i:%sZ') AS last_healthy
				FROM pulses
				WHERE monitor_id = {monitorId:String}
			`;

			const result = await clickhouse.query({
				query: lastHealthyQuery,
				query_params: {
					monitorId: this.config.id,
				},
				format: "JSONEachRow",
			});

			const data = await result.json<{ last_healthy: string | null }>();

			if (data[0]?.last_healthy) {
				const lastHealthy = new Date(data[0].last_healthy);
				const now = new Date();
				const downtimeDuration = now.getTime() - lastHealthy.getTime();

				const minDowntimeForBackfill = this.config.interval * 2000;

				if (downtimeDuration > minDowntimeForBackfill) {
					Logger.info("Detected previous downtime of uptime monitor", {
						lastHealthy: lastHealthy.toISOString(),
						duration: Math.round(downtimeDuration / 1000) + "s",
						threshold: Math.round(minDowntimeForBackfill / 1000) + "s",
					});

					await this.backfillPulses({
						startTime: lastHealthy,
						endTime: now,
						duration: downtimeDuration,
					});
				}
			} else {
				Logger.info("No previous self-monitor pulses found");
			}
		} catch (error) {
			Logger.error("Failed to check for previous downtime", {
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	}

	private async handleRecovery(): Promise<void> {
		if (!this.downtimeStart || !this.config.backfillOnRecovery) return;

		const downtimeEnd = new Date();
		const downtimeDuration = downtimeEnd.getTime() - this.downtimeStart.getTime();

		Logger.info("Self-monitor recovered from downtime", {
			downtimeStart: this.downtimeStart,
			downtimeEnd,
			duration: Math.round(downtimeDuration / 1000) + "s",
		});

		if (downtimeDuration > this.config.interval * 1000) {
			await this.backfillPulses({
				startTime: this.downtimeStart,
				endTime: downtimeEnd,
				duration: downtimeDuration,
			});
		}

		this.downtimeStart = undefined;
	}

	private async backfillPulses(downtime: DowntimeRecord): Promise<void> {
		if (this.isBackfilling) {
			Logger.warn("Backfill already in progress, skipping");
			return;
		}

		this.isBackfilling = true;
		const startTime = Date.now();

		try {
			const monitors = cache.getAllMonitors();
			let processedMonitors = 0;
			let totalSyntheticPulses = 0;

			for (const monitor of monitors) {
				if (monitor.id === this.config.id) continue;

				const checkWindowMs = monitor.interval * 2000;

				const lastPulseQuery = `
				SELECT
					timestamp,
					latency,
					custom1,
					custom2,
					custom3
				FROM pulses
				WHERE
					monitor_id = {monitorId:String}
					AND timestamp >= '${formatDateTimeISOCompact(new Date(downtime.startTime.getTime() - checkWindowMs))}'
					AND timestamp < '${formatDateTimeISOCompact(downtime.startTime)}'
					AND synthetic = false
				ORDER BY timestamp DESC
				LIMIT 1
			`;

				try {
					const result = await clickhouse.query({
						query: lastPulseQuery,
						query_params: {
							monitorId: monitor.id,
						},
						format: "JSONEachRow",
					});

					const data = await result.json<{
						timestamp: string;
						latency: number | null;
						custom1: number | null;
						custom2: number | null;
						custom3: number | null;
					}>();

					// If we found at least one pulse in the check window, consider monitor as healthy
					if (data.length > 0 && data[0]) {
						const lastPulse = data[0];
						const latency = this.config.latencyStrategy === "last-known" ? lastPulse.latency : null;

						// Preserve custom metrics from last known pulse
						const customMetrics: CustomMetrics =
							this.config.latencyStrategy === "last-known"
								? {
										custom1: lastPulse.custom1,
										custom2: lastPulse.custom2,
										custom3: lastPulse.custom3,
								  }
								: {
										custom1: null,
										custom2: null,
										custom3: null,
								  };

						const pulseInterval = monitor.interval * 1000;

						const now = Date.now();
						const currentIntervalStart = Math.floor(now / pulseInterval) * pulseInterval;

						let backfillStartTime = downtime.startTime.getTime();
						let backfillEndTime = Math.max(downtime.endTime.getTime(), currentIntervalStart + pulseInterval);

						const firstPulseTime = Math.ceil(backfillStartTime / pulseInterval) * pulseInterval;
						const pulsesToGenerate = Math.floor((backfillEndTime - firstPulseTime) / pulseInterval) + 1;

						// Limit synthetic pulses per monitor to avoid overwhelming
						const maxPulsesPerMonitor = 10000;
						const limitedPulses = Math.min(pulsesToGenerate, maxPulsesPerMonitor);

						if (limitedPulses !== pulsesToGenerate) {
							Logger.warn("Limiting synthetic pulses for monitor", {
								monitorId: monitor.id,
								requested: pulsesToGenerate,
								limited: limitedPulses,
							});
						}

						// Batch create synthetic pulses
						const syntheticPulses = [];
						let currentTime = firstPulseTime;

						for (let i = 0; i < limitedPulses; i++) {
							// Don't generate pulses too far in the future
							if (currentTime > now + pulseInterval) {
								break;
							}

							syntheticPulses.push({
								monitor_id: monitor.id,
								latency,
								timestamp: formatDateTimeISOCompact(new Date(currentTime), { includeMilliseconds: true }),
								synthetic: true,
								custom1: customMetrics.custom1,
								custom2: customMetrics.custom2,
								custom3: customMetrics.custom3,
							});
							currentTime += pulseInterval;
						}

						const coversCurrentInterval = syntheticPulses.some((pulse) => {
							const pulseTime = new Date(pulse.timestamp).getTime();
							return pulseTime >= currentIntervalStart && pulseTime < currentIntervalStart + pulseInterval;
						});

						if (!coversCurrentInterval && currentIntervalStart >= downtime.startTime.getTime()) {
							// Add a pulse for the current interval if not already covered
							syntheticPulses.push({
								monitor_id: monitor.id,
								latency,
								timestamp: formatDateTimeISOCompact(new Date(currentIntervalStart), { includeMilliseconds: true }),
								synthetic: true,
								custom1: customMetrics.custom1,
								custom2: customMetrics.custom2,
								custom3: customMetrics.custom3,
							});

							Logger.debug("Added pulse for current interval", {
								monitorId: monitor.id,
								currentInterval: {
									start: new Date(currentIntervalStart).toISOString(),
									end: new Date(currentIntervalStart + pulseInterval).toISOString(),
								},
							});
						}

						if (syntheticPulses.length > 0) {
							// Insert in batches to avoid query size limits
							const batchSize = 100;
							for (let i = 0; i < syntheticPulses.length; i += batchSize) {
								const batch = syntheticPulses.slice(i, i + batchSize);
								await clickhouse.insert({
									table: "pulses",
									values: batch,
									format: "JSONEachRow",
								});
							}

							totalSyntheticPulses += syntheticPulses.length;
							processedMonitors++;

							Logger.info("Backfilled synthetic pulses for monitor", {
								monitorId: monitor.id,
								monitorName: monitor.name,
								pulseCount: syntheticPulses.length,
								lastPulseTime: lastPulse.timestamp,
								lastKnownLatency: lastPulse.latency,
								syntheticLatency: latency,
								latencyStrategy: this.config.latencyStrategy,
								currentInterval: {
									start: new Date(currentIntervalStart).toISOString(),
									end: new Date(currentIntervalStart + pulseInterval).toISOString(),
									covered: coversCurrentInterval || syntheticPulses.length > 0,
								},
							});
						}
					} else {
						Logger.debug("Skipping backfill - no pulse found in check window", {
							monitorId: monitor.id,
							monitorName: monitor.name,
							checkWindowSeconds: checkWindowMs / 1000,
						});
					}
				} catch (error) {
					Logger.error("Failed to backfill monitor", {
						monitorId: monitor.id,
						error: error instanceof Error ? error.message : "Unknown error",
					});
				}
			}

			const duration = Date.now() - startTime;
			Logger.info("Completed backfill operation", {
				processedMonitors,
				totalSyntheticPulses,
				downtimeDuration: Math.round(downtime.duration / 1000) + "s",
				backfillDuration: Math.round(duration / 1000) + "s",
			});
		} finally {
			this.isBackfilling = false;
		}
	}
}

export const selfMonitor = new SelfMonitor({
	enabled: config.selfMonitoring?.enabled ?? false,
	id: config.selfMonitoring?.id ?? "self-monitor",
	interval: config.selfMonitoring?.interval ?? 3,
	backfillOnRecovery: config.selfMonitoring?.backfillOnRecovery ?? true,
	latencyStrategy: config.selfMonitoring?.latencyStrategy ?? "last-known",
});
