export default defineEventHandler(async (event) => {
    const sftpSession = getSftp();
    if (!sftpSession) {
        throw createError({ statusCode: 503, statusMessage: "SSH not connected" });
    }

    const query = getQuery(event);
    const root = (typeof query.path === "string" && query.path) ? query.path : getRemoteHome();

    return new Promise((resolve, reject) => {
        sftpSession.readdir(root, (err, list) => {
            if (err) {
                reject(createError({ statusCode: 500, statusMessage: "Error listing directory" }));
                return;
            }
            const result = list
                .filter((e) => e.filename !== ".LoCode")
                .map((e) => ({
                    name: e.filename,
                    path: root === "/" ? `/${e.filename}` : `${root}/${e.filename}`,
                    type: (e.attrs.mode! & 0o40000) ? "dir" as const : "file" as const,
                }));
            resolve(result);
        });
    });
});
