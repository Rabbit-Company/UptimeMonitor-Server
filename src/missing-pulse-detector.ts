import { cache } from "./cache";
import { eventEmitter } from "./clickhouse";
import { config } from "./config";
import { Logger } from "./logger";
import { NotificationManager } from "./notifications";
import { GRACE_PERIOD, isInGracePeriod, STARTUP_TIME } from "./times";
import type { MissingPulseDetectorOptions, Monitor, NotificationsConfig } from "./types";

export class MissingPulseDetector {
	private checkInterval: number;
	private intervalId?: NodeJS.Timeout;
	private missedPulses: Map<string, number> = new Map();
	private lastNotification: Map<string, number> = new Map();
	private consecutiveDownCounts: Map<string, number> = new Map();
	private lastNotificationDownCount: Map<string, number> = new Map();
	private downStartTimes: Map<string, number> = new Map();
	private notificationManager: NotificationManager;

	constructor(options: MissingPulseDetectorOptions = {}) {
		this.checkInterval = options.checkInterval || 30000; // Check every 30 seconds globally
		this.notificationManager = new NotificationManager(config.notifications || { channels: {} });
	}

	/**
	 * Start the missing pulse detection
	 */
	start(): void {
		if (this.intervalId) {
			Logger.warn("Missing pulse detector already running");
			return;
		}

		Logger.info("Starting missing pulse detector", {
			checkInterval: this.checkInterval,
			monitorCount: cache.getAllMonitors().length,
		});

		// Run immediately on start
		this.detectMissingPulses();

		// Then run at regular intervals
		this.intervalId = setInterval(() => {
			this.detectMissingPulses();
		}, this.checkInterval);
	}

