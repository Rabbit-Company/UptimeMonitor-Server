import { Logger } from "../logger";
import { cache } from "../cache";
import {
	getActiveMaintenances,
	getScheduledMaintenancesDue,
	getInProgressMaintenancesExpired,
	transitionMaintenanceStatus,
	broadcastMaintenanceEvent,
} from "../maintenances";

/**
 * MaintenanceScheduler runs periodically to:
 * 1. Auto-transition "scheduled" --> "in_progress" when scheduled_start has passed
 * 2. Auto-transition "in_progress" --> "completed" when scheduled_end has passed
 * 3. Rebuild the in-memory set of monitor IDs under active maintenance (for notification suppression)
 */
class MaintenanceScheduler {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private readonly checkIntervalMs: number = 30_000;
	private readonly operationTimeoutMs: number = 10_000;

	private running = false;
	private stopped = true;

	start(): void {
		if (!this.stopped || this.running || this.timer) return;

		this.stopped = false;
		void this.runLoop();

		Logger.info("MaintenanceScheduler started", {
			checkIntervalMs: this.checkIntervalMs,
			operationTimeoutMs: this.operationTimeoutMs,
		});
	}

	stop(): void {
		this.stopped = true;

		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}

		Logger.info("MaintenanceScheduler stopped");
	}

	private async runLoop(): Promise<void> {
		if (this.stopped || this.running) return;

		this.running = true;

		try {
			await this.tick();
		} catch (err) {
			Logger.error("MaintenanceScheduler tick failed", {
				error: err instanceof Error ? err.message : "Unknown error",
			});
		} finally {
			this.running = false;
		}

		if (!this.stopped) {
			this.timer = setTimeout(() => {
				void this.runLoop();
			}, this.checkIntervalMs);
		}
	}

	private async tick(): Promise<void> {
		await this.runStep("autoStartScheduled", () => this.autoStartScheduled());
		await this.runStep("autoCompleteExpired", () => this.autoCompleteExpired());
		await this.runStep("rebuildCache", () => this.rebuildCache());
	}

	private async runStep(name: string, fn: () => Promise<void>): Promise<void> {
		try {
			await fn();
		} catch (err) {
			Logger.error(`MaintenanceScheduler ${name} failed`, {
				error: err instanceof Error ? err.message : "Unknown error",
			});
		}
	}

	private async withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${this.operationTimeoutMs}ms`)), this.operationTimeoutMs)),
		]);
	}

	private async autoStartScheduled(): Promise<void> {
		const due = await this.withTimeout(getScheduledMaintenancesDue(), "getScheduledMaintenancesDue");

		for (const maintenance of due) {
			try {
				const updated = await this.withTimeout(
					transitionMaintenanceStatus(maintenance.id, "in_progress", "Maintenance window has started (auto-transition)."),
					`transitionMaintenanceStatus(in_progress:${maintenance.id})`,
				);

				if (updated) {
					Logger.info("Maintenance auto-started", {
						maintenanceId: maintenance.id,
						title: maintenance.title,
					});

					const statusPage = cache.getStatusPage(maintenance.status_page_id);
					if (statusPage) {
						try {
							broadcastMaintenanceEvent(statusPage.slug, "maintenance-update-added", {
								maintenance: updated,
							});
						} catch (err) {
							Logger.error("broadcastMaintenanceEvent failed", {
								maintenanceId: maintenance.id,
								event: "maintenance-started",
								error: err instanceof Error ? err.message : "Unknown error",
							});
						}
					}
				}
			} catch (err) {
				Logger.error("Failed to auto-start maintenance", {
					maintenanceId: maintenance.id,
					error: err instanceof Error ? err.message : "Unknown error",
				});
			}
		}
	}

	private async autoCompleteExpired(): Promise<void> {
		const expired = await this.withTimeout(getInProgressMaintenancesExpired(), "getInProgressMaintenancesExpired");

		for (const maintenance of expired) {
			try {
				const updated = await this.withTimeout(
					transitionMaintenanceStatus(maintenance.id, "completed", "Maintenance window has ended (auto-transition)."),
					`transitionMaintenanceStatus(completed:${maintenance.id})`,
				);

				if (updated) {
					Logger.info("Maintenance auto-completed", {
						maintenanceId: maintenance.id,
						title: maintenance.title,
					});

					const statusPage = cache.getStatusPage(maintenance.status_page_id);
					if (statusPage) {
						try {
							broadcastMaintenanceEvent(statusPage.slug, "maintenance-update-added", {
								maintenance: updated,
							});
						} catch (err) {
							Logger.error("broadcastMaintenanceEvent failed", {
								maintenanceId: maintenance.id,
								event: "maintenance-completed",
								error: err instanceof Error ? err.message : "Unknown error",
							});
						}
					}
				}
			} catch (err) {
				Logger.error("Failed to auto-complete maintenance", {
					maintenanceId: maintenance.id,
					error: err instanceof Error ? err.message : "Unknown error",
				});
			}
		}
	}

	private async rebuildCache(): Promise<void> {
		const active = await this.withTimeout(getActiveMaintenances(), "getActiveMaintenances");

		const monitorMaintenanceMap = new Map<string, string[]>();

		for (const maintenance of active) {
			for (const monitorId of maintenance.affected_monitors) {
				const list = monitorMaintenanceMap.get(monitorId) || [];
				list.push(maintenance.id);
				monitorMaintenanceMap.set(monitorId, list);
			}
		}

		cache.setActiveMaintenanceMonitors(monitorMaintenanceMap);
	}

	async refreshCache(): Promise<void> {
		await this.runStep("refreshCache", () => this.rebuildCache());
	}
}

export const maintenanceScheduler = new MaintenanceScheduler();
