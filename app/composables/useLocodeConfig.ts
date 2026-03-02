export interface LocodeConfig {
    sidebarWidth: number
    splitRatio: number
    terminalHeight: number
    openFolders: string[]
    paneFiles: string[]
    activePaneIndex: number
    terminalOpen: boolean
    terminalCount: number
    terminalSplitIndex: number
    terminalActiveSplitLeft: number
    terminalFocusedIndex: number
    terminalSavedPairs: [number, number][]
}

const DEFAULTS: LocodeConfig = {
    sidebarWidth: 250,
    splitRatio: 50,
    terminalHeight: 261,
    openFolders: [],
    paneFiles: [],
    activePaneIndex: 0,
    terminalOpen: false,
    terminalCount: 1,
    terminalSplitIndex: -1,
    terminalActiveSplitLeft: 0,
    terminalFocusedIndex: 0,
    terminalSavedPairs: [],
}

// Module-level cache: rootPath → config (stays consistent across concurrent saves)
const configCache = new Map<string, LocodeConfig>()

export function useLocodeConfig() {
    const { apiFetch } = useApi()

    function configPath(rootPath: string) {
        return rootPath + "/.LoCode"
    }

    async function loadConfig(rootPath: string): Promise<LocodeConfig> {
        const cached = configCache.get(rootPath)
        if (cached) return cached

        let config = { ...DEFAULTS }
        try {
            const res = await apiFetch("/read?path=" + encodeURIComponent(configPath(rootPath)))
            if (res.ok) {
                const parsed = JSON.parse(await res.text())
                config = { ...DEFAULTS, ...parsed }
            }
        } catch {}
        configCache.set(rootPath, config)
        return config
    }

    async function saveConfig(rootPath: string, updates: Partial<LocodeConfig>): Promise<void> {
        if (!rootPath) return
        const existing = configCache.get(rootPath) ?? { ...DEFAULTS }
        const merged: LocodeConfig = { ...existing, ...updates }
        // Update cache synchronously so concurrent calls see the latest state
        configCache.set(rootPath, merged)
        try {
            await apiFetch("/write", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    path: configPath(rootPath),
                    content: JSON.stringify(merged, null, 2),
                }),
            })
        } catch (e) {
            console.error("Failed to save .LoCode:", e)
        }
    }

    return { loadConfig, saveConfig }
}
