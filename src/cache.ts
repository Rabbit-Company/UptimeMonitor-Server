import { config } from "./config";
import type { Monitor, Group, StatusPage, StatusData, NotificationChannel, PulseMonitor } from "./types";
import { Logger } from "./logger";

class CacheManager {
	// Configuration caches
	private pulseMonitors: Map<string, PulseMonitor> = new Map();
	private pulseMonitorsByToken: Map<string, PulseMonitor> = new Map();
	private monitors: Map<string, Monitor> = new Map();
	private monitorsByToken: Map<string, Monitor> = new Map();
	private groups: Map<string, Group> = new Map();
	private statusPages: Map<string, StatusPage> = new Map();
	private statusPagesBySlug: Map<string, StatusPage> = new Map();
	private notificationChannels: Map<string, NotificationChannel> = new Map();

	// Relationship caches
	private childrenByParent: Map<string, string[]> = new Map();
	private parentsByChild: Map<string, string[]> = new Map();
	private monitorsByPulseMonitor: Map<string, Monitor[]> = new Map();

	// Reverse index caches
	private statusPageSlugsByMonitor: Map<string, string[]> = new Map();

	// Status cache
	public statusCache: Map<string, StatusData> = new Map();

	// Dependency caches (rebuilt on initialize/reload)
	/** Maps entity ID -> its dependency level (0 = no dependencies, higher = deeper) */
	private dependencyLevels: Map<string, number> = new Map();
	/** Monitors sorted by dependency level ascending (no-deps first) */
	private monitorsByDependencyLevel: Monitor[] = [];
	/** Maps entity ID -> array of dependency IDs */
	private dependenciesById: Map<string, string[]> = new Map();

	constructor() {
		this.initialize();
	}

	/**
	 * Initialize all caches from configuration
	 */
	private initialize(): void {
		this.initializePulseMonitors();
		this.initializeMonitors();
		this.initializeGroups();
		this.initializeStatusPages();
		this.initializeNotificationChannels();
		this.buildRelationships();
		this.buildStatusPageMonitorIndex();
		this.buildDependencyGraph();

		Logger.info("Cache initialized", {
			pulseMonitors: this.pulseMonitors.size,
			monitors: this.monitors.size,
			groups: this.groups.size,
			statusPages: this.statusPages.size,
			notificationChannels: this.notificationChannels.size,
		});
	}

	/**
	 * Initialize PulseMonitor caches
	 */
	private initializePulseMonitors(): void {
		this.pulseMonitors.clear();
		this.pulseMonitorsByToken.clear();

		for (const pulseMonitor of config.pulseMonitors) {
			this.pulseMonitors.set(pulseMonitor.id, pulseMonitor);
			this.pulseMonitorsByToken.set(pulseMonitor.token, pulseMonitor);
		}
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
		this.childrenByParent.clear();
		this.parentsByChild.clear();
		this.monitorsByPulseMonitor.clear();

		for (const monitor of this.monitors.values()) {
			if (monitor.children?.length) {
				this.childrenByParent.set(monitor.id, monitor.children);
			}
		}

		for (const group of this.groups.values()) {
			if (group.children?.length) {
				this.childrenByParent.set(group.id, group.children);
			}
		}

		for (const [parentId, childIds] of this.childrenByParent.entries()) {
			for (const childId of childIds) {
				const existing = this.parentsByChild.get(childId) || [];
				existing.push(parentId);
				this.parentsByChild.set(childId, existing);
			}
		}

		for (const monitor of this.monitors.values()) {
			if (monitor.pulseMonitors) {
				for (const pulseMonitorId of monitor.pulseMonitors) {
					const existing = this.monitorsByPulseMonitor.get(pulseMonitorId) || [];
					existing.push(monitor);
					this.monitorsByPulseMonitor.set(pulseMonitorId, existing);
				}
			}
		}
	}

