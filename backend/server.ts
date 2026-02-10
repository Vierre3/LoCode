// server.ts
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

type FileEntry = {
    name: string;
    path: string;
    type: "file" | "dir";
    // children?: FileEntry[];
};

async function readFile(path: string) {
    try {
        return await Deno.readTextFile(path);
    } catch (e) {
        return `Error reading file: ${e.message}`;
    }
}

async function writeFile(path: string, content: string) {
    try {
        await Deno.writeTextFile(path, content);
        return "File saved!";
    } catch (e) {
        return `Error writing file: ${e.message}`;
    }
}

async function listDir(path: string): Promise<FileEntry[]> {
    const result: FileEntry[] = [];
    for await (const entry of Deno.readDir(path)) {
        const fullPath = `${path}/${entry.name}`;
        if (entry.isDirectory) {
            result.push({
                name: entry.name,
                path: fullPath,
                type: "dir",
                // children: await listDir(fullPath),
            });
        } else {
            result.push({
                name: entry.name,
                path: fullPath,
                type: "file",
            });
        }
    }
    return result;
}

// Preload root directory at startup
let cachedRoot: FileEntry[] = listDir(".");

serve(async (req) => {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/read") {
        const path = url.searchParams.get("path")!;
        const contents = await readFile(path);
        return new Response(contents, {
            status: 200
        });
    }

    if (req.method === "POST" && url.pathname === "/write") {
        const { path, content } = await req.json();
        const result = await writeFile(path, content);
        return new Response(result, {
            status: 200
        });
    }

    if (req.method === "GET" && url.pathname === "/list") {
        const root = url.searchParams.get("path") || ".";
        const tree = await (root === "." ? cachedRoot : listDir(root));
        return new Response(JSON.stringify(tree), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }

    return new Response("Not found", { status: 404 });
}, { port: Deno.env.get("DENO_PORT")! });
