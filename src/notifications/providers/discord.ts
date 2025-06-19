import { Logger } from "../../logger";
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
		const formattedTime = `<t:${Math.floor(event.timestamp.getTime() / 1000)}:F>`;

		switch (event.type) {
			case "down":
				const downtimeMinutes = event.downtime ? Math.round(event.downtime / 60000) : 0;
				return {
					title: "🚨 Monitor Down Alert",
					description: `**${event.monitorName}** has stopped responding and is now marked as DOWN.`,
					color: 0xdc3545, // Red
					fields: [
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
							name: "Detected at",
							value: formattedTime,
							inline: true,
						},
						{
							name: "Downtime",
							value: `${downtimeMinutes} minutes`,
							inline: true,
						},
						{
							name: "Monitor ID",
							value: `\`${event.monitorId}\``,
							inline: true,
						},
					],
					footer: {
						text: "Monitoring System Alert",
					},
					timestamp,
				};

			case "still-down":
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
							name: "Checked at",
							value: formattedTime,
							inline: true,
						},
						{
							name: "Consecutive downs",
							value: `${event.consecutiveDownCount || 0}`,
							inline: true,
						},
						{
							name: "Monitor ID",
							value: `\`${event.monitorId}\``,
							inline: true,
						},
					],
					footer: {
						text: "Monitoring System Alert",
					},
					timestamp,
				};

			case "recovered":
				return {
					title: "✅ Monitor Recovered",
					description: `Great news! **${event.monitorName}** has recovered and is now responding normally.`,
					color: 0x28a745, // Green
					fields: [
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
							name: "Recovered at",
							value: formattedTime,
							inline: true,
						},
						{
							name: "Previous outage",
							value: `${event.previousConsecutiveDownCount || 0} consecutive down checks`,
							inline: true,
						},
						{
							name: "Monitor ID",
							value: `\`${event.monitorId}\``,
							inline: true,
						},
					],
					footer: {
						text: "Monitoring System Alert",
					},
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
