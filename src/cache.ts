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
	 * Build relationship caches for faster lookups
	 */
	private buildRelationships(): void {
		this.monitorsByGroup.clear();
		this.groupsByParent.clear();

		// Build monitors by group
		for (const monitor of this.monitors.values()) {
			if (monitor.groupId) {
				const existing = this.monitorsByGroup.get(monitor.groupId) || [];
				existing.push(monitor);
				this.monitorsByGroup.set(monitor.groupId, existing);
			}
		}

		// Build groups by parent
		for (const group of this.groups.values()) {
			if (group.parentId) {
				const existing = this.groupsByParent.get(group.parentId) || [];
				existing.push(group);
				this.groupsByParent.set(group.parentId, existing);
			}
		}
	}

	/**
	 * Get a monitor by ID
	 */
	getMonitor(id: string): Monitor | undefined {
		return this.monitors.get(id);
	}

	/**
	 * Get a monitor by token
	 */
	getMonitorByToken(token: string): Monitor | undefined {
		return this.monitorsByToken.get(token);
	}

	/**
	 * Get all monitors
	 */
	getAllMonitors(): Monitor[] {
		return Array.from(this.monitors.values());
	}

	/**
	 * Get monitors belonging to a specific group
	 */
	getMonitorsByGroup(groupId: string): Monitor[] {
		return this.monitorsByGroup.get(groupId) || [];
	}

	/**
	 * Get a group by ID
	 */
	getGroup(id: string): Group | undefined {
		return this.groups.get(id);
	}

	/**
	 * Get all groups
	 */
	getAllGroups(): Group[] {
		return Array.from(this.groups.values());
	}

	/**
	 * Get child groups of a parent group
	 */
	getChildGroups(parentId: string): Group[] {
		return this.groupsByParent.get(parentId) || [];
	}

	/**
	 * Get a status page by ID
	 */
	getStatusPage(id: string): StatusPage | undefined {
		return this.statusPages.get(id);
	}

	/**
	 * Get a status page by slug
	 */
	getStatusPageBySlug(slug: string): StatusPage | undefined {
		return this.statusPagesBySlug.get(slug);
	}

	/**
	 * Get all status pages
	 */
	getAllStatusPages(): StatusPage[] {
		return Array.from(this.statusPages.values());
	}

	/**
	 * Get a notification channel by ID
	 */
	getNotificationChannel(id: string): NotificationChannel | undefined {
		return this.notificationChannels.get(id);
	}

	/**
	 * Get all notification channels
	 */
	getAllNotificationChannels(): NotificationChannel[] {
		return Array.from(this.notificationChannels.values());
	}

	/**
	 * Get status data for a monitor or group
	 */
	getStatus(id: string): StatusData | undefined {
		return this.statusCache.get(id);
	}

	/**
	 * Set status data for a monitor or group
	 */
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

	/**
	 * Get all direct children IDs of a group
	 */
	getDirectChildIds(groupId: string): string[] {
		const { monitors, groups } = this.getDirectChildren(groupId);
		return [...monitors.map((m) => m.id), ...groups.map((g) => g.id)];
	}

	/**
	 * Check if a monitor exists
	 */
	hasMonitor(id: string): boolean {
		return this.monitors.has(id);
	}

	/**
	 * Check if a group exists
	 */
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
			statusData: this.statusCache.size,
		};
	}
}

// Export singleton instance
export const cache = new CacheManager();
