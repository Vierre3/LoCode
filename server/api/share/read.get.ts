import { readFile } from "node:fs/promises";
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
        const content = await relayRequest(shareId, "read", { path });
        setResponseHeader(event, "Content-Type", "text/plain; charset=utf-8");
        return content;
    }

    // Direct mode
    if (session.backendMode === "ssh" && session.hostSessionId) {
        const sftp = getSftp(session.hostSessionId);
        if (!sftp) throw createError({ statusCode: 503, statusMessage: "Host SSH not connected" });
        return new Promise((resolve, reject) => {
            let content = "";
            const stream = sftp.createReadStream(path, { encoding: "utf8" });
            stream.on("data", (chunk: string) => { content += chunk; });
            stream.on("end", () => {
                setResponseHeader(event, "Content-Type", "text/plain; charset=utf-8");
                resolve(content);
            });
            stream.on("error", () => reject(createError({ statusCode: 500, statusMessage: "Error reading file" })));
        });
    }

    // Local mode
    try {
        const content = await readFile(normalize(path), "utf-8");
        setResponseHeader(event, "Content-Type", "text/plain; charset=utf-8");
        return content;
    } catch (err: any) {
        throw createError({ statusCode: 500, statusMessage: `Error reading file: ${err?.code || err?.message || "unknown"}` });
    }
});
