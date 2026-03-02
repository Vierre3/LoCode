import { defineWebSocketHandler } from "h3";
import * as pty from "node-pty";
import { existsSync } from "node:fs";

const ptys = new Map<string, pty.IPty>();
const WSL_PATH_RE = /^\\\\wsl[.$\\]/i;
const WSL_PARSE_RE = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(.*)$/i;

function getShellConfig(cwd: string, home: string) {
    const isWsl = process.platform === "win32" && WSL_PATH_RE.test(cwd);

    if (isWsl) {
        const m = cwd.match(WSL_PARSE_RE);
        return {
            shell: "wsl.exe",
            args: ["-d", m?.[1] || "", "--cd", m?.[2]?.replace(/\\/g, "/") || "/"],
            cwd: undefined as string | undefined,
        };
    }

    const safeCwd = existsSync(cwd) ? cwd : (existsSync(home) ? home : "/");

    if (process.platform === "win32") {
        return { shell: "powershell.exe", args: [] as string[], cwd: safeCwd };
    }

    const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
    return { shell, args: [] as string[], cwd: safeCwd };
}

function cleanupPty(peerId: string) {
    const term = ptys.get(peerId);
    if (term) {
        term.kill();
        ptys.delete(peerId);
    }
}

export default defineWebSocketHandler({
    open(_peer) {},

    message(peer, msg) {
        let data: any;
        try {
            data = JSON.parse(typeof msg === "string" ? msg : msg.text());
        } catch { return; }

        if (data.type === "create") {
            if (ptys.has(peer.id)) return;

            const home = process.env.HOME || (process.platform === "darwin" ? `/Users/${process.env.USER || ""}` : "/home");
            const cwd = typeof data.cwd === "string" && data.cwd ? data.cwd : home;
            const { shell, args, cwd: spawnCwd } = getShellConfig(cwd, home);

            // Ensure PATH includes standard dirs (macOS .app bundles have minimal PATH)
            const stdPath = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
            const envPath = process.env.PATH ? `${process.env.PATH}:${stdPath}` : stdPath;

            let term: pty.IPty;
            try {
                term = pty.spawn(shell, args, {
                    name: "xterm-256color",
                    cols: data.cols || 80,
                    rows: data.rows || 24,
                    cwd: spawnCwd,
                    env: {
                        ...process.env,
                        PATH: envPath,
                        HOME: home,
                        TERM: "xterm-256color",
                        COLORTERM: "truecolor",
                    } as Record<string, string>,
                });
            } catch (err: any) {
                try {
                    peer.send(JSON.stringify({ type: "output", data: `\r\n\x1b[31m[Terminal error: ${err.message}]\x1b[0m\r\n` }));
                } catch {}
                return;
            }

            ptys.set(peer.id, term);
            term.onData((output: string) => {
                try { peer.send(JSON.stringify({ type: "output", data: output })); } catch {}
            });
            term.onExit(({ exitCode }: { exitCode: number }) => {
                try { peer.send(JSON.stringify({ type: "exit", code: exitCode })); } catch {}
                ptys.delete(peer.id);
            });
        } else if (data.type === "input") {
            const term = ptys.get(peer.id);
            if (term && typeof data.data === "string") term.write(data.data);
        } else if (data.type === "resize") {
            const term = ptys.get(peer.id);
            if (term && typeof data.cols === "number" && typeof data.rows === "number") {
                term.resize(Math.max(1, data.cols), Math.max(1, data.rows));
            }
        }
    },

    close(peer) { cleanupPty(peer.id); },
    error(peer) { cleanupPty(peer.id); },
});
