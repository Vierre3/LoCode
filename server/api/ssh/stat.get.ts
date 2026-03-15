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
        sftpSession.stat(path, (err, stats) => {
            if (err) {
                reject(createError({ statusCode: 500, statusMessage: "Error reading file stats" }));
            } else {
                resolve({ mtime: (stats.mtime ?? 0) * 1000 });
            }
        });
    });
});
