import { readFile } from "node:fs/promises";

export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const path = query.path;
    if (typeof path !== "string" || !path) {
        throw createError({ statusCode: 400, statusMessage: "Missing path parameter" });
    }

    try {
        const content = await readFile(path, "utf-8");
        setResponseHeader(event, "Content-Type", "text/plain; charset=utf-8");
        return content;
    } catch {
        throw createError({ statusCode: 500, statusMessage: "Error reading file" });
    }
});
