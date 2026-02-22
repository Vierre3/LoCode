// server.ts
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

type FileEntry = {
    name: string;
    path: string;
    type: "file" | "dir";
};

// const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const textHeaders = { "Content-Type": "text/plain; charset=utf-8" };

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

serve(async (req) => {
    try {
        const url = new URL(req.url);

        if (req.method === "GET" && url.pathname === "/read") {
            const path = url.searchParams.get("path");
            if (!path) return new Response("Missing path parameter", { status: 400, headers: textHeaders });
            const { content, status } = await readFile(path);
            return new Response(content, { status, headers: textHeaders });
        }

        if (req.method === "POST" && url.pathname === "/write") {
            let body: any;
            try { body = await req.json(); } catch {
                return new Response("Invalid JSON", { status: 400, headers: textHeaders });
            }
            const { path, content } = body;
            if (typeof path !== "string" || typeof content !== "string") {
                return new Response("Invalid request: path and content must be strings", { status: 400, headers: textHeaders });
            }
            const { message, status } = await writeFile(path, content);
            return new Response(message, { status, headers: textHeaders });
        }

        if (req.method === "GET" && url.pathname === "/list") {
            const root = url.searchParams.get("path") || ".";
            const tree = await listDir(root);
            return new Response(JSON.stringify(tree), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }

        return new Response("Not found", { status: 404, headers: textHeaders });
    } catch (e) {
        console.error("Unhandled server error:", e);
        return new Response("Internal server error", { status: 500, headers: textHeaders });
    }
}, { port: Deno.env.get("DENO_PORT")! });
