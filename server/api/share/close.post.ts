export default defineEventHandler(async (event) => {
    let body: any;
    try { body = await readBody(event); }
    catch { throw createError({ statusCode: 400, statusMessage: "Invalid JSON" }); }

    const { shareId } = body;
    if (typeof shareId !== "string" || !shareId) {
        throw createError({ statusCode: 400, statusMessage: "shareId is required" });
    }

    if (!closeShare(shareId)) {
        throw createError({ statusCode: 404, statusMessage: "Share session not found" });
    }
    return { ok: true };
});
