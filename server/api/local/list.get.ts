import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const root = (typeof query.path === "string" && query.path) ? query.path : homedir();

    try {
        const entries = await readdir(root, { withFileTypes: true });
        const result = entries
            .filter((e) => e.name !== ".LoCode")
            .map((e) => ({
                name: e.name,
                path: root === "/" ? `/${e.name}` : `${root}/${e.name}`,
                type: e.isDirectory() ? "dir" as const : "file" as const,
            }));
        return result;
    } catch {
        throw createError({ statusCode: 500, statusMessage: "Error listing directory" });
    }
});
