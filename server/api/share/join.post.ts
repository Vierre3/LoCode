export default defineEventHandler(async (event) => {
    let body: any;
    try { body = await readBody(event); }
    catch { throw createError({ statusCode: 400, statusMessage: "Invalid JSON" }); }

    const { shareId, name } = body;
    if (typeof shareId !== "string" || !shareId) {
        throw createError({ statusCode: 400, statusMessage: "shareId is required" });
    }

    const result = joinShare(shareId, typeof name === "string" ? name : undefined);
    if (!result) {
        throw createError({ statusCode: 404, statusMessage: "Share session not found" });
    }

    const { session, guest } = result;
    const guests = Array.from(session.guests.values()).map(g => ({ id: g.id, name: g.name }));

    return {
        ok: true,
        guestId: guest.id,
        rootPath: session.rootPath,
        allowTerminal: session.allowTerminal,
        hostName: session.hostName,
        guests,
    };
});
