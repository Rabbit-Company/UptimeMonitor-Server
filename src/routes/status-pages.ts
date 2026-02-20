import type { Web } from "@rabbit-company/web";
import { cache } from "../cache";
import type { StatusPage, StatusData } from "../types";
import { buildStatusTree } from "../statuspage";
import { cache as webCache } from "@rabbit-company/web-middleware/cache";
import { statusPageBearerAuth, statusPageShouldCache } from "./helpers";

export function registerStatusPageRoutes(app: Web): void {
	/**
	 * GET /v1/status/:slug
	 * Returns full status page data with all monitors and groups
	 */
	app.get("/v1/status/:slug", statusPageBearerAuth(), webCache({ ttl: 30, generateETags: false, shouldCache: statusPageShouldCache }), async (ctx) => {
		const slug: string = ctx.params["slug"]!;
		const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
		if (!statusPage) return ctx.json({ error: "Status page not found" }, 404);

		const statusData: StatusData[] = buildStatusTree(statusPage.items);
		return ctx.json({
			name: statusPage.name,
			slug: statusPage.slug,
			items: statusData,
			lastUpdated: new Date(),
		});
	});

	/**
	 * GET /v1/status/:slug/summary
	 * Returns a quick overview without full monitor details
	 */
	app.get("/v1/status/:slug/summary", statusPageBearerAuth(), webCache({ ttl: 30, generateETags: false, shouldCache: statusPageShouldCache }), async (ctx) => {
		const slug: string = ctx.params["slug"]!;
		const statusPage: StatusPage | undefined = cache.getStatusPageBySlug(slug);
		if (!statusPage) return ctx.json({ error: "Status page not found" }, 404);

		let totalUp = 0,
			totalDegraded = 0,
			totalDown = 0;

		for (const id of statusPage.items) {
			const status = cache.getStatus(id);
			if (!status) continue;
			if (status.status === "up") totalUp++;
			else if (status.status === "degraded") totalDegraded++;
			else if (status.status === "down") totalDown++;
		}

		const overallStatus = totalDown > 0 ? "down" : totalDegraded > 0 ? "degraded" : "up";

		return ctx.json({
			status: overallStatus,
			monitors: { up: totalUp, degraded: totalDegraded, down: totalDown, total: totalUp + totalDegraded + totalDown },
		});
	});
}
