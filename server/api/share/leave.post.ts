export default defineEventHandler(async (event) => {
    let body: any;
    try { body = await readBody(event); }
    catch { throw createError({ statusCode: 400, statusMessage: "Invalid JSON" }); }

    const { shareId, guestId } = body;
    if (typeof shareId !== "string" || typeof guestId !== "string") {
        throw createError({ statusCode: 400, statusMessage: "shareId and guestId are required" });
    }

    leaveShare(shareId, guestId);
    return { ok: true };
});
