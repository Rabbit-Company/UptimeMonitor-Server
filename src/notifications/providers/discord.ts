import { cache } from "../../cache";
import { Logger } from "../../logger";
import { formatDuration } from "../../times";
import type { DiscordConfig, NotificationEvent, NotificationProvider } from "../../types";

export class DiscordProvider implements NotificationProvider {
	private config: DiscordConfig;

	constructor(config: DiscordConfig) {
		this.config = config;
	}

	async sendNotification(event: NotificationEvent): Promise<void> {
		if (!this.config.enabled) return;

		try {
			const embed = this.generateDiscordEmbed(event);
			const content = this.generateMentions();

			const payload = {
				username: this.config.username || "Monitor Bot",
				avatar_url: this.config.avatarUrl,
				content,
				embeds: [embed],
			};

			const response = await fetch(this.config.webhookUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(payload),
			});

			if (!response.ok) {
				throw new Error(`Discord webhook failed: ${response.status} ${response.statusText}`);
			}

			Logger.info("Discord notification sent successfully", {
				type: event.type,
				monitorId: event.monitorId,
				monitorName: event.monitorName,
			});
		} catch (error) {
			Logger.error("Failed to send Discord notification", {
				type: event.type,
				monitorId: event.monitorId,
				monitorName: event.monitorName,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	}

	private generateMentions(): string {
		const mentions: string[] = [];

		if (this.config.mentions?.everyone) {
			mentions.push("@everyone");
		}

		if (this.config.mentions?.users) {
			mentions.push(...this.config.mentions.users.map((id) => `<@${id}>`));
		}

		if (this.config.mentions?.roles) {
			mentions.push(...this.config.mentions.roles.map((id) => `<@&${id}>`));
		}

		return mentions.length > 0 ? mentions.join(" ") : "";
	}

	private generateDiscordEmbed(event: NotificationEvent): any {
		const timestamp = event.timestamp.toISOString();
		const unixTS = Math.floor(event.timestamp.getTime() / 1000);
		const discordTimestamp = `<t:${unixTS}>`;
		const downtimeDuration = event.downtime ? formatDuration(event.downtime) : "Just now";
		const interval = event.sourceType === "group" ? cache.getGroup(event.monitorId)!.interval : cache.getMonitor(event.monitorId)!.interval;

		// Common footer for all embeds
		const footer = {
			text: event.sourceType === "group" ? "Group Monitoring Alert" : "Monitoring System Alert",
		};

		switch (event.type) {
			case "down":
				const fields = [
					{
						name: "Monitor",
						value: event.monitorName,
						inline: true,
					},
					{
						name: "Status",
						value: "🔴 **DOWN**",
						inline: true,
					},
					{
						name: "Type",
						value: event.sourceType === "group" ? "Group" : "Monitor",
						inline: true,
					},
					{
						name: "Detected at",
						value: discordTimestamp,
						inline: true,
					},
					{
						name: "Downtime",
						value: downtimeDuration,
						inline: true,
					},
					{
						name: "Monitor ID",
						value: `\`${event.monitorId}\``,
						inline: true,
					},
				];

				// Add group-specific information if available
				if (event.groupInfo) {
					fields.push(
						{
							name: "Group Strategy",
							value: event.groupInfo.strategy,
							inline: true,
						},
						{
							name: "Children Status",
							value: `${event.groupInfo.childrenUp}/${event.groupInfo.totalChildren} up (${event.groupInfo.upPercentage.toFixed(1)}%)`,
							inline: true,
						}
					);
				}

				return {
					title: event.sourceType === "group" ? "🚨 Group Down Alert" : "🚨 Monitor Down Alert",
					description:
						event.sourceType === "group"
							? `**${event.monitorName}** group has degraded below acceptable thresholds.`
							: `**${event.monitorName}** has stopped responding and is now marked as DOWN.`,
					color: 0xdc3545, // Red
					fields,
					footer,
					timestamp,
				};

			case "still-down":
				const stillDownDuration = event.downtime ? formatDuration(event.downtime) : formatDuration((event.consecutiveDownCount || 0) * (interval || 30) * 1000);

				return {
					title: "⚠️ Monitor Still Down",
					description: `**${event.monitorName}** remains down after multiple consecutive checks.`,
					color: 0xfd7e14, // Orange
					fields: [
						{
							name: "Monitor",
							value: event.monitorName,
							inline: true,
						},
						{
							name: "Status",
							value: "🔴 **STILL DOWN**",
							inline: true,
						},
						{
							name: "Type",
							value: event.sourceType === "group" ? "Group" : "Monitor",
							inline: true,
						},
						{
							name: "Checked at",
							value: discordTimestamp,
							inline: true,
						},
						{
							name: "Consecutive downs",
							value: `${event.consecutiveDownCount || 0}`,
							inline: true,
						},
						{
							name: "Total downtime",
							value: stillDownDuration,
							inline: true,
						},
						{
							name: "Monitor ID",
							value: `\`${event.monitorId}\``,
							inline: true,
						},
					],
					footer,
					timestamp,
				};

			case "recovered":
				const outageDuration = event.downtime
					? formatDuration(event.downtime)
					: formatDuration((event.previousConsecutiveDownCount || 0) * (interval || 30) * 1000);

				const recoveredFields = [
					{
						name: "Monitor",
						value: event.monitorName,
						inline: true,
					},
					{
						name: "Status",
						value: "🟢 **UP**",
						inline: true,
					},
					{
						name: "Type",
						value: event.sourceType === "group" ? "Group" : "Monitor",
						inline: true,
					},
					{
						name: "Recovered at",
						value: discordTimestamp,
						inline: true,
					},
					{
						name: "Previous outage",
						value: `${event.previousConsecutiveDownCount || 0} consecutive down checks`,
						inline: true,
					},
					{
						name: "Total outage duration",
						value: outageDuration,
						inline: true,
					},
					{
						name: "Monitor ID",
						value: `\`${event.monitorId}\``,
						inline: true,
					},
				];

				// Add group-specific information if available
				if (event.groupInfo) {
					recoveredFields.push(
						{
							name: "Group Strategy",
							value: event.groupInfo.strategy,
							inline: true,
						},
						{
							name: "Children Status",
							value: `${event.groupInfo.childrenUp}/${event.groupInfo.totalChildren} up (${event.groupInfo.upPercentage.toFixed(1)}%)`,
							inline: true,
						}
					);
				}

				return {
					title: event.sourceType === "group" ? "✅ Group Recovered" : "✅ Monitor Recovered",
					description:
						event.sourceType === "group"
							? `Great news! **${event.monitorName}** group has recovered and is now healthy.`
							: `Great news! **${event.monitorName}** has recovered and is now responding normally.`,
					color: 0x28a745, // Green
					fields: recoveredFields,
					footer,
					timestamp,
				};

			default:
				return {
					title: "Unknown Notification",
					description: `Unknown notification type: ${event.type}`,
					color: 0x6c757d, // Gray
					timestamp,
				};
		}
	}
}
