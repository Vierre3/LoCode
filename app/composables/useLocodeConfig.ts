export type SkeletonNode = { depth: number; type: string; width: number }

export interface LocodeConfig {
    sidebarWidth: number
    splitRatio: number
    terminalHeight: number
    openFolders: string[]
    skeleton: SkeletonNode[]
    paneFiles: string[]
    activePaneIndex: number
    terminalOpen: boolean
    terminalCount: number
    terminalSplitIndex: number
    terminalActiveSplitLeft: number
    terminalFocusedIndex: number
    terminalSavedPairs: [number, number][]
}

export const DEFAULT_SKELETON: SkeletonNode[] = [
    { depth: 0, type: "dir", width: 55 },
    { depth: 1, type: "file", width: 45 },
    { depth: 1, type: "file", width: 50 },
    { depth: 0, type: "dir", width: 60 },
    { depth: 0, type: "file", width: 40 },
]

const DEFAULTS: LocodeConfig = {
    sidebarWidth: 250,
    splitRatio: 50,
    terminalHeight: 261,
    openFolders: [],
    skeleton: DEFAULT_SKELETON,
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
    function configPath(rootPath: string) {
        return rootPath + "/.LoCode"
    }

    async function loadConfig(rootPath: string): Promise<LocodeConfig> {
        try {
            const res = await fetch("/api/read?path=" + encodeURIComponent(configPath(rootPath)))
            if (res.ok) {
                const text = await res.text()
                const parsed = JSON.parse(text)
                const config: LocodeConfig = { ...DEFAULTS, ...parsed }
                configCache.set(rootPath, config)
                return config
            }
        } catch {}
        const config = { ...DEFAULTS }
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
            await fetch("/api/write", {
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
