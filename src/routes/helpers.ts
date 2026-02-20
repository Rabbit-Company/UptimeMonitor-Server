import { cache } from "../cache";
import type { StatusPage } from "../types";
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
