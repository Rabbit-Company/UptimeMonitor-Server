import { cache } from "../../cache";
import { Logger } from "../../logger";
import { formatDateTimeLocal, formatDuration } from "../../times";
import type { TelegramConfig, NotificationEvent, NotificationProvider } from "../../types";

export class TelegramProvider implements NotificationProvider {
	private config: TelegramConfig;

	constructor(config: TelegramConfig) {
		this.config = config;
	}

	async sendNotification(event: NotificationEvent): Promise<void> {
		if (!this.config.enabled) return;

		try {
			const message = this.generateMessage(event);

			const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;

			const payload: Record<string, unknown> = {
				chat_id: this.config.chatId,
				text: message,
				parse_mode: "HTML",
			};

			if (this.config.topicId) {
				payload.message_thread_id = this.config.topicId;
			}

			if (this.config.disableNotification) {
				payload.disable_notification = true;
			}

			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(payload),
			});

			if (!response.ok) {
				const errorBody = await response.text();
				throw new Error(`Telegram API failed: ${response.status} ${response.statusText} - ${errorBody}`);
			}

			Logger.info("Telegram notification sent successfully", {
				type: event.type,
				monitorId: event.monitorId,
				monitorName: event.monitorName,
				chatId: this.config.chatId,
			});
		} catch (error) {
			Logger.error("Failed to send Telegram notification", {
				type: event.type,
				monitorId: event.monitorId,
				monitorName: event.monitorName,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	}

	private generateMessage(event: NotificationEvent): string {
		const downtimeDuration = event.downtime ? formatDuration(event.downtime) : "Just now";
		const interval = event.sourceType === "group" ? cache.getGroup(event.monitorId)!.interval : cache.getMonitor(event.monitorId)!.interval;
		const formattedTime = formatDateTimeLocal(event.timestamp);

		switch (event.type) {
			case "down":
				return this.generateDownMessage(event, formattedTime, downtimeDuration);

			case "still-down":
				return this.generateStillDownMessage(event, formattedTime, interval);

			case "recovered":
				return this.generateRecoveredMessage(event, formattedTime, interval);

			default:
				return `⚠️ <b>Unknown Notification</b>\n\nMonitor: ${this.escapeHtml(event.monitorName)}\nType: ${event.type}`;
		}
	}

	private generateDownMessage(event: NotificationEvent, formattedTime: string, downtimeDuration: string): string {
		const entityType = event.sourceType === "group" ? "Group" : "Monitor";
		const name = this.escapeHtml(event.monitorName);

		const lines: string[] = [`🚨 <b>${entityType} Down Alert</b>`, ""];

		if (event.sourceType === "group" && event.groupInfo) {
			lines.push(`<b>${name}</b> group has degraded below acceptable thresholds.`);
		} else {
			lines.push(`<b>${name}</b> has stopped responding and is now marked as <b>DOWN</b>.`);
		}

		lines.push(
			"",
			`<b>${entityType}:</b> ${name}`,
			`<b>Status:</b> 🔴 DOWN`,
			`<b>Type:</b> ${entityType}`,
			`<b>Detected at:</b> ${formattedTime}`,
			`<b>Downtime:</b> ${downtimeDuration}`,
			`<b>${entityType} ID:</b> <code>${this.escapeHtml(event.monitorId)}</code>`,
		);

		if (event.groupInfo) {
			lines.push(
				`<b>Strategy:</b> ${event.groupInfo.strategy}`,
				`<b>Children Status:</b> ${event.groupInfo.childrenUp}/${event.groupInfo.totalChildren} up (${event.groupInfo.upPercentage.toFixed(1)}%)`,
			);
		}

		return lines.join("\n");
	}

	private generateStillDownMessage(event: NotificationEvent, formattedTime: string, interval: number): string {
		const entityType = event.sourceType === "group" ? "Group" : "Monitor";
		const name = this.escapeHtml(event.monitorName);
		const stillDownDuration = event.downtime ? formatDuration(event.downtime) : formatDuration((event.consecutiveDownCount || 0) * (interval || 30) * 1000);

		const lines: string[] = [
			`⚠️ <b>${entityType} Still Down</b>`,
			"",
			`<b>${name}</b> remains down after multiple consecutive checks.`,
			"",
			`<b>${entityType}:</b> ${name}`,
			`<b>Status:</b> 🔴 STILL DOWN`,
			`<b>Type:</b> ${entityType}`,
			`<b>Checked at:</b> ${formattedTime}`,
			`<b>Consecutive downs:</b> ${event.consecutiveDownCount || 0}`,
			`<b>Total downtime:</b> ${stillDownDuration}`,
			`<b>${entityType} ID:</b> <code>${this.escapeHtml(event.monitorId)}</code>`,
		];

		if (event.groupInfo) {
			lines.push(
				`<b>Strategy:</b> ${event.groupInfo.strategy}`,
				`<b>Children Status:</b> ${event.groupInfo.childrenUp}/${event.groupInfo.totalChildren} up (${event.groupInfo.upPercentage.toFixed(1)}%)`,
			);
		}

		return lines.join("\n");
	}

	private generateRecoveredMessage(event: NotificationEvent, formattedTime: string, interval: number): string {
		const entityType = event.sourceType === "group" ? "Group" : "Monitor";
		const name = this.escapeHtml(event.monitorName);
		const outageDuration = event.downtime
			? formatDuration(event.downtime)
			: formatDuration((event.previousConsecutiveDownCount || 0) * (interval || 30) * 1000);

		const lines: string[] = [`✅ <b>${entityType} Recovered</b>`, ""];

		if (event.sourceType === "group") {
			lines.push(`Great news! <b>${name}</b> group has recovered and is now healthy.`);
		} else {
			lines.push(`Great news! <b>${name}</b> has recovered and is now responding normally.`);
		}

		lines.push(
			"",
			`<b>${entityType}:</b> ${name}`,
			`<b>Status:</b> 🟢 UP`,
			`<b>Type:</b> ${entityType}`,
			`<b>Recovered at:</b> ${formattedTime}`,
			`<b>Previous outage:</b> ${event.previousConsecutiveDownCount || 0} consecutive down checks`,
			`<b>Total outage duration:</b> ${outageDuration}`,
			`<b>${entityType} ID:</b> <code>${this.escapeHtml(event.monitorId)}</code>`,
		);

		if (event.groupInfo) {
			lines.push(
				`<b>Strategy:</b> ${event.groupInfo.strategy}`,
				`<b>Children Status:</b> ${event.groupInfo.childrenUp}/${event.groupInfo.totalChildren} up (${event.groupInfo.upPercentage.toFixed(1)}%)`,
			);
		}

		return lines.join("\n");
	}

	private escapeHtml(text: string): string {
		return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}
}
