import { cache } from "../cache";
import { getActiveIncidents } from "../incidents";
import { Logger } from "../logger";

class IncidentScheduler {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private checkIntervalMs = 30_000;
	private running = false;
	private stopped = false;

	start(): void {
		if (this.timer || this.running) return;
		this.stopped = false;
		void this.runLoop();
		Logger.info("IncidentScheduler started", { checkIntervalMs: this.checkIntervalMs });
	}

	stop(): void {
		this.stopped = true;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		Logger.info("IncidentScheduler stopped");
	}

	private async runLoop(): Promise<void> {
		if (this.stopped) return;
		if (this.running) return;

		this.running = true;
		try {
			await this.rebuildCache();
		} catch (err) {
			Logger.error("IncidentScheduler tick failed", {
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

	private async rebuildCache(): Promise<void> {
		const active = await Promise.race([
			getActiveIncidents(),
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error("getActiveIncidents timeout")), 10_000)),
		]);

		const monitorIncidentMap = new Map<string, string[]>();

		for (const incident of active) {
			for (const monitorId of incident.affected_monitors) {
				const list = monitorIncidentMap.get(monitorId) || [];
				list.push(incident.id);
				monitorIncidentMap.set(monitorId, list);
			}
		}

		cache.setActiveIncidentMonitors(monitorIncidentMap);
	}

	async refreshCache(): Promise<void> {
		await this.rebuildCache();
	}
}

export const incidentScheduler = new IncidentScheduler();
