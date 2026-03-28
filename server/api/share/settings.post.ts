export default defineEventHandler(async (event) => {
    let body: any;
    try { body = await readBody(event); }
    catch { throw createError({ statusCode: 400, statusMessage: "Invalid JSON" }); }

    const { shareId, allowTerminal } = body;
    if (typeof shareId !== "string" || !shareId) {
        throw createError({ statusCode: 400, statusMessage: "shareId is required" });
    }

    if (!updateShareSettings(shareId, {
        allowTerminal: typeof allowTerminal === "boolean" ? allowTerminal : undefined,
    })) {
        throw createError({ statusCode: 404, statusMessage: "Share session not found" });
    }
    return { ok: true };
});