	/**
	 * Build status page -> monitor reverse index
	 */
	private buildStatusPageMonitorIndex(): void {
		this.statusPageSlugsByMonitor.clear();

		for (const page of this.statusPages.values()) {
			for (const itemId of page.items) {
				// Get all monitors for this item (could be a monitor ID or group ID)
				const monitorIds = this.getAllMonitorIdsForItem(itemId);
				for (const monitorId of monitorIds) {
					const existing = this.statusPageSlugsByMonitor.get(monitorId) || [];
					if (!existing.includes(page.slug)) {
						existing.push(page.slug);
					}
					this.statusPageSlugsByMonitor.set(monitorId, existing);
				}
			}
		}
	}

	/**
	 * Get all monitor IDs for a status page item (recursively handles groups)
	 */
	private getAllMonitorIdsForItem(itemId: string): string[] {
		if (this.monitors.has(itemId)) {
			const monitorIds = [itemId];
			const childIds = this.childrenByParent.get(itemId) || [];
			for (const childId of childIds) {
				monitorIds.push(...this.getAllMonitorIdsForItem(childId));
			}
			return monitorIds;
		}

		if (this.groups.has(itemId)) {
			const monitorIds: string[] = [];
			const childIds = this.childrenByParent.get(itemId) || [];
			for (const childId of childIds) {
				monitorIds.push(...this.getAllMonitorIdsForItem(childId));
			}
			return monitorIds;
		}

		return [];
	}

	/**
	 * Build dependency graph and compute levels via topological sort.
	 * Level 0 = no dependencies (processed first).
	 * Level N = depends on something at level N-1.
	 */
	private buildDependencyGraph(): void {
		this.dependencyLevels.clear();
		this.dependenciesById.clear();
		this.monitorsByDependencyLevel = [];

		// Collect all dependency edges
		for (const monitor of this.monitors.values()) {
			if (monitor.dependencies?.length) {
				this.dependenciesById.set(monitor.id, monitor.dependencies);
			}
		}
		for (const group of this.groups.values()) {
			if (group.dependencies?.length) {
				this.dependenciesById.set(group.id, group.dependencies);
			}
		}

		// Compute level for each entity (memoized DFS)
		const computing = new Set<string>();

		const computeLevel = (id: string): number => {
			if (this.dependencyLevels.has(id)) return this.dependencyLevels.get(id)!;
			if (computing.has(id)) return 0; // circular guard (validated in config)

			computing.add(id);
			const deps = this.dependenciesById.get(id);
			let level = 0;
			if (deps) {
				for (const depId of deps) {
					level = Math.max(level, computeLevel(depId) + 1);
				}
			}
			computing.delete(id);
			this.dependencyLevels.set(id, level);
			return level;
		};

		// Compute levels for all monitors and groups
		for (const monitor of this.monitors.values()) {
			computeLevel(monitor.id);
		}
		for (const group of this.groups.values()) {
			computeLevel(group.id);
		}

		// Pre-sort monitors by dependency level ascending (no-deps first)
		this.monitorsByDependencyLevel = [...this.monitors.values()].sort((a, b) => {
			return (this.dependencyLevels.get(a.id) ?? 0) - (this.dependencyLevels.get(b.id) ?? 0);
		});

		const levelCounts: Record<number, number> = {};
		for (const [, level] of this.dependencyLevels) {
			levelCounts[level] = (levelCounts[level] || 0) + 1;
		}

		Logger.debug("Dependency graph built", {
			totalEntities: this.dependencyLevels.size,
			entitiesWithDeps: this.dependenciesById.size,
			levelCounts: JSON.stringify(levelCounts),
		});
	}

	getPulseMonitor(id: string): PulseMonitor | undefined {
		return this.pulseMonitors.get(id);
	}

	getPulseMonitorByToken(token: string): PulseMonitor | undefined {
		return this.pulseMonitorsByToken.get(token);
	}

