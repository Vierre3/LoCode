export default defineEventHandler(async (event) => {
    // Allow client to override the backend URL (used for remote SSH mode)
    const customBase = getHeader(event, "x-backend-url");
    const base = customBase || `${process.env.DENO_URL}:${process.env.DENO_PORT}`;
    const target = `${base}/${getRouterParam(event, "url")}?${new URLSearchParams(getQuery(event))}`;
    return proxyRequest(event, target);
});
