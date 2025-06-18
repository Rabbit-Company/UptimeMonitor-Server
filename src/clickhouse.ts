import { createClient } from "@clickhouse/client";
import { config } from "./config";
import { Logger } from "./logger";
import { EventEmitter } from "events";
import type { Group, HistoryRecord, IntervalConfig, Monitor, PulseRecord, StatusData, UptimeRecord } from "./types";

export const statusCache = new Map<string, StatusData>();
export const eventEmitter = new EventEmitter();

export const clickhouse = createClient(config.clickhouse);

export async function initClickHouse(): Promise<void> {
	try {
		await clickhouse.exec({
			query: `
      CREATE TABLE IF NOT EXISTS pulses (
        monitor_id String,
        status Enum('up' = 1, 'down' = 2),
        latency Float32,
        timestamp DateTime64(3)
      ) ENGINE = MergeTree()
      ORDER BY (monitor_id, timestamp)
      PARTITION BY toYYYYMM(timestamp)
    `,
		});

		await clickhouse.exec({
			query: `
      CREATE TABLE IF NOT EXISTS monitor_status (
        monitor_id String,
        status Enum('up' = 1, 'down' = 2),
        latency Float32,
        last_check DateTime64(3),
        uptime_24h Float32,
        uptime_7d Float32,
        uptime_30d Float32,
        updated_at DateTime64(3)
      ) ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY monitor_id
    `,
		});
	} catch (err: any) {
		Logger.error("ClickHouse connection failed", { "error.message": err?.message });
	}
}

export async function storePulse(monitorId: string, status: "up" | "down", latency: number): Promise<void> {
	const timestamp = new Date();

	try {
		await clickhouse.insert({
			table: "pulses",
			values: [
				{
					monitor_id: monitorId,
					status,
					latency,
					timestamp,
				},
			],
			format: "JSONEachRow",
		});
	} catch (err: any) {
		Logger.error("Storing pulse into ClickHouse failed", { monitorId: monitorId, "error.message": err?.message });
	}

	// Update monitor status cache
	await updateMonitorStatus(monitorId);

	// Emit event for real-time updates
	eventEmitter.emit("pulse", { monitorId, status, latency, timestamp });
}

export async function updateMonitorStatus(monitorId: string): Promise<void> {
	try {
		const queries = {
			latest: `
      SELECT status, latency, timestamp as last_check
      FROM pulses
      WHERE monitor_id = '${monitorId}'
      ORDER BY timestamp DESC
      LIMIT 1
    `,
			uptime24h: `
      SELECT
        countIf(status = 'up') / count() * 100 as uptime
      FROM pulses
      WHERE monitor_id = '${monitorId}'
        AND timestamp > now() - INTERVAL 24 HOUR
    `,
			uptime7d: `
      SELECT
        countIf(status = 'up') / count() * 100 as uptime
      FROM pulses
      WHERE monitor_id = '${monitorId}'
        AND timestamp > now() - INTERVAL 7 DAY
    `,
			uptime30d: `
      SELECT
        countIf(status = 'up') / count() * 100 as uptime
      FROM pulses
      WHERE monitor_id = '${monitorId}'
        AND timestamp > now() - INTERVAL 30 DAY
    `,
		};

		const [latest, uptime24h, uptime7d, uptime30d] = await Promise.all([
			clickhouse.query({ query: queries.latest, format: "JSONEachRow" }),
			clickhouse.query({ query: queries.uptime24h, format: "JSONEachRow" }),
			clickhouse.query({ query: queries.uptime7d, format: "JSONEachRow" }),
			clickhouse.query({ query: queries.uptime30d, format: "JSONEachRow" }),
		]);

		const latestData = await latest.json<PulseRecord>();
		const uptime24hData = await uptime24h.json<UptimeRecord>();
		const uptime7dData = await uptime7d.json<UptimeRecord>();
		const uptime30dData = await uptime30d.json<UptimeRecord>();

		if (!latestData.length) return;

		const monitor: Monitor | undefined = config.monitors.find((m: Monitor) => m.id === monitorId);
		if (!monitor) return;

		const statusData: StatusData = {
			id: monitorId,
			type: "monitor",
			name: monitor.name,
			status: latestData[0]!.status,
			latency: latestData[0]!.latency,
			lastCheck: new Date(latestData[0]!.last_check),
			uptime24h: uptime24hData[0]?.uptime || 0,
			uptime7d: uptime7dData[0]?.uptime || 0,
			uptime30d: uptime30dData[0]?.uptime || 0,
		};

		statusCache.set(monitorId, statusData);

		// Update parent groups
		if (monitor.groupId) {
			await updateGroupStatus(monitor.groupId);
		}
	} catch (err: any) {
		Logger.error("Updating monitor status failed", { monitorId: monitorId, "error.message": err?.message });
	}
}

export async function updateGroupStatus(groupId: string): Promise<void> {
	const group: Group | undefined = config.groups.find((g: Group) => g.id === groupId);
	if (!group) return;

	// Get all children (monitors and subgroups)
	const childMonitors: Monitor[] = config.monitors.filter((m: Monitor) => m.groupId === groupId);
	const childGroups: Group[] = config.groups.filter((g: Group) => g.parentId === groupId);

	let totalUp = 0;
	let totalChildren = 0;
	let totalLatency = 0;
	let latencyCount = 0;

	// Process monitors
	for (const monitor of childMonitors) {
		totalChildren++;
		const status = statusCache.get(monitor.id);
		if (status) {
			if (status.status === "up") totalUp++;
			if (status.latency) {
				totalLatency += status.latency;
				latencyCount++;
			}
		}
	}

	// Process subgroups
	for (const subgroup of childGroups) {
		totalChildren++;
		const status = statusCache.get(subgroup.id);
		if (status) {
			if (status.status === "up") totalUp++;
			if (status.latency) {
				totalLatency += status.latency;
				latencyCount++;
			}
		}
	}

	const upPercentage = totalChildren > 0 ? (totalUp / totalChildren) * 100 : 0;
	const avgLatency = latencyCount > 0 ? totalLatency / latencyCount : 0;

	let status: "up" | "down" | "degraded";
	if (upPercentage === 100) {
		status = "up";
	} else if (upPercentage >= group.degradedThreshold) {
		status = "degraded";
	} else {
		status = "down";
	}

	const groupStatus: StatusData = {
		id: groupId,
		type: "group",
		name: group.name,
		status,
		latency: avgLatency,
	};

	statusCache.set(groupId, groupStatus);

	// Update parent group if exists
	if (group.parentId) {
		await updateGroupStatus(group.parentId);
	}
}

export async function getMonitorHistory(monitorId: string, period: string): Promise<HistoryRecord[]> {
	const intervals: Record<string, IntervalConfig> = {
		"24h": { interval: "5 minute", range: "24 HOUR" },
		"7d": { interval: "1 hour", range: "7 DAY" },
		"30d": { interval: "6 hour", range: "30 DAY" },
	};

	const { interval, range }: IntervalConfig = intervals[period] || { interval: "5 minute", range: "24 HOUR" };

	const query = `
		SELECT
			toStartOfInterval(timestamp, INTERVAL ${interval}) as time,
			avg(latency) as avg_latency,
			min(latency) as min_latency,
			max(latency) as max_latency,
			countIf(status = 'up') / count() * 100 as uptime
		FROM pulses
		WHERE monitor_id = '${monitorId}'
			AND timestamp > now() - INTERVAL ${range}
		GROUP BY time
		ORDER BY time
	`;

	const result = await clickhouse.query({ query, format: "JSONEachRow" });
	return await result.json<HistoryRecord>();
}
