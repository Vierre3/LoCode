import { readdir } from "node:fs/promises";
import { join, normalize } from "node:path";

export default defineEventHandler(async (event) => {
    const shareId = getRequestHeader(event, "x-share-session");
    if (!shareId) throw createError({ statusCode: 400, statusMessage: "Missing X-Share-Session header" });

    const session = getShare(shareId);
    if (!session) throw createError({ statusCode: 404, statusMessage: "Share session not found" });

    const query = getQuery(event);
    const path = typeof query.path === "string" && query.path ? query.path : session.rootPath;
    if (!isPathWithinRoot(path, session.rootPath)) {
        throw createError({ statusCode: 403, statusMessage: "Path outside shared root" });
    }

    if (session.mode === "relay") {
        try {
            const result = await relayRequest(shareId, "list", { path });
            return result;
        } catch (err: any) {
            throw createError({ statusCode: 502, statusMessage: `Relay error: ${err.message}` });
        }
    }

    // Direct mode - SSH
    if (session.backendMode === "ssh" && session.hostSessionId) {
        const sftp = getSftp(session.hostSessionId);
        if (!sftp) throw createError({ statusCode: 503, statusMessage: "Host SSH not connected" });
        return new Promise((resolve, reject) => {
            sftp.readdir(path, (err, list) => {
                if (err) return reject(createError({ statusCode: 500, statusMessage: "Error listing directory" }));
                resolve(list
                    .filter(e => e.filename !== ".LoCode")
                    .map(e => ({
                        name: e.filename,
                        path: path === "/" ? `/${e.filename}` : `${path}/${e.filename}`,
                        type: (e.attrs.mode! & 0o40000) ? "dir" as const : "file" as const,
                    })));
            });
        });
    }

    // Direct mode - Local
    try {
        const root = normalize(path);
        const entries = await readdir(root, { withFileTypes: true });
        return entries
            .filter(e => e.name !== ".LoCode")
            .map(e => ({
                name: e.name,
                path: join(root, e.name),
                type: e.isDirectory() ? "dir" as const : "file" as const,
            }));
    } catch (err: any) {
        throw createError({ statusCode: 500, statusMessage: `Error listing directory: ${err?.code || err?.message || "unknown"}` });
    }
});
