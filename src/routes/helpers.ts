import { cache } from "../cache";
import type { CustomMetricConfig, ReportFormat, StatusPage } from "../types";
import { bearerAuth } from "@rabbit-company/web-middleware/bearer-auth";

/**
 * Reusable bearer-auth middleware for status-page-scoped routes.
 * Skips auth for unprotected or nonexistent pages (handler returns 404).
 */
export function statusPageBearerAuth() {
	return bearerAuth({
		skip(ctx) {
			const slug = ctx.params["slug"]!;
			const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
			if (!statusPage) return true;
			if (cache.isStatusPageProtected(slug)) return false;
			return true;
		},
		validate(token, ctx) {
			const slug = ctx.params["slug"]!;
			const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
			if (!statusPage) return false;
			if (token.length !== statusPage.hashedPassword!.length) return false;
			return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(statusPage.hashedPassword!));
		},
	});
}

/**
 * Reusable shouldCache for status-page-scoped routes.
 * Never cache responses for protected pages.
 */
export function statusPageShouldCache(ctx: any, res: any): boolean {
	const slug = ctx.params["slug"]!;
	const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
	if (!statusPage) return false;
	if (cache.isStatusPageProtected(slug)) return false;
	return res.status >= 200 && res.status < 300;
}

function getMetricLabelParts(config: CustomMetricConfig): { label: string; unit?: string } {
	return { label: config.name || config.id, unit: config.unit || undefined };
}

function formatStatHeaders(label: string, unit?: string): [string, string, string] {
	const unitSuffix = unit ? ` (${unit})` : "";
	return [`${label} Min${unitSuffix}`, `${label} Max${unitSuffix}`, `${label} Avg${unitSuffix}`];
}

/**
 * Parse the format query parameter. Defaults to "json".
 */
export function parseFormat(format: string | undefined): ReportFormat {
	if (format === "csv") return "csv";
	return "json";
}

/**
 * Build CSV column headers for monitor reports.
 */
export function buildMonitorCsvHeaders(custom1?: CustomMetricConfig, custom2?: CustomMetricConfig, custom3?: CustomMetricConfig): string[] {
	const headers = ["Timestamp", "Uptime (%)", "Latency Min (ms)", "Latency Max (ms)", "Latency Avg (ms)"];

	for (const custom of [custom1, custom2, custom3]) {
		if (!custom) continue;
		const { label, unit } = getMetricLabelParts(custom);
		headers.push(...formatStatHeaders(label, unit));
	}

	return headers;
}

/**
 * Build CSV column headers for group reports.
 */
export function buildGroupCsvHeaders(): string[] {
	return ["Timestamp", "Uptime (%)", "Latency Min (ms)", "Latency Max (ms)", "Latency Avg (ms)"];
}

/**
 * Escape a CSV field value (handles commas, quotes, newlines).
 */
function escapeCsvField(value: string | number | null | undefined): string {
	if (value === null || value === undefined) return "";
	const str = String(value);
	if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
		return `"${str.replace(/"/g, '""')}"`;
	}
	return str;
}

/**
 * Convert monitor history data to CSV string.
 */
export function monitorDataToCsv(
	data: Record<string, any>[],
	custom1?: CustomMetricConfig,
	custom2?: CustomMetricConfig,
	custom3?: CustomMetricConfig,
): string {
	const headers = buildMonitorCsvHeaders(custom1, custom2, custom3);
	const lines: string[] = [headers.map(escapeCsvField).join(",")];

	for (const row of data) {
		const values: (string | number | null | undefined)[] = [
			row.timestamp,
			row.uptime,
			row.latency_min ?? null,
			row.latency_max ?? null,
			row.latency_avg ?? null,
		];

		if (custom1) {
			values.push(row.custom1_min ?? null, row.custom1_max ?? null, row.custom1_avg ?? null);
		}
		if (custom2) {
			values.push(row.custom2_min ?? null, row.custom2_max ?? null, row.custom2_avg ?? null);
		}
		if (custom3) {
			values.push(row.custom3_min ?? null, row.custom3_max ?? null, row.custom3_avg ?? null);
		}

		lines.push(values.map(escapeCsvField).join(","));
	}

	return lines.join("\n");
}

/**
 * Convert group history data to CSV string.
 */
export function groupDataToCsv(data: Record<string, any>[]): string {
	const headers = buildGroupCsvHeaders();
	const lines: string[] = [headers.map(escapeCsvField).join(",")];

	for (const row of data) {
		const values: (string | number | null | undefined)[] = [
			row.timestamp,
			row.uptime,
			row.latency_min ?? null,
			row.latency_max ?? null,
			row.latency_avg ?? null,
		];
		lines.push(values.map(escapeCsvField).join(","));
	}

	return lines.join("\n");
}
