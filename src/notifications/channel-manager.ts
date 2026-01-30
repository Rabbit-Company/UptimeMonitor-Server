import { EmailProvider } from "./providers/email";
import { DiscordProvider } from "./providers/discord";
import { NtfyProvider } from "./providers/ntfy";
import { Logger } from "../logger";
import type { NotificationChannel, NotificationEvent, NotificationProvider } from "../types";

export class NotificationChannelManager {
	private providers: Map<string, NotificationProvider[]> = new Map();

	constructor(channels: Record<string, NotificationChannel>) {
		this.initializeChannels(channels);
	}

	private initializeChannels(channels: Record<string, NotificationChannel>): void {
		this.providers.clear();

		for (const [channelId, channel] of Object.entries(channels)) {
			if (!channel.enabled) {
				continue;
			}

			const channelProviders: NotificationProvider[] = [];

			if (channel.email?.enabled) {
				channelProviders.push(new EmailProvider(channel.email));
			}

			if (channel.discord?.enabled) {
				channelProviders.push(new DiscordProvider(channel.discord));
			}

			if (channel.ntfy?.enabled) {
				channelProviders.push(new NtfyProvider(channel.ntfy));
			}

			if (channelProviders.length > 0) {
				this.providers.set(channelId, channelProviders);
				Logger.info("Notification channel initialized", {
					channelId,
					channelName: channel.name,
					providerCount: channelProviders.length,
				});
			}
		}

		Logger.info("All notification channels initialized", {
			totalChannels: this.providers.size,
		});
	}

	async sendNotification(channelIds: string[], event: NotificationEvent): Promise<void> {
		if (channelIds.length === 0) {
			Logger.debug("No notification channels specified", {
				monitorId: event.monitorId,
				type: event.type,
			});
			return;
		}

		const promises: Promise<void>[] = [];

		for (const channelId of channelIds) {
			const channelProviders = this.providers.get(channelId);

			if (!channelProviders) {
				Logger.warn("Notification channel not found or disabled", {
					channelId,
					monitorId: event.monitorId,
					type: event.type,
				});
				continue;
			}

			// Send notification to all providers in this channel
			for (const provider of channelProviders) {
				promises.push(
					provider.sendNotification(event).catch((error) => {
						Logger.error("Provider failed in notification channel", {
							channelId,
							error: error instanceof Error ? error.message : "Unknown error",
							event,
						});
					}),
				);
			}
		}

		try {
			await Promise.allSettled(promises);
			Logger.info("Notifications sent", {
				channelIds,
				monitorId: event.monitorId,
				type: event.type,
				totalProviders: promises.length,
			});
		} catch (error) {
			Logger.error("Error sending notifications", {
				error: error instanceof Error ? error.message : "Unknown error",
				channelIds,
				event,
			});
		}
	}

	updateChannels(channels: Record<string, NotificationChannel>): void {
		this.initializeChannels(channels);
	}

	getAvailableChannels(): string[] {
		return Array.from(this.providers.keys());
	}
}