	getAllPulseMonitors(): PulseMonitor[] {
		return Array.from(this.pulseMonitors.values());
	}

	getMonitorsByPulseMonitor(pulseMonitorId: string): Monitor[] {
		return this.monitorsByPulseMonitor.get(pulseMonitorId) || [];
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

	getGroup(id: string): Group | undefined {
		return this.groups.get(id);
	}

	getAllGroups(): Group[] {
		return Array.from(this.groups.values());
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

	isStatusPageProtected(slug: string): boolean {
		const statusPage = this.statusPagesBySlug.get(slug);
		return statusPage?.password !== undefined && statusPage.password.length > 0;
	}

	getStatusPagePassword(slug: string): string | undefined {
		const statusPage = this.statusPagesBySlug.get(slug);
		return statusPage?.password;
	}

	verifyStatusPagePassword(slug: string, providedPassword: string | null): boolean {
		const statusPage = this.statusPagesBySlug.get(slug);
		if (!statusPage) {
			return false;
		}

		if (!statusPage.password) {
			return true;
		}

		return providedPassword === statusPage.password;
	}

	/**
	 * Get all direct children (monitors and groups) of a group
	 */
	getDirectChildren(parentId: string): { monitors: Monitor[]; groups: Group[] } {
		const childIds = this.childrenByParent.get(parentId) || [];
		const monitors: Monitor[] = [];
		const groups: Group[] = [];

		for (const id of childIds) {
			const monitor = this.monitors.get(id);
			if (monitor) {
				monitors.push(monitor);
				continue;
			}
			const group = this.groups.get(id);
			if (group) {
				groups.push(group);
			}
		}

		return { monitors, groups };
	}

	getDirectChildIds(parentId: string): string[] {
		return this.childrenByParent.get(parentId) || [];
	}

	getParentIds(childId: string): string[] {
		return this.parentsByChild.get(childId) || [];
	}

	hasMonitor(id: string): boolean {
		return this.monitors.has(id);
	}

	hasGroup(id: string): boolean {
		return this.groups.has(id);
	}

	/**
	 * Get all monitors sorted by dependency level (no-deps first).
	 */
	getMonitorsByDependencyLevel(): Monitor[] {
		return this.monitorsByDependencyLevel;
	}

	/**
	 * Get the dependency level of an entity (0 = no deps).
	 */
	getDependencyLevel(id: string): number {
		return this.dependencyLevels.get(id) ?? 0;
	}

	/**
	 * Get the dependency IDs for an entity.
	 */
	getDependencies(id: string): string[] {
		return this.dependenciesById.get(id) ?? [];
	}

	/**
	 * Check if any of an entity's dependencies are currently down.
	 * Returns the first down dependency ID, or undefined if all deps are up.
	 */
	isAnyDependencyDown(entityId: string): string | undefined {
		const deps = this.dependenciesById.get(entityId);
		if (!deps || deps.length === 0) return undefined;

		for (const depId of deps) {
			const status = this.statusCache.get(depId);
			if (status && status.status === "down") {
				return depId;
			}
		}
		return undefined;
	}

	/**
	 * Check if an entity has any dependencies configured.
	 */
	hasDependencies(entityId: string): boolean {
		const deps = this.dependenciesById.get(entityId);
		return !!(deps && deps.length > 0);
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
			pulseMonitors: this.pulseMonitors.size,
			monitors: this.monitors.size,
			groups: this.groups.size,
			statusPages: this.statusPages.size,
			notificationChannels: this.notificationChannels.size,
			childrenByParent: this.childrenByParent.size,
			monitorsByPulseMonitor: this.monitorsByPulseMonitor.size,
			statusPageMonitorIndex: this.statusPageSlugsByMonitor.size,
			statusData: this.statusCache.size,
			dependencyLevels: this.dependencyLevels.size,
			entitiesWithDeps: this.dependenciesById.size,
		};
	}
}

export const cache = new CacheManager();
