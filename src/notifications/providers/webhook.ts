import { cache } from "../../cache";
import { Logger } from "../../logger";
import { formatDateTimeLocal, formatDuration } from "../../times";
import type { WebhookConfig, NotificationEvent, NotificationProvider } from "../../types";

export class WebhookProvider implements NotificationProvider {
	private config: WebhookConfig;

	constructor(config: WebhookConfig) {
		this.config = config;
	}

	async sendNotification(event: NotificationEvent): Promise<void> {
		if (!this.config.enabled) return;

		try {
			const payload = this.buildPayload(event);

			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				...this.config.headers,
			};

			const response = await fetch(this.config.url, {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
			});

			if (!response.ok) {
				const errorBody = await response.text();
				throw new Error(`Webhook request failed: ${response.status} ${response.statusText} - ${errorBody}`);
			}

			Logger.info("Webhook notification sent successfully", {
				type: event.type,
				monitorId: event.monitorId,
				monitorName: event.monitorName,
				url: this.config.url,
			});
		} catch (error) {
			Logger.error("Failed to send Webhook notification", {
				type: event.type,
				monitorId: event.monitorId,
				monitorName: event.monitorName,
				url: this.config.url,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	}

	private buildPayload(event: NotificationEvent): Record<string, unknown> {
		const downtimeDuration = event.downtime ? formatDuration(event.downtime) : null;
		const interval = event.sourceType === "group" ? cache.getGroup(event.monitorId)!.interval : cache.getMonitor(event.monitorId)!.interval;
		const formattedTime = formatDateTimeLocal(event.timestamp);

		const payload: Record<string, unknown> = {
			type: event.type,
			monitorId: event.monitorId,
			monitorName: event.monitorName,
			sourceType: event.sourceType,
			timestamp: event.timestamp.toISOString(),
			formattedTime,
			interval,
		};

		if (event.downtime !== undefined) {
			payload.downtime = event.downtime;
			payload.downtimeDuration = downtimeDuration;
		}

		if (event.consecutiveDownCount !== undefined) {
			payload.consecutiveDownCount = event.consecutiveDownCount;
		}

		if (event.previousConsecutiveDownCount !== undefined) {
			payload.previousConsecutiveDownCount = event.previousConsecutiveDownCount;
		}

		if (event.groupInfo) {
			payload.groupInfo = event.groupInfo;
		}

		return payload;
	}
}
