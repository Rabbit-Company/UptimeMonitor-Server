import { cache } from "../../cache";
import { Logger } from "../../logger";
import { formatDateTimeLocal, formatDuration } from "../../times";
import type { NtfyConfig, NotificationEvent, NotificationProvider } from "../../types";

export class NtfyProvider implements NotificationProvider {
	private config: NtfyConfig;

	constructor(config: NtfyConfig) {
		this.config = config;
	}

	async sendNotification(event: NotificationEvent): Promise<void> {
		if (!this.config.enabled) return;

		try {
			const { title, message, priority, tags } = this.generateNotificationContent(event);

			const headers: Record<string, string> = {
				Title: title,
				Priority: priority,
				Tags: tags.join(","),
			};

			// Add authentication if configured
			if (this.config.token) {
				headers["Authorization"] = `Bearer ${this.config.token}`;
			} else if (this.config.username && this.config.password) {
				const credentials = Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64");
				headers["Authorization"] = `Basic ${credentials}`;
			}

			const url = `${this.config.server.replace(/\/$/, "")}/${this.config.topic}`;

			const response = await fetch(url, {
				method: "POST",
				body: message,
				headers,
			});

			if (!response.ok) {
				throw new Error(`Ntfy request failed: ${response.status} ${response.statusText}`);
			}

			Logger.info("Ntfy notification sent successfully", {
				type: event.type,
				monitorId: event.monitorId,
				monitorName: event.monitorName,
				server: this.config.server,
				topic: this.config.topic,
			});
		} catch (error) {
			Logger.error("Failed to send Ntfy notification", {
				type: event.type,
				monitorId: event.monitorId,
				monitorName: event.monitorName,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	}

	private generateNotificationContent(event: NotificationEvent): {
		title: string;
		message: string;
		priority: string;
		tags: string[];
	} {
		const downtimeDuration = event.downtime ? formatDuration(event.downtime) : "Just now";
		const interval = event.sourceType === "group" ? cache.getGroup(event.monitorId)!.interval : cache.getMonitor(event.monitorId)!.interval;
		const formattedTime = formatDateTimeLocal(event.timestamp);

		let title: string;
		let message: string;
		let priority: string;
		let tags: string[];

		switch (event.type) {
			case "down":
				title = `${event.sourceType === "group" ? "Group" : "Monitor"} Down: ${event.monitorName}`;
				priority = "urgent";
				tags = ["rotating_light", event.sourceType === "group" ? "group" : "monitor", "down"];

				if (event.sourceType === "group" && event.groupInfo) {
					message = [
						`Group "${event.monitorName}" has degraded below acceptable thresholds.`,
						"",
						`Status: DOWN`,
						`Type: Group`,
						`Strategy: ${event.groupInfo.strategy}`,
						`Children Status: ${event.groupInfo.childrenUp}/${event.groupInfo.totalChildren} up (${event.groupInfo.upPercentage.toFixed(1)}%)`,
						`Detected at: ${formattedTime}`,
						`Downtime: ${downtimeDuration}`,
						`Group ID: ${event.monitorId}`,
					].join("\n");
				} else {
					message = [
						`Monitor "${event.monitorName}" has stopped responding and is now marked as DOWN.`,
						"",
						`Status: DOWN`,
						`Type: Monitor`,
						`Detected at: ${formattedTime}`,
						`Downtime: ${downtimeDuration}`,
						`Monitor ID: ${event.monitorId}`,
					].join("\n");
				}
				break;

			case "still-down":
				const stillDownDuration = event.downtime ? formatDuration(event.downtime) : formatDuration((event.consecutiveDownCount || 0) * (interval || 30) * 1000);

				title = `Still Down: ${event.monitorName} (${event.consecutiveDownCount || 0} checks)`;
				priority = "high";
				tags = ["warning", event.sourceType === "group" ? "group" : "monitor", "still-down"];

				message = [
					`${event.sourceType === "group" ? "Group" : "Monitor"} "${event.monitorName}" remains down after multiple consecutive checks.`,
					"",
					`Status: STILL DOWN`,
					`Type: ${event.sourceType === "group" ? "Group" : "Monitor"}`,
					`Checked at: ${formattedTime}`,
					`Consecutive downs: ${event.consecutiveDownCount || 0}`,
					`Total downtime: ${stillDownDuration}`,
					`${event.sourceType === "group" ? "Group" : "Monitor"} ID: ${event.monitorId}`,
				].join("\n");

				if (event.groupInfo) {
					message += `\nStrategy: ${event.groupInfo.strategy}`;
					message += `\nChildren Status: ${event.groupInfo.childrenUp}/${event.groupInfo.totalChildren} up (${event.groupInfo.upPercentage.toFixed(1)}%)`;
				}
				break;

			case "recovered":
				const outageDuration = event.downtime
					? formatDuration(event.downtime)
					: formatDuration((event.previousConsecutiveDownCount || 0) * (interval || 30) * 1000);

				title = `${event.sourceType === "group" ? "Group" : "Monitor"} Recovered: ${event.monitorName}`;
				priority = "default";
				tags = ["white_check_mark", event.sourceType === "group" ? "group" : "monitor", "recovered"];

				if (event.sourceType === "group" && event.groupInfo) {
					message = [
						`Great news! Group "${event.monitorName}" has recovered and is now healthy.`,
						"",
						`Status: UP`,
						`Type: Group`,
						`Strategy: ${event.groupInfo.strategy}`,
						`Children Status: ${event.groupInfo.childrenUp}/${event.groupInfo.totalChildren} up (${event.groupInfo.upPercentage.toFixed(1)}%)`,
						`Recovered at: ${formattedTime}`,
						`Previous outage: ${event.previousConsecutiveDownCount || 0} consecutive down checks`,
						`Total outage duration: ${outageDuration}`,
						`Group ID: ${event.monitorId}`,
					].join("\n");
				} else {
					message = [
						`Great news! Monitor "${event.monitorName}" has recovered and is now responding normally.`,
						"",
						`Status: UP`,
						`Type: Monitor`,
						`Recovered at: ${formattedTime}`,
						`Previous outage: ${event.previousConsecutiveDownCount || 0} consecutive down checks`,
						`Total outage duration: ${outageDuration}`,
						`Monitor ID: ${event.monitorId}`,
					].join("\n");
				}
				break;

			default:
				title = `Unknown Notification: ${event.monitorName}`;
				message = `Unknown notification type: ${event.type}`;
				priority = "default";
				tags = ["question"];
		}

		return { title, message, priority, tags };
	}
}
