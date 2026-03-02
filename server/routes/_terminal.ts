import { defineWebSocketHandler } from "h3";
import * as pty from "node-pty";
import { existsSync } from "node:fs";

const ptys = new Map<string, pty.IPty>();

export default defineWebSocketHandler({
    open(peer) {
        // Wait for "create" message before spawning PTY
    },

    message(peer, msg) {
        let data: any;
        try {
            data = JSON.parse(typeof msg === "string" ? msg : msg.text());
        } catch {
            return;
        }

        if (data.type === "create") {
            // Don't create duplicate PTY for same peer
            if (ptys.has(peer.id)) return;

            const home = process.env.HOME || (process.platform === "darwin" ? `/Users/${process.env.USER || ""}` : "/home");
            let cwd = typeof data.cwd === "string" && data.cwd ? data.cwd : home;

            // Detect WSL paths BEFORE existsSync (Node on Windows can't stat \\wsl.localhost\...)
            const isWslPath = process.platform === "win32" && /^\\\\wsl[.$\\]/i.test(cwd);

            // Fallback to home or / if cwd doesn't exist (skip for WSL paths)
            if (!isWslPath && !existsSync(cwd)) cwd = existsSync(home) ? home : "/";

            let shell: string;
            let shellArgs: string[] = [];
            if (isWslPath) {
                const m = cwd.match(/^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(.*)$/i);
                const distro = m?.[1] || "";
                const linuxPath = m?.[2]?.replace(/\\/g, "/") || "/";
                shell = "wsl.exe";
                shellArgs = ["-d", distro, "--cd", linuxPath];
            } else if (process.platform === "win32") {
                shell = "powershell.exe";
            } else {
                shell = process.env.SHELL
                    || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
            }

            // Ensure PATH includes standard dirs (macOS .app bundles have minimal PATH)
            const stdPath = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
            const envPath = process.env.PATH ? `${process.env.PATH}:${stdPath}` : stdPath;

            let term: pty.IPty;
            try {
                term = pty.spawn(shell, shellArgs, {
                    name: "xterm-256color",
                    cols: data.cols || 80,
                    rows: data.rows || 24,
                    cwd: isWslPath ? undefined : cwd,
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
                    peer.send(JSON.stringify({ type: "output", data: `\r\n\x1b[31m[Terminal error: ${err.message}]\x1b[0m\r\n\x1b[90mshell=${shell}  cwd=${cwd}  platform=${process.platform}\x1b[0m\r\n` }));
                } catch {}
                return;
            }

            ptys.set(peer.id, term);

            term.onData((output: string) => {
                try {
                    peer.send(JSON.stringify({ type: "output", data: output }));
                } catch {
                    // Peer disconnected
                }
            });

            term.onExit(({ exitCode }: { exitCode: number }) => {
                try {
                    peer.send(JSON.stringify({ type: "exit", code: exitCode }));
                } catch {
                    // Peer disconnected
                }
                ptys.delete(peer.id);
            });
        } else if (data.type === "input") {
            const term = ptys.get(peer.id);
            if (term && typeof data.data === "string") {
                term.write(data.data);
            }
        } else if (data.type === "resize") {
            const term = ptys.get(peer.id);
            if (term && typeof data.cols === "number" && typeof data.rows === "number") {
                term.resize(Math.max(1, data.cols), Math.max(1, data.rows));
            }
        }
    },

    close(peer) {
        const term = ptys.get(peer.id);
        if (term) {
            term.kill();
            ptys.delete(peer.id);
        }
    },

    error(peer) {
        const term = ptys.get(peer.id);
        if (term) {
            term.kill();
            ptys.delete(peer.id);
        }
    },
});
