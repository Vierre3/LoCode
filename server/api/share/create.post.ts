export default defineEventHandler(async (event) => {
    let body: any;
    try { body = await readBody(event); }
    catch { throw createError({ statusCode: 400, statusMessage: "Invalid JSON" }); }

    const { rootPath, backendMode, hostSessionId, allowTerminal, hostName } = body;
    if (typeof rootPath !== "string" || !rootPath) {
        throw createError({ statusCode: 400, statusMessage: "rootPath is required" });
    }
    if (backendMode !== "local" && backendMode !== "ssh") {
        throw createError({ statusCode: 400, statusMessage: "backendMode must be 'local' or 'ssh'" });
    }

    const session = createShare({
        rootPath,
        backendMode,
        hostSessionId: typeof hostSessionId === "string" ? hostSessionId : undefined,
        allowTerminal: !!allowTerminal,
        hostName: typeof hostName === "string" && hostName.trim() ? hostName.trim() : "Host",
    });

    // Build share URL from the request's origin
    const proto = getRequestHeader(event, "x-forwarded-proto") || "http";
    const host = getRequestHeader(event, "x-forwarded-host") || getRequestHeader(event, "host") || "localhost";
    const shareUrl = `${proto}://${host}?share=${session.id}`;

    return { ok: true, shareId: session.id, shareUrl };
});
