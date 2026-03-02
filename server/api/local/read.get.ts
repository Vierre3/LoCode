import { readFile } from "node:fs/promises";
import { normalize } from "node:path";

export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const rawPath = query.path;
    if (typeof rawPath !== "string" || !rawPath) {
        throw createError({ statusCode: 400, statusMessage: "Missing path parameter" });
    }
    // normalize restores UNC paths: //wsl.localhost/... → \\wsl.localhost\...
    const path = normalize(rawPath);

    try {
        const content = await readFile(path, "utf-8");
        setResponseHeader(event, "Content-Type", "text/plain; charset=utf-8");
        return content;
    } catch (err: any) {
        throw createError({ statusCode: 500, statusMessage: `Error reading file: ${err?.code || err?.message || "unknown"}` });
    }
});