	/**
	 * Stop the missing pulse detection
	 */
	stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = undefined;
			Logger.info("Stopped missing pulse detector");
		}
	}

	/**
	 * Check all monitors for missing pulses
	 */
	private async detectMissingPulses(): Promise<void> {
		const now = Date.now();
		const detectionPromises: Promise<void>[] = [];

		cache.getAllMonitors().forEach((monitor) => {
			detectionPromises.push(this.checkMonitor(monitor, now));
		});

		await Promise.allSettled(detectionPromises);
	}

	/**
	 * Check a single monitor for missing pulses
	 */
	private async checkMonitor(monitor: Monitor, now: number): Promise<void> {
		try {
			const status = cache.getStatus(monitor.id);

			// No status data yet - monitor hasn't sent its first pulse
			if (!status) {
				// Check if enough time has passed since startup to consider this a problem
				const timeSinceStartup = now - STARTUP_TIME;
				const expectedInterval = monitor.interval * 1000;
				const maxAllowedInterval = expectedInterval * monitor.toleranceFactor;

				// Only start checking after grace period + one full interval
				if (timeSinceStartup > GRACE_PERIOD + maxAllowedInterval) {
					Logger.warn("Monitor has never sent a pulse", {
						monitorId: monitor.id,
						monitorName: monitor.name,
						timeSinceStartup: Math.round(timeSinceStartup / 1000) + "s",
						gracePeriod: GRACE_PERIOD / 1000 + "s",
					});
				}
				return;
			}

			const lastCheck = status?.lastCheck?.getTime();

			if (!lastCheck) {
				// No data yet, skip
				Logger.debug("No last check time for monitor", { monitorId: monitor.id });
				return;
			}

			const expectedInterval = monitor.interval * 1000; // Convert to ms
			const maxAllowedInterval = expectedInterval * monitor.toleranceFactor; // Use monitor-specific tolerance
			const timeSinceLastCheck = now - lastCheck;

			// Monitor is considered down if no pulse received within tolerance
			if (timeSinceLastCheck > maxAllowedInterval) {
				await this.handleMissingPulse(monitor, timeSinceLastCheck, expectedInterval, now);
			} else {
				// Monitor is up - reset counters if it was previously down
				if (this.missedPulses.has(monitor.id)) {
					this.missedPulses.delete(monitor.id);
				}
			}
		} catch (error) {
			Logger.error("Error checking monitor for missing pulses", {
				monitorId: monitor.id,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	}

	/**
	 * Handle a detected missing pulse
	 */
	private async handleMissingPulse(monitor: Monitor, timeSinceLastCheck: number, expectedInterval: number, now: number): Promise<void> {
		const missedCount = (this.missedPulses.get(monitor.id) || 0) + 1;
		this.missedPulses.set(monitor.id, missedCount);

		const missedIntervals = Math.floor(timeSinceLastCheck / expectedInterval);

		Logger.warn("Missing pulse detected", {
			monitorId: monitor.id,
			monitorName: monitor.name,
			timeSinceLastCheck: Math.round(timeSinceLastCheck / 1000) + "s",
			expectedInterval: expectedInterval / 1000 + "s",
			toleranceFactor: monitor.toleranceFactor,
			missedIntervals,
			consecutiveMisses: missedCount,
			maxRetries: monitor.maxRetries,
			inGracePeriod: isInGracePeriod(),
		});

		// Don't mark monitors as down during grace period
		if (isInGracePeriod()) {
			Logger.info("Skipping status change during grace period", {
				monitorId: monitor.id,
				monitorName: monitor.name,
			});
			return;
		}

		// Only mark as down after maxRetries consecutive misses
		if (missedCount > monitor.maxRetries) {
			const currentStatus = cache.getStatus(monitor.id);

			// Monitor is now considered down
			// In the up-pulse-only system, we don't store down pulses
			// The absence of recent pulses indicates the down state

			// Increment consecutive down count
			const currentDownCount = (this.consecutiveDownCounts.get(monitor.id) || 0) + 1;
			this.consecutiveDownCounts.set(monitor.id, currentDownCount);

			// Check if this is the first time going down (transition from up to down)
			const wasUp = currentStatus?.status === "up" || !this.consecutiveDownCounts.has(monitor.id);

			if (wasUp || !this.downStartTimes.has(monitor.id)) {
				const status = cache.getStatus(monitor.id);
				const lastSuccessfulPulse = status?.lastCheck?.getTime() || now;
				const downStartTime = lastSuccessfulPulse + monitor.interval * monitor.toleranceFactor * 1000;

				this.downStartTimes.set(monitor.id, downStartTime);

				Logger.error("Monitor marked as down due to missing pulses", {
					monitorId: monitor.id,
					monitorName: monitor.name,
					consecutiveMisses: missedCount,
					lastCheckTime: currentStatus?.lastCheck,
					consecutiveDownCount: currentDownCount,
					downStartTime: new Date(downStartTime).toISOString(),
				});
			}

			if (this.shouldSendNotification(monitor)) {
				const downStartTime = this.downStartTimes.get(monitor.id) || now;
				const actualDowntime = now - downStartTime;

				if (currentDownCount === 1) {
					this.notifyMonitorDown(monitor, actualDowntime);
				} else {
					this.notifyMonitorStillDown(monitor, currentDownCount, actualDowntime);
				}
			}
		}
	}

	/**
	 * Determine if a notification should be sent based on resendNotification setting
	 */
	private shouldSendNotification(monitor: Monitor): boolean {
		const currentDownCount = this.consecutiveDownCounts.get(monitor.id) || 0;
		const lastNotificationCount = this.lastNotificationDownCount.get(monitor.id) || 0;

		// First notification (monitor just went down)
		if (currentDownCount === 1) {
			return true;
		}

		// Resend notifications disabled
		if (monitor.resendNotification === 0) {
			return false;
		}

		// Check if enough consecutive down checks have passed since last notification
		const downsSinceLastNotification = currentDownCount - lastNotificationCount;
		return downsSinceLastNotification >= monitor.resendNotification;
	}

	/**
	 * Send notification about monitor being down
	 */
	private async notifyMonitorDown(monitor: Monitor, downtime: number): Promise<void> {
		const now = Date.now();
		this.lastNotification.set(monitor.id, now);

		const currentDownCount = this.consecutiveDownCounts.get(monitor.id) || 1;
		this.lastNotificationDownCount.set(monitor.id, currentDownCount);

		Logger.error("MONITOR DOWN", {
			monitorId: monitor.id,
			monitorName: monitor.name,
			downtime: Math.round(downtime / 1000) + "s",
			message: `Monitor "${monitor.name}" is DOWN - has not sent a pulse for ${Math.round(downtime / 60000)} minutes`,
		});

		if (monitor.notificationChannels && monitor.notificationChannels.length > 0) {
			await this.notificationManager.sendNotification(monitor.notificationChannels, {
				type: "down",
				monitorId: monitor.id,
				monitorName: monitor.name,
				downtime,
				timestamp: new Date(),
				sourceType: "monitor",
			});
		}

		// Emit event for notification system integration
		eventEmitter.emit("monitor-notification", {
			type: "down",
			monitorId: monitor.id,
			monitorName: monitor.name,
			downtime,
			timestamp: new Date(),
		});
	}

	/**
	 * Send notification about monitor still being down
	 */
	private async notifyMonitorStillDown(monitor: Monitor, consecutiveDownCount: number, actualDowntime: number): Promise<void> {
		const now = Date.now();
		this.lastNotification.set(monitor.id, now);
		this.lastNotificationDownCount.set(monitor.id, consecutiveDownCount);

		Logger.error("MONITOR STILL DOWN", {
			monitorId: monitor.id,
			monitorName: monitor.name,
			consecutiveDownCount,
			actualDowntime: Math.round(actualDowntime / 1000) + "s",
			message: `Monitor "${monitor.name}" is still DOWN - ${consecutiveDownCount} consecutive down checks`,
		});

		if (monitor.notificationChannels && monitor.notificationChannels.length > 0) {
			await this.notificationManager.sendNotification(monitor.notificationChannels, {
				type: "still-down",
				monitorId: monitor.id,
				monitorName: monitor.name,
				consecutiveDownCount,
				downtime: actualDowntime,
				timestamp: new Date(),
				sourceType: "monitor",
			});
		}

		// Emit event for notification system integration
		eventEmitter.emit("monitor-notification", {
			type: "still-down",
			monitorId: monitor.id,
			monitorName: monitor.name,
			consecutiveDownCount,
			downtime: actualDowntime,
			timestamp: new Date(),
		});
	}

	/**
	 * Get current status of missing pulse detection
	 */
	getStatus(): {
		running: boolean;
		checkInterval: number;
		monitorsWithMissingPulses: Array<{
			monitorId: string;
			monitorName: string;
			missedCount: number;
			maxRetries: number;
			toleranceFactor: number;
			consecutiveDownCount: number;
			resendNotification: number;
			actualDowntime?: number;
		}>;
	} {
		const monitorsWithMissingPulses = [];
		const now = Date.now();

		for (const [monitorId, missedCount] of this.missedPulses.entries()) {
			const monitor = cache.getMonitor(monitorId);
			if (!monitor) continue;

			const consecutiveDownCount = this.consecutiveDownCounts.get(monitorId) || 0;
			const downStartTime = this.downStartTimes.get(monitorId);
			const actualDowntime = downStartTime ? now - downStartTime : undefined;

			monitorsWithMissingPulses.push({
				monitorId,
				monitorName: monitor.name,
				missedCount,
				maxRetries: monitor.maxRetries,
				toleranceFactor: monitor.toleranceFactor,
				consecutiveDownCount,
				resendNotification: monitor.resendNotification,
				actualDowntime,
			});
		}

		return {
			running: !!this.intervalId,
			checkInterval: this.checkInterval,
			monitorsWithMissingPulses,
		};
	}

	/**
	 * Reset missed pulse count for a specific monitor
	 * Called when a pulse is received
	 */
	resetMonitor(monitorId: string): void {
		this.missedPulses.delete(monitorId);
		this.lastNotification.delete(monitorId);

		// Reset consecutive down count when monitor comes back up
		const previousDownCount = this.consecutiveDownCounts.get(monitorId);
		const downStartTime = this.downStartTimes.get(monitorId);

		if (previousDownCount && previousDownCount > 0) {
			const now = Date.now();
			const totalDowntime = downStartTime ? now - downStartTime : previousDownCount * (cache.getMonitor(monitorId)?.interval || 30) * 1000; // Fallback to estimated

			Logger.info("Monitor recovered", {
				monitorId,
				previousConsecutiveDownCount: previousDownCount,
				totalDowntime: Math.round(totalDowntime / 1000) + "s",
			});

			const monitor = cache.getMonitor(monitorId);
			if (monitor && monitor.notificationChannels && monitor.notificationChannels.length > 0) {
				this.notificationManager.sendNotification(monitor.notificationChannels, {
					type: "recovered",
					monitorId,
					monitorName: monitor.name,
					previousConsecutiveDownCount: previousDownCount,
					downtime: totalDowntime,
					timestamp: new Date(),
					sourceType: "monitor",
				});
			}

			// Emit recovery event
			eventEmitter.emit("monitor-recovered", {
				monitorId,
				previousConsecutiveDownCount: this.consecutiveDownCounts.get(monitorId),
				downtime: totalDowntime,
				timestamp: new Date(),
			});
		}

		this.consecutiveDownCounts.delete(monitorId);
		this.lastNotificationDownCount.delete(monitorId);
		this.downStartTimes.delete(monitorId);
	}

	/**
	 * Update notification configuration
	 */
	updateNotificationConfig(notificationConfig: NotificationsConfig): void {
		this.notificationManager.updateConfig(notificationConfig);
	}
}

// Export singleton instance
export const missingPulseDetector = new MissingPulseDetector();
