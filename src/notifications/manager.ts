import { NotificationChannelManager } from "./channel-manager";
import type { NotificationsConfig, NotificationEvent } from "../types";

export class NotificationManager {
	private channelManager: NotificationChannelManager;

	constructor(config: NotificationsConfig) {
		this.channelManager = new NotificationChannelManager(config.channels || {});
	}

	async sendNotification(channelIds: string[], event: NotificationEvent): Promise<void> {
		await this.channelManager.sendNotification(channelIds, event);
	}

	updateConfig(config: NotificationsConfig): void {
		this.channelManager.updateChannels(config.channels || {});
	}

	getAvailableChannels(): string[] {
		return this.channelManager.getAvailableChannels();
	}
}
