import { describe, expect, test } from "bun:test";
import { formatDateTimeLocal, formatDuration, formatDateTimeISOCompact, formatDateTimeISOString, getCurrentMonth } from "../src/times";

describe("times", () => {
	describe("formatDuration", () => {
		test("0 milliseconds -> '0 seconds'", () => {
			expect(formatDuration(0)).toBe("0 seconds");
		});

		test("1 second singular", () => {
			expect(formatDuration(1000)).toBe("1 second");
		});

		test("30 seconds plural", () => {
			expect(formatDuration(30_000)).toBe("30 seconds");
		});

		test("59 seconds (boundary before minutes)", () => {
			expect(formatDuration(59_000)).toBe("59 seconds");
		});

		test("exactly 1 minute", () => {
			expect(formatDuration(60_000)).toBe("1 minute");
		});

		test("1 minute 1 second", () => {
			expect(formatDuration(61_000)).toBe("1 minute 1 second");
		});

		test("5 minutes 30 seconds", () => {
			expect(formatDuration(330_000)).toBe("5 minutes 30 seconds");
		});

		test("exactly 1 hour", () => {
			expect(formatDuration(3_600_000)).toBe("1 hour");
		});

		test("2 hours 15 minutes", () => {
			expect(formatDuration(8_100_000)).toBe("2 hours 15 minutes");
		});

		test("exactly 1 day", () => {
			expect(formatDuration(86_400_000)).toBe("1 day");
		});

		test("3 days 4 hours", () => {
			expect(formatDuration(273_600_000)).toBe("3 days 4 hours");
		});

		test("sub-second values floor to 0", () => {
			expect(formatDuration(999)).toBe("0 seconds");
		});
	});

	describe("formatDateTimeLocal", () => {
		// Use a fixed UTC date and account for local timezone in assertions
		const utcDate = new Date("2025-06-15T08:05:03.000Z");

		test("includes seconds by default", () => {
			const result = formatDateTimeLocal(utcDate);
			expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
		});

		test("omits seconds when includeSeconds is false", () => {
			const result = formatDateTimeLocal(utcDate, { includeSeconds: false });
			expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
		});

		test("accepts string input", () => {
			const result = formatDateTimeLocal("2025-01-01T00:00:00Z");
			expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
		});

		test("accepts numeric timestamp input", () => {
			const result = formatDateTimeLocal(0); // Unix epoch
			expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
		});
	});

	describe("formatDateTimeISOCompact", () => {
		const date = new Date("2025-10-15T20:56:27.542Z");

		test("default: no milliseconds", () => {
			expect(formatDateTimeISOCompact(date)).toBe("2025-10-15 20:56:27");
		});

		test("with milliseconds", () => {
			expect(formatDateTimeISOCompact(date, { includeMilliseconds: true })).toBe("2025-10-15 20:56:27.542");
		});

		test("replaces T with space and removes Z", () => {
			const result = formatDateTimeISOCompact(date);
			expect(result).not.toContain("T");
			expect(result).not.toContain("Z");
		});

		test("accepts string input", () => {
			expect(formatDateTimeISOCompact("2025-01-01T12:00:00.000Z")).toBe("2025-01-01 12:00:00");
		});

		test("accepts numeric input", () => {
			const result = formatDateTimeISOCompact(0);
			expect(result).toBe("1970-01-01 00:00:00");
		});
	});

	describe("formatDateTimeISOString", () => {
		test("strips milliseconds and keeps Z", () => {
			const date = new Date("2025-10-15T20:56:27.542Z");
			expect(formatDateTimeISOString(date)).toBe("2025-10-15T20:56:27Z");
		});

		test("handles zero milliseconds", () => {
			const date = new Date("2025-01-01T00:00:00.000Z");
			expect(formatDateTimeISOString(date)).toBe("2025-01-01T00:00:00Z");
		});

		test("accepts string input", () => {
			expect(formatDateTimeISOString("2025-06-01T12:30:45.123Z")).toBe("2025-06-01T12:30:45Z");
		});
	});

	describe("getCurrentMonth", () => {
		test("returns YYYY-MM format", () => {
			const result = getCurrentMonth();
			expect(result).toMatch(/^\d{4}-\d{2}$/);
		});

		test("month is zero-padded", () => {
			const result = getCurrentMonth();
			const month = parseInt(result.split("-")[1]!);
			expect(month).toBeGreaterThanOrEqual(1);
			expect(month).toBeLessThanOrEqual(12);
		});
	});
});
