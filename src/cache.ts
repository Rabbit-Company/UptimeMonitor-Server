import { config } from "./config";
import type { Monitor, Group, StatusPage, StatusData, NotificationChannel } from "./types";
import { Logger } from "./logger";

class CacheManager {
	// Configuration caches
	private monitors: Map<string, Monitor> = new Map();
	private monitorsByToken: Map<string, Monitor> = new Map();
	private groups: Map<string, Group> = new Map();
	private statusPages: Map<string, StatusPage> = new Map();
	private statusPagesBySlug: Map<string, StatusPage> = new Map();
	private notificationChannels: Map<string, NotificationChannel> = new Map();

	// Relationship caches
	private monitorsByGroup: Map<string, Monitor[]> = new Map();
	private groupsByParent: Map<string, Group[]> = new Map();

	// Reverse index caches
	private statusPageSlugsByMonitor: Map<string, string[]> = new Map();

	// Status cache
	public statusCache: Map<string, StatusData> = new Map();

	constructor() {
		this.initialize();
	}

	/**
	 * Initialize all caches from configuration
	 */
	private initialize(): void {
		this.initializeMonitors();
		this.initializeGroups();
		this.initializeStatusPages();
		this.initializeNotificationChannels();
		this.buildRelationships();
		this.buildStatusPageMonitorIndex();

		Logger.info("Cache initialized", {
			monitors: this.monitors.size,
			groups: this.groups.size,
			statusPages: this.statusPages.size,
			notificationChannels: this.notificationChannels.size,
		});
	}

	/**
	 * Initialize monitor caches
	 */
	private initializeMonitors(): void {
		this.monitors.clear();
		this.monitorsByToken.clear();

		for (const monitor of config.monitors) {
			this.monitors.set(monitor.id, monitor);
			this.monitorsByToken.set(monitor.token, monitor);
		}
	}

	/**
	 * Initialize group caches
	 */
	private initializeGroups(): void {
		this.groups.clear();

		for (const group of config.groups) {
			this.groups.set(group.id, group);
		}
	}

	/**
	 * Initialize status page caches
	 */
	private initializeStatusPages(): void {
		this.statusPages.clear();
		this.statusPagesBySlug.clear();

		for (const page of config.statusPages) {
			this.statusPages.set(page.id, page);
			this.statusPagesBySlug.set(page.slug, page);
		}
	}

	/**
	 * Initialize notification channel caches
	 */
	private initializeNotificationChannels(): void {
		this.notificationChannels.clear();

		for (const [channelId, channel] of Object.entries(config.notifications?.channels || {})) {
			this.notificationChannels.set(channelId, channel);
		}
	}

	/**
	 * Build relationship caches
	 */
	private buildRelationships(): void {
		this.monitorsByGroup.clear();
		this.groupsByParent.clear();

		// Monitors by group
		for (const monitor of this.monitors.values()) {
			if (monitor.groupId) {
				const existing = this.monitorsByGroup.get(monitor.groupId) || [];
				existing.push(monitor);
				this.monitorsByGroup.set(monitor.groupId, existing);
			}
		}

		// Groups by parent
		for (const group of this.groups.values()) {
			if (group.parentId) {
				const existing = this.groupsByParent.get(group.parentId) || [];
				existing.push(group);
				this.groupsByParent.set(group.parentId, existing);
			}
		}
	}

	/**
	 * Recursively collect all monitor IDs in a group
	 */
	private collectMonitorsInGroup(groupId: string, result: Set<string>): void {
		// Direct monitors
		const monitors = this.monitorsByGroup.get(groupId) || [];
		for (const monitor of monitors) {
			result.add(monitor.id);
		}

		// Child groups
		const childGroups = this.groupsByParent.get(groupId) || [];
		for (const child of childGroups) {
			this.collectMonitorsInGroup(child.id, result);
		}
	}

	/**
	 * Build reverse index: monitorId -> status page slugs
	 */
	private buildStatusPageMonitorIndex(): void {
		this.statusPageSlugsByMonitor.clear();

		for (const page of this.statusPages.values()) {
			const monitorsOnPage = new Set<string>();

			for (const itemId of page.items) {
				// Direct monitor
				if (this.monitors.has(itemId)) {
					monitorsOnPage.add(itemId);
					continue;
				}

				// Group (recursive)
				if (this.groups.has(itemId)) {
					this.collectMonitorsInGroup(itemId, monitorsOnPage);
				}
			}

			for (const monitorId of monitorsOnPage) {
				const existing = this.statusPageSlugsByMonitor.get(monitorId) || [];
				existing.push(page.slug);
				this.statusPageSlugsByMonitor.set(monitorId, existing);
			}
		}
	}

	getMonitor(id: string): Monitor | undefined {
		return this.monitors.get(id);
	}

	getMonitorByToken(token: string): Monitor | undefined {
		return this.monitorsByToken.get(token);
	}

	getAllMonitors(): Monitor[] {
		return Array.from(this.monitors.values());
	}

	getMonitorsByGroup(groupId: string): Monitor[] {
		return this.monitorsByGroup.get(groupId) || [];
	}

	getGroup(id: string): Group | undefined {
		return this.groups.get(id);
	}

	getAllGroups(): Group[] {
		return Array.from(this.groups.values());
	}

	getChildGroups(parentId: string): Group[] {
		return this.groupsByParent.get(parentId) || [];
	}

	getStatusPage(id: string): StatusPage | undefined {
		return this.statusPages.get(id);
	}

	getStatusPageBySlug(slug: string): StatusPage | undefined {
		return this.statusPagesBySlug.get(slug);
	}

	getAllStatusPages(): StatusPage[] {
		return Array.from(this.statusPages.values());
	}

	getNotificationChannel(id: string): NotificationChannel | undefined {
		return this.notificationChannels.get(id);
	}

	getAllNotificationChannels(): NotificationChannel[] {
		return Array.from(this.notificationChannels.values());
	}

	getStatusPageSlugsByMonitor(monitorId: string): string[] {
		return this.statusPageSlugsByMonitor.get(monitorId) || [];
	}

	getStatus(id: string): StatusData | undefined {
		return this.statusCache.get(id);
	}

	setStatus(id: string, status: StatusData): void {
		this.statusCache.set(id, status);
	}

	/**
	 * Get all direct children (monitors and groups) of a group
	 */
	getDirectChildren(groupId: string): { monitors: Monitor[]; groups: Group[] } {
		return {
			monitors: this.getMonitorsByGroup(groupId),
			groups: this.getChildGroups(groupId),
		};
	}

	getDirectChildIds(groupId: string): string[] {
		const { monitors, groups } = this.getDirectChildren(groupId);
		return [...monitors.map((m) => m.id), ...groups.map((g) => g.id)];
	}

	hasMonitor(id: string): boolean {
		return this.monitors.has(id);
	}

	hasGroup(id: string): boolean {
		return this.groups.has(id);
	}

	/**
	 * Reload configuration and rebuild caches
	 * This would be called when config is hot-reloaded
	 */
	reload(): void {
		Logger.info("Reloading cache from configuration");
		this.initialize();
	}

	/**
	 * Get cache statistics
	 */
	getStats(): Record<string, number> {
		return {
			monitors: this.monitors.size,
			groups: this.groups.size,
			statusPages: this.statusPages.size,
			notificationChannels: this.notificationChannels.size,
			monitorsByGroup: this.monitorsByGroup.size,
			groupsByParent: this.groupsByParent.size,
			statusPageMonitorIndex: this.statusPageSlugsByMonitor.size,
			statusData: this.statusCache.size,
		};
	}
}

export const cache = new CacheManager();
