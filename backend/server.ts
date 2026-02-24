// server.ts
// Run with: deno run --allow-all --unstable-pty backend/server.ts
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

type FileEntry = {
    name: string;
    path: string;
    type: "file" | "dir";
};

// const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const textHeaders = { "Content-Type": "text/plain; charset=utf-8" };

// CORS headers — needed when the browser connects directly (remote SSH mode)
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

async function readFile(path: string): Promise<{ content: string; status: number }> {
    try {
        // const stat = await Deno.stat(path);
        // if (stat.size > MAX_FILE_SIZE) {
        //     return { content: `File too large (${(stat.size / 1024 / 1024).toFixed(1)} MB). Max: 5 MB.`, status: 413 };
        // }
        return { content: await Deno.readTextFile(path), status: 200 };
    } catch (e) {
        console.error(`Error reading ${path}:`, e);
        return { content: "Error reading file", status: 500 };
    }
}

async function writeFile(path: string, content: string): Promise<{ message: string; status: number }> {
    try {
        await Deno.writeTextFile(path, content);
        return { message: "File saved!", status: 200 };
    } catch (e) {
        console.error(`Error writing ${path}:`, e);
        return { message: "Error writing file", status: 500 };
    }
}

async function listDir(path: string): Promise<FileEntry[]> {
    const result: FileEntry[] = [];
    for await (const entry of Deno.readDir(path)) {
        if (entry.name === ".LoCode") continue;
        const fullPath = path === "/" ? `/${entry.name}` : `${path}/${entry.name}`;
        result.push({ name: entry.name, path: fullPath, type: entry.isDirectory ? "dir" : "file" });
    }
    return result;
}

// --- Terminal WebSocket handler (requires --unstable-pty) ---
// Spawns a real PTY on the server machine. Used in remote SSH mode so the
// browser's terminal runs a shell on the Deno host, not on the Nuxt server.
function handleTerminalWs(socket: WebSocket) {
    // deno-lint-ignore no-explicit-any
    let pty: any = null;
    // deno-lint-ignore no-explicit-any
    let proc: any = null;
    const decoder = new TextDecoder();

    socket.onmessage = async (event: MessageEvent) => {
        try {
            const msg = JSON.parse(event.data as string);

            if (msg.type === "create") {
                const shell = Deno.env.get("SHELL") || "/bin/bash";
                const cwd = msg.cwd || Deno.env.get("HOME") || "/";
                const cols = (msg.cols as number) || 80;
                const rows = (msg.rows as number) || 24;

                // Deno.openPty requires --unstable-pty
                // deno-lint-ignore no-explicit-any
                pty = (Deno as any).openPty({ name: "xterm-256color", cols, rows });

                // Spawn shell with its stdio connected to the PTY slave
                proc = new Deno.Command(shell, {
                    args: ["-i"],
                    cwd,
                    env: { ...Deno.env.toObject(), TERM: "xterm-256color", COLORTERM: "truecolor" },
                    stdin: pty.slave,
                    stdout: pty.slave,
                    stderr: pty.slave,
                }).spawn();

                // Stream PTY master output → WebSocket
                (async () => {
                    try {
                        for await (const chunk of pty.readable as ReadableStream<Uint8Array>) {
                            if (socket.readyState === WebSocket.OPEN) {
                                socket.send(JSON.stringify({ type: "output", data: decoder.decode(chunk) }));
                            }
                        }
                    } catch { /* PTY closed */ }
                })();

                // deno-lint-ignore no-explicit-any
                proc.status.then((status: any) => {
                    if (socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({ type: "exit", code: status.code }));
                    }
                    try { socket.close(); } catch { /* already closed */ }
                }).catch(() => {});

            } else if (msg.type === "input" && pty) {
                const writer = (pty.writable as WritableStream<Uint8Array>).getWriter();
                try {
                    await writer.write(new TextEncoder().encode(msg.data as string));
                } finally {
                    writer.releaseLock();
                }

            } else if (msg.type === "resize" && pty) {
                pty.setSize({ columns: msg.cols as number, rows: msg.rows as number });
            }
        } catch (e) {
            console.error("[terminal-ws] error:", e);
        }
    };

    const cleanup = () => {
        try { proc?.kill(); } catch { /* already gone */ }
        try { pty?.close(); } catch { /* already closed */ }
    };
    socket.onclose = cleanup;
    socket.onerror = cleanup;
}

serve(async (req) => {
    try {
        const url = new URL(req.url);

        // Handle CORS preflight
        if (req.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        // Terminal WebSocket endpoint (used in remote SSH mode)
        if (url.pathname === "/_terminal" && req.headers.get("upgrade") === "websocket") {
            const { socket, response } = Deno.upgradeWebSocket(req);
            handleTerminalWs(socket);
            return response;
        }

        if (req.method === "GET" && url.pathname === "/read") {
            const path = url.searchParams.get("path");
            if (!path) return new Response("Missing path parameter", { status: 400, headers: { ...textHeaders, ...corsHeaders } });
            const { content, status } = await readFile(path);
            return new Response(content, { status, headers: { ...textHeaders, ...corsHeaders } });
        }

        if (req.method === "POST" && url.pathname === "/write") {
            let body: { path?: unknown; content?: unknown };
            try { body = await req.json(); } catch {
                return new Response("Invalid JSON", { status: 400, headers: { ...textHeaders, ...corsHeaders } });
            }
            const { path, content } = body;
            if (typeof path !== "string" || typeof content !== "string") {
                return new Response("Invalid request: path and content must be strings", { status: 400, headers: { ...textHeaders, ...corsHeaders } });
            }
            const { message, status } = await writeFile(path, content);
            return new Response(message, { status, headers: { ...textHeaders, ...corsHeaders } });
        }

        if (req.method === "GET" && url.pathname === "/list") {
            const root = url.searchParams.get("path") || ".";
            const tree = await listDir(root);
            return new Response(JSON.stringify(tree), {
                status: 200,
                headers: { "Content-Type": "application/json", ...corsHeaders },
            });
        }

        return new Response("Not found", { status: 404, headers: { ...textHeaders, ...corsHeaders } });
    } catch (e) {
        console.error("Unhandled server error:", e);
        return new Response("Internal server error", { status: 500, headers: textHeaders });
    }
}, { port: Number(Deno.env.get("DENO_PORT") || 8080) });
