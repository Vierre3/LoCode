import { stat } from "node:fs/promises";
import { normalize } from "node:path";

export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const rawPath = query.path;
    if (typeof rawPath !== "string" || !rawPath) {
        throw createError({ statusCode: 400, statusMessage: "Missing path parameter" });
    }
    const path = normalize(rawPath);

    try {
        const info = await stat(path);
        return { mtime: info.mtimeMs };
    } catch {
        throw createError({ statusCode: 500, statusMessage: "Error reading file stats" });
    }
});
