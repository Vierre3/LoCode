export default defineEventHandler((event) => {
    const query = getQuery(event);
    const shareId = typeof query.shareId === "string" ? query.shareId : "";
    if (!shareId) {
        throw createError({ statusCode: 400, statusMessage: "shareId query param is required" });
    }

    const session = getShare(shareId);
    if (!session) {
        return { exists: false };
    }

    const guests = Array.from(session.guests.values()).map(g => ({ id: g.id, name: g.name }));
    return {
        exists: true,
        rootPath: session.rootPath,
        allowTerminal: session.allowTerminal,
        hostName: session.hostName,
        guests,
        mode: session.mode,
        backendMode: session.backendMode,
    };
});
