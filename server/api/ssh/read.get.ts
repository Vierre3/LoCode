export default defineEventHandler(async (event) => {
    const sessionId = getSessionId(event);
    const sftpSession = getSftp(sessionId);
    if (!sftpSession) {
        throw createError({ statusCode: 503, statusMessage: "SSH not connected" });
    }

    const query = getQuery(event);
    const path = query.path;
    if (typeof path !== "string" || !path) {
        throw createError({ statusCode: 400, statusMessage: "Missing path parameter" });
    }

    return new Promise((resolve, reject) => {
        let content = "";
        const stream = sftpSession.createReadStream(path, { encoding: "utf8" });
        stream.on("data", (chunk: string) => { content += chunk; });
        stream.on("end", () => {
            setResponseHeader(event, "Content-Type", "text/plain; charset=utf-8");
            resolve(content);
        });
        stream.on("error", () => {
            reject(createError({ statusCode: 500, statusMessage: "Error reading file" }));
        });
    });
});
