import { readdir } from "node:fs/promises";
import { join, normalize } from "node:path";
import { homedir } from "node:os";

export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const rawPath = (typeof query.path === "string" && query.path) ? query.path : null;
    const root = rawPath ? normalize(rawPath) : homedir();

    try {
        const entries = await readdir(root, { withFileTypes: true });
        const result = entries
            .filter((e) => e.name !== ".LoCode")
            .map((e) => ({
                name: e.name,
                path: join(root, e.name),
                type: e.isDirectory() ? "dir" as const : "file" as const,
            }));
        return result;
    } catch (err: any) {
        throw createError({ statusCode: 500, statusMessage: `Error listing directory: ${err?.code || err?.message || "unknown"}` });
    }
});
