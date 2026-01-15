import { server } from ".";
import { cache } from "./cache";
import { updateMonitorStatus } from "./clickhouse";
import { config } from "./config";
import { Logger } from "./logger";
import { NotificationManager } from "./notifications";
import { GRACE_PERIOD, isInGracePeriod, STARTUP_TIME } from "./times";
import type { DowntimeInfo, MissingPulseDetectorOptions, Monitor, MonitorState, NotificationsConfig } from "./types";

export class MissingPulseDetector {
	private readonly checkInterval: number;
	private intervalId?: NodeJS.Timeout;
	private readonly monitorStates = new Map<string, MonitorState>();
	private readonly notificationManager: NotificationManager;

	constructor(options: MissingPulseDetectorOptions = {}) {
		this.checkInterval = options.checkInterval || 30000;
		this.notificationManager = new NotificationManager(config.notifications || { channels: {} });
	}

	/**
	 * Start the missing pulse detection
	 */
	start(): void {
		if (this.isRunning()) {
			Logger.warn("Missing pulse detector already running");
			return;
		}

		Logger.info("Starting missing pulse detector", {
			checkInterval: this.checkInterval,
			monitorCount: cache.getAllMonitors().length,
		});

		this.detectMissingPulses();

		this.intervalId = setInterval(() => {
			this.detectMissingPulses();
		}, this.checkInterval);
	}

	/**
	 * Stop the missing pulse detection
	 */
	stop(): void {
		if (!this.isRunning()) return;

		clearInterval(this.intervalId);
		this.intervalId = undefined;
		Logger.info("Stopped missing pulse detector");
	}

	/**
	 * Check if the detector is currently running
	 */
	private isRunning(): boolean {
		return !!this.intervalId;
	}

	/**
	 * Check all monitors for missing pulses
	 */
	private async detectMissingPulses(): Promise<void> {
		const now = Date.now();
		const monitors = cache.getAllMonitors();

		const detectionPromises = monitors.map((monitor) => this.checkMonitor(monitor, now));

		await Promise.allSettled(detectionPromises);
	}

