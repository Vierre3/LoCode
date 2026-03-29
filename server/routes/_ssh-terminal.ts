import { defineWebSocketHandler } from "h3";
import type { Client } from "ssh2";

// Each terminal gets its own dedicated SSH connection + shell channel
const terminalConns = new Map<string, { conn: Client; stream: any; sessionId: string }>();

// Clean up terminals for a specific SSH session (when that session's connection drops)
export function cleanupSessionChannels(sessionId: string) {
    for (const [id, entry] of terminalConns) {
        if (entry.sessionId === sessionId) {
            try { entry.stream.close(); } catch {}
            try { entry.conn.end(); } catch {}
            terminalConns.delete(id);
        }
    }
}

// Clean up ALL terminals (server shutdown)
export function cleanupAllChannels() {
    for (const [id, { conn, stream }] of terminalConns) {
        try { stream.close(); } catch {}
        try { conn.end(); } catch {}
    }
    terminalConns.clear();
}

export default defineWebSocketHandler({
    open(_peer) {
        // Wait for "create" message before opening shell
    },

    message(peer, msg) {
        let data: any;
        try {
            data = JSON.parse(typeof msg === "string" ? msg : msg.text());
        } catch {
            return;
        }

        if (data.type === "create") {
            if (terminalConns.has(peer.id)) return;

            const sessionId = data.sessionId;
            if (!sessionId || !isSSHConnected(sessionId)) {
                try {
                    peer.send(JSON.stringify({ type: "output", data: "\r\n\x1b[31m[SSH not connected]\x1b[0m\r\n" }));
                } catch {}
                return;
            }

            const cols = data.cols || 80;
            const rows = data.rows || 24;

            // Create a dedicated SSH connection for this terminal
            createTerminalConnection(sessionId)
                .then((conn) => {
                    conn.shell(
                        {
                            term: "xterm-256color",
                            cols,
                            rows,
                        },
                        (err: Error | undefined, stream: any) => {
                            if (err) {
                                try {
                                    peer.send(JSON.stringify({ type: "output", data: `\r\n\x1b[31m[SSH shell error: ${err.message}]\x1b[0m\r\n` }));
                                } catch {}
                                try { conn.end(); } catch {}
                                return;
                            }

                            terminalConns.set(peer.id, { conn, stream, sessionId });

                            // Mute output until clear has finished (hides MOTD/banners and cd command)
                            // Use broad regex to catch all erase-screen sequences:
                            // \x1b[J, \x1b[0J, \x1b[1J, \x1b[2J, \x1b[3J (busybox uses \x1b[J)
                            let muted = true;
                            const eraseScreenRe = /\x1b\[\d*J/;

                            stream.on("data", (chunk: Buffer) => {
                                const str = chunk.toString();
                                if (muted) {
                                    if (eraseScreenRe.test(str)) {
                                        muted = false;
                                        // Fall through — send this chunk (contains the clear + anything after)
                                    } else {
                                        return;
                                    }
                                }
                                try {
                                    peer.send(JSON.stringify({ type: "output", data: str }));
                                } catch {
                                    // Peer disconnected
                                }
                            });

                            stream.on("close", () => {
                                try {
                                    peer.send(JSON.stringify({ type: "exit", code: 0 }));
                                } catch {
                                    // Peer disconnected
                                }
                                try { conn.end(); } catch {}
                                terminalConns.delete(peer.id);
                            });

                            // Set initial cwd if provided, then clear to hide MOTD/banners
                            if (data.cwd) {
                                stream.write(`cd ${JSON.stringify(data.cwd)} && clear\n`);
                            } else {
                                stream.write(`clear\n`);
                            }
                        },
                    );
                })
                .catch((err) => {
                    try {
                        peer.send(JSON.stringify({ type: "output", data: `\r\n\x1b[31m[SSH connection error: ${err.message}]\x1b[0m\r\n` }));
                    } catch {}
                });
        } else if (data.type === "input") {
            const entry = terminalConns.get(peer.id);
            if (entry && typeof data.data === "string") {
                entry.stream.write(data.data);
            }
        } else if (data.type === "resize") {
            const entry = terminalConns.get(peer.id);
            if (entry && typeof data.cols === "number" && typeof data.rows === "number") {
                entry.stream.setWindow(data.rows, data.cols, data.rows * 16, data.cols * 8);
            }
        }
    },

    close(peer) {
        const entry = terminalConns.get(peer.id);
        if (entry) {
            try { entry.stream.close(); } catch {}
            try { entry.conn.end(); } catch {}
            terminalConns.delete(peer.id);
        }
    },

    error(peer) {
        const entry = terminalConns.get(peer.id);
        if (entry) {
            try { entry.stream.close(); } catch {}
            try { entry.conn.end(); } catch {}
            terminalConns.delete(peer.id);
        }
    },
});
