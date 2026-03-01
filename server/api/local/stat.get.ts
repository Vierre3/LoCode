import { stat } from "node:fs/promises";

export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const path = query.path;
    if (typeof path !== "string" || !path) {
        throw createError({ statusCode: 400, statusMessage: "Missing path parameter" });
    }

    try {
        const info = await stat(path);
        return { mtime: info.mtimeMs };
    } catch {
        throw createError({ statusCode: 500, statusMessage: "Error reading file stats" });
    }
});
