import { defineWebSocketHandler } from "h3";
import * as pty from "node-pty";

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

            const cwd = typeof data.cwd === "string" && data.cwd ? data.cwd : process.env.HOME || "/home";
            const shell = process.env.SHELL || "bash";

            let term: pty.IPty;
            try {
                term = pty.spawn(shell, [], {
                    name: "xterm-256color",
                    cols: data.cols || 80,
                    rows: data.rows || 24,
                    cwd,
                    env: {
                        ...process.env,
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
