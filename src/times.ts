export const STARTUP_TIME = Date.now();
export const GRACE_PERIOD = 60000; // 1 minutes

/**
 * Check if we're still in the startup grace period
 */
export function isInGracePeriod(): boolean {
	return Date.now() - STARTUP_TIME < GRACE_PERIOD;
}

/**
	Output Example: `2001-10-15 20:56` or `2001-10-15 20:56:27`
*/
export function formatDateTimeLocal(date: Date | string | number, options: { includeSeconds?: boolean } = {}): string {
	const { includeSeconds = true } = options;
	const dt = date instanceof Date ? date : new Date(date);

	const year = dt.getFullYear();
	const month = String(dt.getMonth() + 1).padStart(2, "0");
	const day = String(dt.getDate()).padStart(2, "0");
	const hours = String(dt.getHours()).padStart(2, "0");
	const minutes = String(dt.getMinutes()).padStart(2, "0");
	const seconds = String(dt.getSeconds()).padStart(2, "0");

	let result = `${year}-${month}-${day} ${hours}:${minutes}`;
	if (includeSeconds) result += `:${seconds}`;
	return result;
}

/**
 * Output Example: `2001-10-15 20:56:27` or `2001-10-15 20:56:27.542`
 */
export function formatDateTimeISOCompact(date: Date | string | number, options: { includeMilliseconds?: boolean } = {}): string {
	const { includeMilliseconds = false } = options;
	const dt = date instanceof Date ? date : new Date(date);

	const iso = dt.toISOString();
	const noZ = iso.replace("T", " ").replace("Z", "");

	if (!includeMilliseconds) {
		return noZ.split(".")[0]!;
	}
	return noZ;
}

/**
 * Output Example: `2001-10-15T20:56:27Z`
 */
export function formatDateTimeISOString(date: Date | string | number): string {
	const dt = date instanceof Date ? date : new Date(date);
	return dt.toISOString().replace(/\.\d+Z$/, "Z");
}

/**
 * Output Example: `16 minutes 40 seconds`
 */
export function formatDuration(milliseconds: number): string {
	const seconds = Math.floor(milliseconds / 1000);

	if (seconds < 60) {
		return `${seconds} second${seconds !== 1 ? "s" : ""}`;
	}

	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;

	if (minutes < 60) {
		const parts = [`${minutes} minute${minutes !== 1 ? "s" : ""}`];
		if (remainingSeconds > 0) {
			parts.push(`${remainingSeconds} second${remainingSeconds !== 1 ? "s" : ""}`);
		}
		return parts.join(" ");
	}

	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;

	if (hours < 24) {
		const parts = [`${hours} hour${hours !== 1 ? "s" : ""}`];
		if (remainingMinutes > 0) {
			parts.push(`${remainingMinutes} minute${remainingMinutes !== 1 ? "s" : ""}`);
		}
		return parts.join(" ");
	}

	const days = Math.floor(hours / 24);
	const remainingHours = hours % 24;

	const parts = [`${days} day${days !== 1 ? "s" : ""}`];
	if (remainingHours > 0) {
		parts.push(`${remainingHours} hour${remainingHours !== 1 ? "s" : ""}`);
	}
	return parts.join(" ");
}
