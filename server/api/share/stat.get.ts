import { stat } from "node:fs/promises";
import { normalize } from "node:path";

export default defineEventHandler(async (event) => {
    const shareId = getRequestHeader(event, "x-share-session");
    if (!shareId) throw createError({ statusCode: 400, statusMessage: "Missing X-Share-Session header" });

    const session = getShare(shareId);
    if (!session) throw createError({ statusCode: 404, statusMessage: "Share session not found" });

    const query = getQuery(event);
    const path = typeof query.path === "string" ? query.path : "";
    if (!path) throw createError({ statusCode: 400, statusMessage: "Missing path parameter" });
    if (!isPathWithinRoot(path, session.rootPath)) {
        throw createError({ statusCode: 403, statusMessage: "Path outside shared root" });
    }

    if (session.mode === "relay") {
        return await relayRequest(shareId, "stat", { path });
    }

    // Direct mode - SSH
    if (session.backendMode === "ssh" && session.hostSessionId) {
        const sftp = getSftp(session.hostSessionId);
        if (!sftp) throw createError({ statusCode: 503, statusMessage: "Host SSH not connected" });
        return new Promise((resolve, reject) => {
            sftp.stat(path, (err, stats) => {
                if (err) reject(createError({ statusCode: 500, statusMessage: "Error reading file stats" }));
                else resolve({ mtime: (stats.mtime ?? 0) * 1000 });
            });
        });
    }

    // Direct mode - Local
    try {
        const info = await stat(normalize(path));
        return { mtime: info.mtimeMs };
    } catch {
        throw createError({ statusCode: 500, statusMessage: "Error reading file stats" });
    }
});
