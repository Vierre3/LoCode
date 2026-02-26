export default defineEventHandler(async (event) => {
    let body: { host?: unknown; port?: unknown; username?: unknown; password?: unknown };
    try {
        body = await readBody(event);
    } catch {
        throw createError({ statusCode: 400, statusMessage: "Invalid JSON" });
    }

    const { host, port, username, password } = body;
    if (typeof host !== "string" || !host || typeof username !== "string" || !username) {
        throw createError({ statusCode: 400, statusMessage: "host and username are required" });
    }

    try {
        const result = await sshConnect({
            host,
            port: typeof port === "number" ? port : 22,
            username,
            password: typeof password === "string" ? password : undefined,
        });
        return { ok: true, home: result.home };
    } catch (err: any) {
        throw createError({ statusCode: 502, statusMessage: err.message });
    }
});
