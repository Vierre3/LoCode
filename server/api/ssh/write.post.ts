export default defineEventHandler(async (event) => {
    const sftpSession = getSftp();
    if (!sftpSession) {
        throw createError({ statusCode: 503, statusMessage: "SSH not connected" });
    }

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

    return new Promise((resolve, reject) => {
        const stream = sftpSession.createWriteStream(path, { encoding: "utf8" });
        stream.on("close", () => resolve("File saved!"));
        stream.on("error", () => {
            reject(createError({ statusCode: 500, statusMessage: "Error writing file" }));
        });
        stream.end(content);
    });
});
