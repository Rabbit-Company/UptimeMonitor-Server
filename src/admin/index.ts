import type { Web, Server } from "@rabbit-company/web";
import { Logger } from "../logger";
import { config } from "../config";
import { registerMonitorRoutes } from "./monitors";
import { adminBearerAuth } from "./helpers";
import { registerGroupRoutes } from "./groups";

export function registerAdminAPI(app: Web, getServer: () => Server): void {
	registerMonitorRoutes(app, getServer);
	registerGroupRoutes(app, getServer);

	app.get("/v1/admin/config", adminBearerAuth(), (ctx) => {
		return ctx.json(config);
	});

	Logger.info("Admin API registered", { prefix: "/v1/admin" });
}
