import { writeFile } from "node:fs/promises";
import { normalize } from "node:path";

export default defineEventHandler(async (event) => {
    const shareId = getRequestHeader(event, "x-share-session");
    if (!shareId) throw createError({ statusCode: 400, statusMessage: "Missing X-Share-Session header" });

    const session = getShare(shareId);
    if (!session) throw createError({ statusCode: 404, statusMessage: "Share session not found" });

    let body: { path?: unknown; content?: unknown };
    try { body = await readBody(event); }
    catch { throw createError({ statusCode: 400, statusMessage: "Invalid JSON" }); }

    const { path, content } = body;
    if (typeof path !== "string" || typeof content !== "string") {
        throw createError({ statusCode: 400, statusMessage: "path and content must be strings" });
    }
    if (!isPathWithinRoot(path, session.rootPath)) {
        throw createError({ statusCode: 403, statusMessage: "Path outside shared root" });
    }

    if (session.mode === "relay") {
        await relayRequest(shareId, "write", { path, content });
        return "File saved!";
    }

    // Direct mode - SSH
    if (session.backendMode === "ssh" && session.hostSessionId) {
        const sftp = getSftp(session.hostSessionId);
        if (!sftp) throw createError({ statusCode: 503, statusMessage: "Host SSH not connected" });
        return new Promise((resolve, reject) => {
            const stream = sftp.createWriteStream(path, { encoding: "utf8" });
            stream.on("close", () => resolve("File saved!"));
            stream.on("error", () => reject(createError({ statusCode: 500, statusMessage: "Error writing file" })));
            stream.end(content);
        });
    }

    // Direct mode - Local
    try {
        await writeFile(normalize(path), content, "utf-8");
        return "File saved!";
    } catch (err: any) {
        throw createError({ statusCode: 500, statusMessage: `Error writing file: ${err?.code || err?.message || "unknown"}` });
    }
});
