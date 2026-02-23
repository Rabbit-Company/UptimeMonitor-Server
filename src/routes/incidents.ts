import type { Web } from "@rabbit-company/web";
import { cache } from "../cache";
import type { StatusPage } from "../types";
import { getIncidentsByMonth } from "../incidents";
import { cache as webCache } from "@rabbit-company/web-middleware/cache";
import { statusPageBearerAuth, statusPageShouldCache } from "./helpers";
import { getCurrentMonth } from "../times";

export function registerIncidentRoutes(app: Web): void {
	/**
	 * GET /v1/status/:slug/incidents
	 * Returns all incidents for a status page in a given month, with all updates inlined.
	 *
	 * Query params:
	 *   - month: "YYYY-MM" format (defaults to current month)
	 */
	app.get(
		"/v1/status/:slug/incidents",
		statusPageBearerAuth(),
		webCache({ ttl: 30, generateETags: false, shouldCache: statusPageShouldCache }),
		async (ctx) => {
			const slug = ctx.params["slug"]!;
			const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
			if (!statusPage) return ctx.json({ error: "Status page not found" }, 404);

			const month = ctx.query().get("month") || undefined;

			// Validate month format if provided
			if (month) {
				const monthRegex = /^\d{4}-(0[1-9]|1[0-2])$/;
				if (!monthRegex.test(month)) {
					return ctx.json({ error: "Invalid month format. Use YYYY-MM (2026-02)" }, 400);
				}
			}

			const incidents = await getIncidentsByMonth(statusPage.id, month);

			return ctx.json({
				statusPageId: statusPage.id,
				month: month || getCurrentMonth(),
				incidents,
			});
		},
	);
}
