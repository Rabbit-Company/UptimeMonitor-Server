import { Web } from "@rabbit-company/web";
import { registerAdminAPI } from "../../src/admin";
import { registerPublicRoutes } from "../../src/routes";
import { fakeServer } from "./fakes";

export interface ApiResponse {
	status: number;
	/** Parsed JSON body, or the raw text when the response is not JSON. */
	body: any;
	headers: Headers;
}

export interface RequestOptions {
	/** Sent as a bearer token. */
	token?: string;
	/** Sent as JSON, or as-is when it is a string. */
	body?: unknown;
	headers?: Record<string, string>;
}

/** The public and admin routes mounted on a fresh app, without the server's global middleware. */
export function createApp(): Web {
	const app = new Web();
	// The real server always has global middleware. Without any, route-level middleware
	// gets `undefined` back from `next()`, which silently disables the response cache.
	app.use(async (_ctx, next) => next());
	registerAdminAPI(app, () => fakeServer as any);
	registerPublicRoutes(app);
	return app;
}

export async function request(app: Web, method: string, path: string, options: RequestOptions = {}): Promise<ApiResponse> {
	const headers: Record<string, string> = { ...options.headers };
	if (options.token) headers["Authorization"] = `Bearer ${options.token}`;

	let body: string | undefined;
	if (options.body !== undefined) {
		body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
		headers["Content-Type"] ??= "application/json";
	}

	const res = await app.handle(new Request(`http://localhost${path}`, { method, headers, body }));
	const text = await res.text();

	let parsed: any = text;
	try {
		parsed = JSON.parse(text);
	} catch {}

	return { status: res.status, body: parsed, headers: res.headers };
}
