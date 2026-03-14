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
        console.error("[SSH connect error]", err.message, err.stack);
        // Clean up error message — strip internal details (IPs, ports, paths)
        let msg = (err.message || "Connection failed")
            .replace(/^SSH connection failed:\s*/, "")
            .replace(/\d+\.\d+\.\d+\.\d+:\d+/g, "host")
            .replace(/address\s+\S+/gi, "host");
        throw createError({ statusCode: 502, statusMessage: msg });
    }
});