	/**
	 * Check a single monitor for missing pulses
	 */
	private async checkMonitor(monitor: Monitor, now: number): Promise<void> {
		try {
			const status = cache.getStatus(monitor.id);

			if (!status) {
				this.handleNeverPulsedMonitor(monitor, now);
				return;
			}

			const lastCheck = status.lastCheck?.getTime();
			if (!lastCheck) {
				Logger.debug("No last check time for monitor", { monitorId: monitor.id });
				return;
			}

			const timeSinceLastCheck = now - lastCheck;
			const maxAllowedInterval = this.getMaxAllowedInterval(monitor);

			if (timeSinceLastCheck > maxAllowedInterval) {
				await this.handleMissingPulse(monitor, timeSinceLastCheck, now);
			} else {
				this.handleMonitorUp(monitor.id);
			}
		} catch (error) {
			Logger.error("Error checking monitor for missing pulses", {
				monitorId: monitor.id,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	}

	/**
	 * Handle monitors that have never sent a pulse
	 */
	private handleNeverPulsedMonitor(monitor: Monitor, now: number): void {
		const timeSinceStartup = now - STARTUP_TIME;
		const maxAllowedInterval = this.getMaxAllowedInterval(monitor);

		// Only log after grace period + one full interval
		if (timeSinceStartup > GRACE_PERIOD + maxAllowedInterval) {
			Logger.warn("Monitor has never sent a pulse", {
				monitorId: monitor.id,
				monitorName: monitor.name,
				timeSinceStartup: Math.round(timeSinceStartup / 1000) + "s",
				gracePeriod: GRACE_PERIOD / 1000 + "s",
			});
		}
	}

	/**
	 * Get the maximum allowed interval for a monitor
	 */
	private getMaxAllowedInterval(monitor: Monitor): number {
		return monitor.interval * 1000;
	}

	/**
	 * Handle when a monitor is detected as up
	 */
	private handleMonitorUp(monitorId: string): void {
		const state = this.getMonitorState(monitorId);
		if (state.missedCount > 0) {
			this.clearMonitorState(monitorId);
		}
	}

	/**
	 * Handle a detected missing pulse
	 */
	private async handleMissingPulse(monitor: Monitor, timeSinceLastCheck: number, now: number): Promise<void> {
		const state = this.incrementMissedCount(monitor.id);
		const expectedInterval = monitor.interval * 1000;
		const missedIntervals = Math.floor(timeSinceLastCheck / expectedInterval);

		this.logMissingPulse(monitor, timeSinceLastCheck, expectedInterval, missedIntervals, state.missedCount);

		if (isInGracePeriod()) {
			Logger.info("Skipping status change during grace period", {
				monitorId: monitor.id,
				monitorName: monitor.name,
			});
			return;
		}

		if (state.missedCount > monitor.maxRetries) {
			await this.handleMonitorDown(monitor, now);
		}
	}

	/**
	 * Log missing pulse detection
	 */
	private logMissingPulse(monitor: Monitor, timeSinceLastCheck: number, expectedInterval: number, missedIntervals: number, missedCount: number): void {
		Logger.warn("Missing pulse detected", {
			monitorId: monitor.id,
			monitorName: monitor.name,
			timeSinceLastCheck: Math.round(timeSinceLastCheck / 1000) + "s",
			expectedInterval: expectedInterval / 1000 + "s",
			missedIntervals,
			consecutiveMisses: missedCount,
			maxRetries: monitor.maxRetries,
			inGracePeriod: isInGracePeriod(),
		});
	}

	/**
	 * Handle when a monitor is confirmed down
	 */
	private async handleMonitorDown(monitor: Monitor, now: number): Promise<void> {
		const state = this.incrementDownCount(monitor.id);
		const isFirstDown = state.consecutiveDownCount === 1;

		if (isFirstDown || !state.downStartTime) {
			this.initializeDowntime(monitor, now);
		}

		await updateMonitorStatus(monitor.id);

		if (this.shouldSendNotification(monitor, state)) {
			const downtimeInfo = this.getDowntimeInfo(monitor.id, now);
			await this.sendDownNotification(monitor, state, downtimeInfo);
		}
	}

	/**
	 * Initialize downtime tracking for a monitor
	 */
	private initializeDowntime(monitor: Monitor, now: number): void {
		const status = cache.getStatus(monitor.id);
		const lastSuccessfulPulse = status?.lastCheck?.getTime() || now;
		const downStartTime = lastSuccessfulPulse + this.getMaxAllowedInterval(monitor);

		const state = this.getMonitorState(monitor.id);
		state.downStartTime = downStartTime;

		Logger.error("Monitor marked as down due to missing pulses", {
			monitorId: monitor.id,
			monitorName: monitor.name,
			consecutiveMisses: state.missedCount,
			lastCheckTime: status?.lastCheck,
			consecutiveDownCount: state.consecutiveDownCount,
			downStartTime: new Date(downStartTime).toISOString(),
		});
	}

	/**
	 * Get downtime information for a monitor
	 */
	private getDowntimeInfo(monitorId: string, now: number): DowntimeInfo {
		const state = this.getMonitorState(monitorId);
		const downStartTime = state.downStartTime || now;
		return {
			downStartTime,
			actualDowntime: now - downStartTime,
		};
	}

	/**
	 * Send appropriate down notification
	 */
	private async sendDownNotification(monitor: Monitor, state: MonitorState, downtimeInfo: DowntimeInfo): Promise<void> {
		if (state.consecutiveDownCount === 1) {
			await this.notifyMonitorDown(monitor, downtimeInfo.actualDowntime);
		} else {
			await this.notifyMonitorStillDown(monitor, state.consecutiveDownCount, downtimeInfo.actualDowntime);
		}

		state.lastNotificationCount = state.consecutiveDownCount;
	}

	/**
	 * Determine if a notification should be sent
	 */
	private shouldSendNotification(monitor: Monitor, state: MonitorState): boolean {
		// First notification (monitor just went down)
		if (state.consecutiveDownCount === 1) return true;

		// Resend notifications disabled
		if (monitor.resendNotification === 0) return false;

		// Check if enough consecutive down checks have passed
		const downsSinceLastNotification = state.consecutiveDownCount - state.lastNotificationCount;
		return downsSinceLastNotification >= monitor.resendNotification;
	}

	/**
	 * Send notification about monitor being down
	 */
	private async notifyMonitorDown(monitor: Monitor, downtime: number): Promise<void> {
		Logger.error("MONITOR DOWN", {
			monitorId: monitor.id,
			monitorName: monitor.name,
			downtime: Math.round(downtime / 1000) + "s",
		});

		if (this.hasNotificationChannels(monitor)) {
			await this.notificationManager.sendNotification(monitor.notificationChannels!, {
				type: "down",
				monitorId: monitor.id,
				monitorName: monitor.name,
				downtime,
				timestamp: new Date(),
				sourceType: "monitor",
			});
		}

		const slugs = cache.getStatusPageSlugsByMonitor(monitor.id);
		slugs.forEach((slug) => {
			server.publish(
				`slug-${slug}`,
				JSON.stringify({
					action: "monitor-down",
					data: { slug, monitorId: monitor.id, downtime },
					timestamp: new Date().toISOString(),
				})
			);
		});
	}

	/**
	 * Send notification about monitor still being down
	 */
	private async notifyMonitorStillDown(monitor: Monitor, consecutiveDownCount: number, actualDowntime: number): Promise<void> {
		Logger.error("MONITOR STILL DOWN", {
			monitorId: monitor.id,
			monitorName: monitor.name,
			consecutiveDownCount,
			actualDowntime: Math.round(actualDowntime / 1000) + "s",
		});

		if (this.hasNotificationChannels(monitor)) {
			await this.notificationManager.sendNotification(monitor.notificationChannels!, {
				type: "still-down",
				monitorId: monitor.id,
				monitorName: monitor.name,
				consecutiveDownCount,
				downtime: actualDowntime,
				timestamp: new Date(),
				sourceType: "monitor",
			});
		}

		const slugs = cache.getStatusPageSlugsByMonitor(monitor.id);
		slugs.forEach((slug) => {
			server.publish(
				`slug-${slug}`,
				JSON.stringify({
					action: "monitor-still-down",
					data: { slug, monitorId: monitor.id, consecutiveDownCount, downtime: actualDowntime },
					timestamp: new Date().toISOString(),
				})
			);
		});
	}

	/**
	 * Check if monitor has notification channels configured
	 */
	private hasNotificationChannels(monitor: Monitor): boolean {
		return !!(monitor.notificationChannels && monitor.notificationChannels.length > 0);
	}

	/**
	 * Get or create monitor state
	 */
	private getMonitorState(monitorId: string): MonitorState {
		if (!this.monitorStates.has(monitorId)) {
			this.monitorStates.set(monitorId, {
				missedCount: 0,
				consecutiveDownCount: 0,
				lastNotificationCount: 0,
			});
		}
		return this.monitorStates.get(monitorId)!;
	}

	/**
	 * Increment missed pulse count
	 */
	private incrementMissedCount(monitorId: string): MonitorState {
		const state = this.getMonitorState(monitorId);
		state.missedCount++;
		return state;
	}

	/**
	 * Increment consecutive down count
	 */
	private incrementDownCount(monitorId: string): MonitorState {
		const state = this.getMonitorState(monitorId);
		state.consecutiveDownCount++;
		return state;
	}

	/**
	 * Clear monitor state
	 */
	private clearMonitorState(monitorId: string): void {
		this.monitorStates.delete(monitorId);
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
			consecutiveDownCount: number;
			resendNotification: number;
			actualDowntime?: number;
		}>;
	} {
		const now = Date.now();
		const monitorsWithMissingPulses = [];

		for (const [monitorId, state] of this.monitorStates.entries()) {
			if (state.missedCount === 0) continue;

			const monitor = cache.getMonitor(monitorId);
			if (!monitor) continue;

			const actualDowntime = state.downStartTime ? now - state.downStartTime : undefined;

			monitorsWithMissingPulses.push({
				monitorId,
				monitorName: monitor.name,
				missedCount: state.missedCount,
				maxRetries: monitor.maxRetries,
				consecutiveDownCount: state.consecutiveDownCount,
				resendNotification: monitor.resendNotification,
				actualDowntime,
			});
		}

		return {
			running: this.isRunning(),
			checkInterval: this.checkInterval,
			monitorsWithMissingPulses,
		};
	}

	/**
	 * Reset missed pulse count for a specific monitor
	 * Called when a pulse is received
	 */
	resetMonitor(monitorId: string): void {
		const state = this.monitorStates.get(monitorId);
		if (!state || state.consecutiveDownCount === 0) {
			this.clearMonitorState(monitorId);
			return;
		}

		const monitor = cache.getMonitor(monitorId);
		if (!monitor) {
			this.clearMonitorState(monitorId);
			return;
		}

		const now = Date.now();
		const totalDowntime = this.calculateTotalDowntime(monitor, state, now);

		Logger.info("Monitor recovered", {
			monitorId,
			previousConsecutiveDownCount: state.consecutiveDownCount,
			totalDowntime: Math.round(totalDowntime / 1000) + "s",
		});

		if (this.hasNotificationChannels(monitor)) {
			this.notificationManager.sendNotification(monitor.notificationChannels!, {
				type: "recovered",
				monitorId,
				monitorName: monitor.name,
				previousConsecutiveDownCount: state.consecutiveDownCount,
				downtime: totalDowntime,
				timestamp: new Date(),
				sourceType: "monitor",
			});
		}

		const slugs = cache.getStatusPageSlugsByMonitor(monitorId);
		slugs.forEach((slug) => {
			server.publish(
				`slug-${slug}`,
				JSON.stringify({
					action: "monitor-recovered",
					data: { slug, monitorId, previousConsecutiveDownCount: state.consecutiveDownCount, downtime: totalDowntime },
					timestamp: new Date().toISOString(),
				})
			);
		});

		this.clearMonitorState(monitorId);
	}

	/**
	 * Calculate total downtime for a monitor
	 */
	private calculateTotalDowntime(monitor: Monitor, state: MonitorState, now: number): number {
		if (state.downStartTime) {
			return now - state.downStartTime;
		}
		// Fallback to estimated downtime
		return state.consecutiveDownCount * monitor.interval * 1000;
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
