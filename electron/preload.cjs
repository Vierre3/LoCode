"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronTerminal", {
    create: (opts) => ipcRenderer.invoke("term:create", opts),
    write: (id, data) => ipcRenderer.send("term:input", { id, data }),
    resize: (id, cols, rows) => ipcRenderer.send("term:resize", { id, cols, rows }),
    kill: (id) => ipcRenderer.send("term:kill", { id }),
    onData: (cb) => {
        const listener = (_e, payload) => cb(payload);
        ipcRenderer.on("term:data", listener);
        return () => ipcRenderer.removeListener("term:data", listener);
    },
    onExit: (cb) => {
        const listener = (_e, payload) => cb(payload);
        ipcRenderer.on("term:exit", listener);
        return () => ipcRenderer.removeListener("term:exit", listener);
    },
});
