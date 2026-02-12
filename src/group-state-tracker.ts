import { Logger } from "./logger";
import { config } from "./config";
import { NotificationManager } from "./notifications";
import type { GroupState } from "./types";

/**
 * Tracks group downtime state for accurate notification data.
 * This is similar to how MissingPulseDetector tracks monitor states,
 * but specifically for groups which derive their status from children.
 */
class GroupStateTracker {
	private readonly groupStates = new Map<string, GroupState>();
	private readonly notificationManager: NotificationManager;
	/** Abort controllers for pending deferred group notifications (one per group) */
	private readonly pendingAbortControllers = new Map<string, AbortController>();

	constructor() {
		this.notificationManager = new NotificationManager(config.notifications || { channels: {} });
	}

	/**
	 * Get the NotificationManager instance (reused for all group notifications)
	 */
	getNotificationManager(): NotificationManager {
		return this.notificationManager;
	}

	/**
	 * Update notification configuration (called when config is reloaded)
	 */
	updateNotificationConfig(): void {
		this.notificationManager.updateConfig(config.notifications || { channels: {} });
	}

	/**
	 * Get the current state for a group
	 */
	getState(groupId: string): GroupState | undefined {
		return this.groupStates.get(groupId);
	}

	/**
	 * Record that a group has gone down or is still down.
	 * Increments on every call (similar to how MissingPulseDetector works for monitors).
	 * @param groupId The group ID
	 * @param isFirstDown Whether this is the first down detection (status changed from up/degraded to down)
	 */
	recordDown(groupId: string, isFirstDown: boolean): GroupState {
		let state = this.groupStates.get(groupId);

		if (!state) {
			state = {
				consecutiveDownCount: 0,
				lastNotificationCount: 0,
			};
			this.groupStates.set(groupId, state);
		}

		state.consecutiveDownCount++;

		if (isFirstDown || !state.downStartTime) {
			state.downStartTime = Date.now();
			state.lastNotificationCount = 0;
			Logger.debug("Group marked as down", {
				groupId,
				consecutiveDownCount: state.consecutiveDownCount,
				downStartTime: new Date(state.downStartTime).toISOString(),
			});
		}

		return state;
	}

	/**
	 * Check if a "still-down" notification should be sent based on resendNotification setting
	 * @param groupId The group ID
	 * @param resendNotification Number of consecutive down checks before resending (0 = never resend)
	 * @returns true if a still-down notification should be sent
	 */
	shouldSendStillDownNotification(groupId: string, resendNotification: number): boolean {
		const state = this.groupStates.get(groupId);
		if (!state || state.consecutiveDownCount <= 1) return false;

		if (resendNotification === 0) return false;

		const downsSinceLastNotification = state.consecutiveDownCount - state.lastNotificationCount;
		return downsSinceLastNotification >= resendNotification;
	}

	/**
	 * Record that a notification was sent (updates lastNotificationCount)
	 * @param groupId The group ID
	 */
	recordNotificationSent(groupId: string): void {
		const state = this.groupStates.get(groupId);
		if (state) {
			state.lastNotificationCount = state.consecutiveDownCount;
		}
	}

	/**
	 * Get current downtime info without clearing state (for still-down notifications)
	 * @param groupId The group ID
	 * @param groupInterval The group's interval in seconds (for fallback calculation)
	 */
	getDowntimeInfo(groupId: string, groupInterval: number): { consecutiveDownCount: number; downtime: number } | undefined {
		const state = this.groupStates.get(groupId);
		if (!state || state.consecutiveDownCount === 0) return undefined;

		const now = Date.now();
		let downtime: number;
		if (state.downStartTime) {
			downtime = now - state.downStartTime;
		} else {
			downtime = state.consecutiveDownCount * groupInterval * 1000;
		}

		return {
			consecutiveDownCount: state.consecutiveDownCount,
			downtime,
		};
	}

	/**
	 * Record that a group has recovered and get the downtime info
	 * @param groupId The group ID
	 * @param groupInterval The group's interval in seconds (for fallback calculation)
	 * @returns Object containing previousConsecutiveDownCount and downtime, or undefined if group wasn't tracked as down
	 */
	recordRecovery(groupId: string, groupInterval: number): { previousConsecutiveDownCount: number; downtime: number } | undefined {
		const state = this.groupStates.get(groupId);

		if (!state || state.consecutiveDownCount === 0) {
			this.groupStates.delete(groupId);
			return undefined;
		}

		const now = Date.now();
		const previousConsecutiveDownCount = state.consecutiveDownCount;

		let downtime: number;
		if (state.downStartTime) {
			downtime = now - state.downStartTime;
		} else {
			downtime = state.consecutiveDownCount * groupInterval * 1000;
		}

		Logger.info("Group recovered", {
			groupId,
			previousConsecutiveDownCount,
			downtime: Math.round(downtime / 1000) + "s",
		});

		this.groupStates.delete(groupId);

		return {
			previousConsecutiveDownCount,
			downtime,
		};
	}

	/**
	 * Create an AbortController for a pending deferred notification.
	 * Cancels any existing pending notification for this group.
	 */
	createPendingAbort(groupId: string): AbortController {
		this.pendingAbortControllers.get(groupId)?.abort();
		const controller = new AbortController();
		this.pendingAbortControllers.set(groupId, controller);
		return controller;
	}

	/**
	 * Cancel any pending deferred notification for a group and clean up.
	 */
	cancelPendingNotification(groupId: string): void {
		this.pendingAbortControllers.get(groupId)?.abort();
		this.pendingAbortControllers.delete(groupId);
	}

	/**
	 * Clean up the abort controller for a group (after the deferred notification resolves).
	 */
	cleanupPendingAbort(groupId: string): void {
		this.pendingAbortControllers.delete(groupId);
	}

	/**
	 * Clear state for a specific group
	 */
	clearState(groupId: string): void {
		this.groupStates.delete(groupId);
	}

	/**
	 * Get all groups currently being tracked as down
	 */
	getDownGroups(): Array<{ groupId: string; state: GroupState }> {
		const result: Array<{ groupId: string; state: GroupState }> = [];

		for (const [groupId, state] of this.groupStates.entries()) {
			if (state.consecutiveDownCount > 0) {
				result.push({ groupId, state });
			}
		}

		return result;
	}

	/**
	 * Get status information for debugging/monitoring
	 */
	getStatus(): {
		trackedGroups: number;
		groupsDown: Array<{
			groupId: string;
			consecutiveDownCount: number;
			downtime?: number;
		}>;
	} {
		const now = Date.now();
		const groupsDown: Array<{
			groupId: string;
			consecutiveDownCount: number;
			downtime?: number;
		}> = [];

		for (const [groupId, state] of this.groupStates.entries()) {
			if (state.consecutiveDownCount > 0) {
				groupsDown.push({
					groupId,
					consecutiveDownCount: state.consecutiveDownCount,
					downtime: state.downStartTime ? now - state.downStartTime : undefined,
				});
			}
		}

		return {
			trackedGroups: this.groupStates.size,
			groupsDown,
		};
	}
}

export const groupStateTracker = new GroupStateTracker();
