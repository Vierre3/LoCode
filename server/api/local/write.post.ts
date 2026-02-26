import { writeFile } from "node:fs/promises";

export default defineEventHandler(async (event) => {
    let body: { path?: unknown; content?: unknown };
    try {
        body = await readBody(event);
    } catch {
        throw createError({ statusCode: 400, statusMessage: "Invalid JSON" });
    }

    const { path, content } = body;
    if (typeof path !== "string" || typeof content !== "string") {
        throw createError({ statusCode: 400, statusMessage: "Invalid request: path and content must be strings" });
    }

    try {
        await writeFile(path, content, "utf-8");
        return "File saved!";
    } catch {
        throw createError({ statusCode: 500, statusMessage: "Error writing file" });
    }
});
