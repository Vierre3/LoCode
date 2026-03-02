<template>
    <div class="flex h-screen gap-2 p-2 relative">
        <!-- Progress bar -->
        <Transition name="progress-fade">
            <div v-if="loadingPaneId" class="progress-bar">
                <div class="progress-fill"></div>
            </div>
        </Transition>

        <!-- Mobile hamburger toggle -->
        <button @click="sidebarOpen = !sidebarOpen" class="hamburger md:hidden">
            {{ sidebarOpen ? '✕' : '☰' }}
        </button>

        <!-- Mobile backdrop -->
        <div v-if="sidebarOpen" class="backdrop md:hidden" @click="sidebarOpen = false" />

        <!-- Sidebar -->
        <div class="sidebar" :class="{ open: sidebarOpen, 'no-transition': isResizing }" :style="sidebarStyle">
            <FileExplorer ref="fileExplorerRef"
                @select-file="onSelectFile" @select-root="onSelectRoot"
                @update:openFolders="onUpdateOpenFolders"
                :openFiles="panes.map(p => p.filePath).filter(Boolean)" :rootPath="rootPath"
                :initialOpenFolders="cfgOpenFolders" />
            <div v-if="!isMobile" class="resize-handle" @mousedown.prevent="startResize" />
        </div>

        <!-- Editor panel -->
        <div class="flex-1 flex flex-col gap-2 min-w-0" :class="{ 'pointer-events-none': isResizing }">
            <div class="header-bar">
                <div class="file-labels">
                    <div v-for="(pane, i) in panes" :key="pane.id"
                        class="file-label-slot" :style="paneLabelStyle(i)">
                        <span class="file-label"
                            :class="{ active: pane.id === activePaneId, dirty: isPaneDirty(pane) }"
                            @click="focusEditorPane(pane.id)" :title="pane.filePath">
                            {{ isPaneDirty(pane) ? '* ' : '' }}{{ displayPaneName(pane) }}
                            <button v-if="pane.filePath" class="close-pane-btn"
                                :class="{ active: pane.id === activePaneId }"
                                @click.stop="onClosePane(pane.id)"><span class="close-icon">&times;</span></button>
                        </span>
                    </div>
                </div>
                <div class="header-actions">
                    <button @click="saveActivePane" class="btn"
                        :class="{ 'btn-press': savePressing, 'btn-success': saveSuccess }"
                        :disabled="!activePane?.filePath">Save</button>
                    <button @click="showSettings = true" class="btn settings-btn"
                        :class="{ 'btn-remote': isRemote }"
                        title="Settings — remote backend">⚙</button>
                    <img src="/logo.svg" alt="LoCode" class="logo logo-btn" :class="{ active: terminalOpen }"
                        @click="terminalOpen ? closeTerminal() : openTerminal()" />
                </div>
            </div>
            <div class="flex-1 min-h-0 flex flex-col">
                <div class="flex-1 min-h-0">
                    <EditorArea ref="editorAreaRef" :panes="panes"
                        :activePaneId="activePaneId" :isMobile="isMobile"
                        :loadingPaneId="loadingPaneId" :initialSplitRatio="cfgSplitRatio"
                        @update:pane="onUpdatePane" @set-active="activePaneId = $event"
                        @drop="onEditorDrop" @close-pane="onClosePane"
                        @update:splitRatio="onUpdateSplitRatio" />
                </div>
                <TerminalPanel ref="terminalPanelRef" v-show="terminalOpen"
                    :rootPath="rootPath" :isMobile="isMobile" :initialTerminalHeight="cfgTerminalHeight"
                    @update:sessionCount="terminalSessionCount = $event"
                    @update:splitIndex="terminalSplitIndex = $event"
                    @update:activeSplitLeft="terminalActiveSplitLeft = $event"
                    @update:focusedIndex="terminalFocusedIndex = $event"
                    @update:savedPairs="terminalSavedPairs = $event"
                    @update:terminalHeight="onUpdateTerminalHeight"
                    @close="closeTerminal" />
            </div>
        </div>

        <UnsavedDialog :show="showUnsavedDialog" :fileName="unsavedFileName"
            @save="onDialogSave" @discard="onDialogDiscard" @cancel="showUnsavedDialog = false" />

        <SettingsModal :show="showSettings"
            @close="showSettings = false"
            @saved="isRemote = getMode() !== 'local'"
            @connected="onSSHConnected"
            @disconnected="onSSHDisconnected" />
    </div>
</template>

<style lang="css" scoped>
.hamburger {
    position: fixed;
    top: 5px;
    left: 8px;
    z-index: 60;
    width: 35px;
    height: 35px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.25rem;
    font-weight: bold;
    cursor: pointer;
    background-color: rgba(255, 255, 255, 0.15);
    backdrop-filter: blur(15px);
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.9);
    transition: .2s ease;
}

@media (min-width: 768px) {
    .hamburger {
        display: none !important;
    }
}

.backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(0, 0, 0, 0.4);
}

.sidebar {
    width: var(--sw, 250px);
    flex-shrink: 0;
    height: 100%;
    position: relative;
    transition: width .3s ease;
}

.sidebar.no-transition {
    transition: none;
}

.resize-handle {
    position: absolute;
    top: 0;
    right: -4px;
    width: 8px;
    height: 100%;
    cursor: col-resize;
    z-index: 10;
}

.resize-handle:hover {
    background: rgba(255, 255, 255, 0.08);
    border-radius: 4px;
}

/* Mobile: drawer slide-in */
@media (max-width: 767px) {
    .sidebar {
        position: fixed;
        left: 0;
        top: 0;
        height: 100%;
        width: 80vw;
        max-width: 300px;
        z-index: 50;
        padding: 52px 8px 8px 8px;
        border-radius: 0 22px 22px 0;
        transform: translateX(-100%);
        transition: transform .25s ease;
    }

    .sidebar.open {
        transform: translateX(0);
    }
}

@media (max-width: 767px) {
    .header-bar {
        padding-left: 48px;
    }

    .btn {
        font-size: 0.8rem;
        padding: 5px 10px;
    }
}

.btn {
    font-weight: bold;
    cursor: pointer;
    padding: 4px 8px;
    background-color: rgba(255, 255, 255, 0.12);
    backdrop-filter: blur(15px);
    box-shadow: 0px 0px 25px rgba(227, 228, 237, 0.37);
    border: 2px solid rgba(255, 255, 255, 0.12);
    border-radius: 5px;
    transform: translateZ(0);
    transition: transform .18s cubic-bezier(0.34, 1.56, 0.64, 1),
        background-color .15s ease, box-shadow .25s ease, border-color .15s ease;
    color: rgba(255, 255, 255, 0.9);
    white-space: nowrap;
}

.btn:hover:not(:disabled) {
    transform: translateZ(0) translateY(-2px);
    border-color: rgba(180, 210, 255, 0.45);
    box-shadow: 0 0 18px rgba(140, 190, 255, 0.35), 0 0 6px rgba(180, 210, 255, 0.2);
}

.btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    transform: none;
    pointer-events: auto;
}

.btn-press {
    transform: scale(0.92) !important;
    border-color: rgba(255, 255, 255, 0.5) !important;
}

.settings-btn {
    font-size: 1rem;
    padding: 4px 7px;
}

.btn-remote {
    border-color: rgba(100, 220, 100, 0.5) !important;
    color: rgba(100, 220, 100, 0.9) !important;
}

.logo {
    height: 40px;
    width: 40px;
    flex-shrink: 0;
    border-radius: 6px;
}

.logo-btn {
    cursor: pointer;
    transition: .2s ease;
}

.logo-btn:hover {
    transform: translateY(-2px);
}

.logo-btn.active {
    border-color: rgba(100, 180, 255, 0.5);
    box-shadow: 0 0 12px rgba(100, 180, 255, 0.2);
}

.header-bar {
    position: relative;
    display: flex;
    align-items: center;
}

.header-actions {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
}

.file-labels {
    display: flex;
    width: 100%;
    min-width: 0;
}

.file-label-slot {
    min-width: 0;
    padding: 2px 4px;
}

.file-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.75rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    transition: .15s ease;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
}

.file-label:hover {
    background: rgba(255, 255, 255, 0.2);
    border-color: rgba(255, 255, 255, 0.37);
}

.file-label.active {
    color: rgba(255, 255, 255, 0.9);
    font-weight: 700;
}

.file-label.dirty {
    font-style: italic;
}

.close-pane-btn {
    width: 16px;
    height: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.75);
    background: transparent;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    transition: .1s ease;
    line-height: 1;
    flex-shrink: 0;
}

.close-pane-btn:hover {
    color: rgba(255, 255, 255, 0.9);
    background: rgba(220, 100, 100, 0.9);
}

.close-icon {
    display: inline-block;
    transition: transform .3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.close-pane-btn:hover .close-icon {
    transform: rotate(90deg);
}

.close-pane-btn.active {
    color: rgba(255, 255, 255, 0.9);
    font-weight: 700;
}

/* --- Save success flash --- */
.btn-success {
    border-color: rgba(100, 200, 100, 0.6) !important;
    box-shadow: 0 0 12px rgba(100, 200, 100, 0.25) !important;
    transition: border-color 0.3s ease, box-shadow 0.6s ease !important;
}

/* --- Progress bar --- */
.progress-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    z-index: 200;
    overflow: hidden;
}

.progress-fill {
    height: 100%;
    background: linear-gradient(90deg, rgba(100, 180, 255, 0.8), rgba(100, 220, 180, 0.8));
    border-radius: 0 2px 2px 0;
    animation: progress-crawl 2.5s cubic-bezier(0.1, 0.05, 0.6, 1) forwards;
}

@keyframes progress-crawl {
    0%   { width: 0%; }
    30%  { width: 60%; }
    70%  { width: 78%; }
    100% { width: 85%; }
}

.progress-fade-leave-active .progress-fill {
    width: 100% !important;
    transition: width 0.1s ease;
}

.progress-fade-leave-active {
    transition: opacity 0.3s ease 0.1s;
}

.progress-fade-leave-to {
    opacity: 0;
}

</style>

<script setup lang="ts">
import type { EditorPane } from '~/components/EditorArea.vue';
import { useLocodeConfig } from '~/composables/useLocodeConfig';
import type { LocodeConfig } from '~/composables/useLocodeConfig';

const { loadConfig, saveConfig } = useLocodeConfig();
const { apiFetch, getMode } = useApi();

const showSettings = ref(false);
const isRemote = import.meta.client ? ref(getMode() !== "local") : ref(false);

// Electron IPC bridge for multi-window session tracking (injected by preload.cjs)
const electronSession = import.meta.client
    ? (window as any).electronSession as { getInitialRoot: () => string; setRoot: (path: string) => void } | undefined
    : undefined;

// --- Config state (loaded from .LoCode) ---
const cfgOpenFolders = ref<string[]>([]);
const cfgSplitRatio = ref(50);
const cfgTerminalHeight = ref(261);

const rootPath = ref(
    import.meta.client
        ? (electronSession
            ? electronSession.getInitialRoot()   // Electron: session system is authoritative
            : localStorage.getItem("locode:rootPath") || "")  // Web: use localStorage
        : ""
);
const sidebarOpen = ref(false);
const sidebarWidth = ref(250);
const isResizing = ref(false);
const savePressing = ref(false);
const saveSuccess = ref(false);
const loadingPaneId = ref<string | null>(null);
const isMobile = ref(false);
const terminalOpen = ref(false);
const terminalSessionCount = ref(1);
const terminalSplitIndex = ref(-1);
const terminalActiveSplitLeft = ref(0);
const terminalFocusedIndex = ref(0);
const terminalSavedPairs = ref<[number, number][]>([]);
const terminalPanelRef = ref<{ resetSessions: (count: number, splitIndex: number, savedPairsData?: [number, number][], activeSplitLeftIdx?: number, focusedIdx?: number) => void; ensureSession: () => void; focusActive: () => void } | null>(null);

// --- Persist workspace state to .LoCode ---
function saveWorkspaceConfig() {
    if (!rootPath.value) return;
    saveConfig(rootPath.value, {
        paneFiles: panes.value.map(p => p.filePath),
        activePaneIndex: panes.value.findIndex(p => p.id === activePaneId.value),
        terminalOpen: terminalOpen.value,
        terminalCount: terminalSessionCount.value,
        terminalSplitIndex: terminalSplitIndex.value,
        terminalActiveSplitLeft: terminalActiveSplitLeft.value,
        terminalFocusedIndex: terminalFocusedIndex.value,
        terminalSavedPairs: terminalSavedPairs.value,
    });
}

watch(terminalSessionCount, () => saveWorkspaceConfig());
watch(terminalSplitIndex, () => saveWorkspaceConfig());
watch(terminalActiveSplitLeft, () => saveWorkspaceConfig());
watch(terminalFocusedIndex, () => saveWorkspaceConfig());
watch(terminalSavedPairs, () => saveWorkspaceConfig());

// --- Config update handlers (from child emits) ---
function onUpdateOpenFolders(folders: string[]) {
    cfgOpenFolders.value = folders;
    saveConfig(rootPath.value, { openFolders: folders });
}

function onUpdateSplitRatio(ratio: number) {
    cfgSplitRatio.value = ratio;
    saveConfig(rootPath.value, { splitRatio: ratio });
}

function onUpdateTerminalHeight(height: number) {
    cfgTerminalHeight.value = height;
    saveConfig(rootPath.value, { terminalHeight: height });
}

function openTerminal() {
    terminalOpen.value = true;
    saveWorkspaceConfig();
    nextTick(() => {
        terminalPanelRef.value?.ensureSession();
        nextTick(() => terminalPanelRef.value?.focusActive());
    });
}

function closeTerminal() {
    terminalOpen.value = false;
    saveWorkspaceConfig();
    nextTick(() => editorAreaRef.value?.focusPane(activePaneId.value));
}

// --- SSH connect/disconnect ---
const fileExplorerRef = ref<{ showBrowse: () => void } | null>(null);

function resetToFolderSelector() {
    saveWorkspaceConfig();
    const wasEmpty = rootPath.value === "";
    rootPath.value = "";
    localStorage.removeItem("locode:rootPath");
    electronSession?.setRoot("");
    panes.value = [{ id: "main", filePath: "", code: "", savedCode: "", language: "" }];
    activePaneId.value = "main";
    lastMtime.clear();
    if (terminalOpen.value) closeTerminal();
    // If rootPath was already empty, the watcher won't fire — trigger browse manually
    if (wasEmpty) {
        fileExplorerRef.value?.showBrowse();
    }
}

function onSSHConnected() {
    resetToFolderSelector();
}

function onSSHDisconnected() {
    resetToFolderSelector();
}

const editorAreaRef = ref<{ splitRatio: number; focusPane: (id: string) => void } | null>(null);

function focusEditorPane(paneId: string) {
    activePaneId.value = paneId;
    editorAreaRef.value?.focusPane(paneId);
}

// --- Pane state ---
const panes = ref<EditorPane[]>([
    { id: "main", filePath: "", code: "", savedCode: "", language: "" }
]);
const activePaneId = ref("main");

const activePane = computed(() => panes.value.find(p => p.id === activePaneId.value));

// --- Unsaved dialog ---
const showUnsavedDialog = ref(false);
const unsavedFileName = computed(() => {
    const p = activePane.value;
    if (!p) return "";
    return p.filePath.split("/").pop() || p.filePath;
});

type PendingAction =
    | { type: "select"; path: string }
    | { type: "drop"; zone: "left" | "center" | "right"; path: string }
    | { type: "close"; paneId: string };
let pendingAction: PendingAction | null = null;

const sidebarStyle = computed(() => {
    if (isMobile.value) return {};
    return { "--sw": sidebarWidth.value + "px" };
});

// --- Sidebar resize ---
function startResize(e: MouseEvent) {
    isResizing.value = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMouseMove = (ev: MouseEvent) => {
        sidebarWidth.value = Math.max(150, Math.min(500, ev.clientX - 8));
    };
    const cleanup = () => {
        isResizing.value = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        saveConfig(rootPath.value, { sidebarWidth: sidebarWidth.value });
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", cleanup);
        resizeCleanup = null;
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", cleanup);
    resizeCleanup = cleanup;
}

let mq: MediaQueryList;
let resizeCleanup: (() => void) | null = null;

function onMediaChange(e: MediaQueryListEvent) {
    isMobile.value = e.matches;
    sidebarOpen.value = !e.matches;
}

onMounted(async () => {
    mq = window.matchMedia("(max-width: 767px)");
    isMobile.value = mq.matches;
    sidebarOpen.value = !mq.matches;
    mq.addEventListener("change", onMediaChange);
    window.addEventListener("keydown", onKeyDown);

    // Purge legacy localStorage keys (migration from pre-.LoCode storage)
    const legacyPrefixes = ["locode:workspace:", "locode:openFolders:", "locode:skeleton:"];
    Object.keys(localStorage)
        .filter(k => legacyPrefixes.some(p => k.startsWith(p)))
        .forEach(k => localStorage.removeItem(k));
    ["locode:sidebarWidth", "locode:splitRatio", "locode:terminalHeight", "locode:currentFile"].forEach(k => localStorage.removeItem(k));

    if (rootPath.value) {
        // Sync rootPath to Electron session tracking (covers localStorage-restored roots)
        electronSession?.setRoot(rootPath.value);
        const config = await loadConfig(rootPath.value);
        sidebarWidth.value = config.sidebarWidth;
        cfgOpenFolders.value = config.openFolders;
        cfgSplitRatio.value = config.splitRatio;
        cfgTerminalHeight.value = config.terminalHeight;
        await restoreWorkspace(rootPath.value, config);
    }
    startReloadPolling();
});

onBeforeUnmount(() => {
    if (reloadInterval) { clearInterval(reloadInterval); reloadInterval = null; }
    mq?.removeEventListener("change", onMediaChange);
    resizeCleanup?.();
    window.removeEventListener("keydown", onKeyDown);
    saveWorkspaceConfig();
});

function onKeyDown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "r") {
        e.preventDefault();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (!activePane.value?.filePath) return;
        savePressing.value = true;
        saveActivePane();
        setTimeout(() => savePressing.value = false, 200);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "j") {
        e.preventDefault();
        if (terminalOpen.value) {
            closeTerminal();
        } else {
            openTerminal();
        }
    }
}

// --- Display helpers ---
function displayPaneName(pane: EditorPane): string {
    if (!pane.filePath) return "Untitled";
    if (rootPath.value && pane.filePath.startsWith(rootPath.value)) {
        return pane.filePath.slice(rootPath.value.length + 1);
    }
    return pane.filePath.split("/").pop() || pane.filePath;
}

function paneLabelStyle(index: number) {
    if (panes.value.length === 1) return { flex: "1 1 0%" };
    const ratio = editorAreaRef.value?.splitRatio ?? 50;
    return index === 0
        ? { width: ratio + "%", flexShrink: 0 }
        : { flex: "1 1 0%" };
}

// --- Pane helpers ---
const userEdited = new Set<string>();

function isPaneDirty(pane: EditorPane): boolean {
    return pane.filePath !== "" && pane.code !== pane.savedCode;
}

function onUpdatePane(paneId: string, field: string, value: string) {
    const pane = panes.value.find(p => p.id === paneId);
    if (!pane) return;
    (pane as any)[field] = value;
    // When Monaco normalizes content (e.g. line endings), sync savedCode
    if (field === "code" && pane.code === value && pane.savedCode !== value && !userEdited.has(paneId)) {
        pane.savedCode = value;
    }
    if (field === "code") userEdited.add(paneId);
}

// --- Workspace helpers ---
async function restoreWorkspace(_path: string, config: LocodeConfig) {
    terminalOpen.value = config.terminalOpen;
    terminalSessionCount.value = Math.max(1, config.terminalCount || 1);
    terminalSplitIndex.value = config.terminalSplitIndex ?? -1;
    terminalActiveSplitLeft.value = config.terminalActiveSplitLeft ?? 0;
    terminalFocusedIndex.value = config.terminalFocusedIndex ?? 0;
    terminalSavedPairs.value = config.terminalSavedPairs ?? [];
    terminalPanelRef.value?.resetSessions(terminalSessionCount.value, terminalSplitIndex.value, terminalSavedPairs.value, terminalActiveSplitLeft.value, terminalFocusedIndex.value);

    const files = config.paneFiles || [];
    if (files.length === 2 && files[0] && files[1]) {
        panes.value = [
            { id: "left", filePath: "", code: "", savedCode: "", language: "" },
            { id: "right", filePath: "", code: "", savedCode: "", language: "" },
        ];
        activePaneId.value = config.activePaneIndex === 1 ? "right" : "left";
        await Promise.all([
            loadFileIntoPane("left", files[0]),
            loadFileIntoPane("right", files[1]),
        ]);
    } else if (files.length >= 1 && files[0]) {
        panes.value = [{ id: "main", filePath: "", code: "", savedCode: "", language: "" }];
        activePaneId.value = "main";
        await loadFileIntoPane("main", files[0]);
    } else {
        panes.value = [{ id: "main", filePath: "", code: "", savedCode: "", language: "" }];
        activePaneId.value = "main";
        terminalPanelRef.value?.resetSessions(1, -1);
    }
}

// --- File selection ---
async function onSelectRoot(path: string) {
    saveWorkspaceConfig();
    const config = await loadConfig(path);
    sidebarWidth.value = config.sidebarWidth;
    cfgOpenFolders.value = config.openFolders;
    cfgSplitRatio.value = config.splitRatio;
    cfgTerminalHeight.value = config.terminalHeight;
    rootPath.value = path;
    localStorage.setItem("locode:rootPath", path);
    electronSession?.setRoot(path);
    restoreWorkspace(path, config);
}

function onSelectFile(path: string) {
    if (isMobile.value) sidebarOpen.value = false;
    const p = activePane.value;
    // if (p && p.filePath === path) return;
    if (p && isPaneDirty(p)) {
        pendingAction = { type: "select", path };
        showUnsavedDialog.value = true;
        return;
    }
    loadFileIntoPane(activePaneId.value, path);
}

// --- Drop handling ---
function onEditorDrop(zone: "left" | "center" | "right", filePath: string, force = false) {
    if (zone === "center") {
        // With 2 panes, center drop collapses to single pane
        if (panes.value.length === 2) {
            if (!force && panes.value.some(p => isPaneDirty(p))) {
                pendingAction = { type: "drop", zone, path: filePath };
                showUnsavedDialog.value = true;
                return;
            }
            panes.value = [{ id: "main", filePath: "", code: "", savedCode: "", language: "" }];
            activePaneId.value = "main";
            loadFileIntoPane("main", filePath);
        } else {
            const p = activePane.value;
            if (!force && p && isPaneDirty(p)) {
                pendingAction = { type: "drop", zone, path: filePath };
                showUnsavedDialog.value = true;
                return;
            }
            loadFileIntoPane(activePaneId.value, filePath);
        }
    } else if (zone === "left") {
        if (panes.value.length === 1) {
            const existing = panes.value[0]!;
            existing.id = "right";
            const newPane: EditorPane = { id: "left", filePath: "", code: "", savedCode: "", language: "" };
            panes.value = [newPane, existing];
            activePaneId.value = "left";
            loadFileIntoPane("left", filePath);
        } else {
            const left = panes.value[0]!;
            if (!force && isPaneDirty(left)) {
                pendingAction = { type: "drop", zone, path: filePath };
                activePaneId.value = "left";
                showUnsavedDialog.value = true;
                return;
            }
            loadFileIntoPane("left", filePath);
            activePaneId.value = "left";
        }
    } else {
        if (panes.value.length === 1) {
            const newPane: EditorPane = { id: "right", filePath: "", code: "", savedCode: "", language: "" };
            panes.value.push(newPane);
            activePaneId.value = "right";
            loadFileIntoPane("right", filePath);
        } else {
            const right = panes.value[1]!;
            if (!force && isPaneDirty(right)) {
                pendingAction = { type: "drop", zone, path: filePath };
                activePaneId.value = "right";
                showUnsavedDialog.value = true;
                return;
            }
            loadFileIntoPane("right", filePath);
            activePaneId.value = "right";
        }
    }
}

function onClosePane(paneId: string) {
    const pane = panes.value.find(p => p.id === paneId);
    if (!pane) return;
    if (isPaneDirty(pane)) {
        activePaneId.value = paneId;
        pendingAction = { type: "close", paneId };
        showUnsavedDialog.value = true;
        return;
    }
    doClosePane(paneId);
}

function doClosePane(paneId: string) {
    lastMtime.delete(paneId);
    if (panes.value.length > 1) {
        const remaining = panes.value.find(p => p.id !== paneId)!;
        const oldMt = lastMtime.get(remaining.id);
        lastMtime.delete(remaining.id);
        remaining.id = "main";
        if (oldMt) lastMtime.set("main", oldMt);
        panes.value = [remaining];
        activePaneId.value = "main";
    } else {
        // Last pane: clear it
        const pane = panes.value[0]!;
        userEdited.delete(pane.id);
        lastMtime.delete(pane.id);
        pane.filePath = "";
        pane.code = "";
        pane.savedCode = "";
        pane.language = "";
    }
    saveWorkspaceConfig();
}

// --- Dialog handlers ---
async function onDialogSave() {
    showUnsavedDialog.value = false;
    await savePaneFile(activePaneId.value);
    executePendingAction();
}

function onDialogDiscard() {
    showUnsavedDialog.value = false;
    executePendingAction();
}

function executePendingAction() {
    if (!pendingAction) return;
    const action = pendingAction;
    pendingAction = null;

    if (action.type === "select") {
        loadFileIntoPane(activePaneId.value, action.path);
    } else if (action.type === "drop") {
        onEditorDrop(action.zone, action.path, true);
    } else if (action.type === "close") {
        doClosePane(action.paneId);
    }
}

// --- File auto-reload (mtime polling) ---
const lastMtime = new Map<string, number>();

async function fetchMtime(path: string): Promise<number | null> {
    try {
        const res = await apiFetch("/stat?path=" + encodeURIComponent(path));
        if (!res.ok) return null;
        const data = await res.json();
        return data.mtime ?? null;
    } catch { return null; }
}

let reloadInterval: ReturnType<typeof setInterval> | null = null;

function startReloadPolling() {
    if (reloadInterval) return;
    reloadInterval = setInterval(async () => {
        for (const pane of panes.value) {
            if (!pane.filePath) continue;
            const mtime = await fetchMtime(pane.filePath);
            if (mtime === null) continue;
            const prev = lastMtime.get(pane.id);
            if (prev && mtime > prev && pane.code === pane.savedCode) {
                // File changed on disk and no unsaved edits — reload
                try {
                    const res = await apiFetch("/read?path=" + encodeURIComponent(pane.filePath));
                    if (res.ok) {
                        const text = await res.text();
                        userEdited.delete(pane.id);
                        pane.code = text;
                        pane.savedCode = text;
                        lastMtime.set(pane.id, mtime);
                    }
                } catch {}
            } else if (!prev || mtime > prev) {
                lastMtime.set(pane.id, mtime);
            }
        }
    }, 2000);
}

// --- File I/O ---
async function loadFileIntoPane(paneId: string, path: string) {
    const pane = panes.value.find(p => p.id === paneId);
    if (!pane) return;

    userEdited.delete(paneId);
    pane.filePath = path;
    pane.language = detectLanguage(path);
    loadingPaneId.value = paneId;

    try {
        const res = await apiFetch("/read?path=" + encodeURIComponent(path));
        if (!res.ok) {
            pane.code = `Error: ${res.statusText || "unable to read file"}`;
            pane.savedCode = pane.code;
            pane.language = "plaintext";
            return;
        }
        const text = await res.text();
        pane.code = text;
        pane.savedCode = text;
    } catch {
        pane.code = "Network error: unable to load file";
        pane.savedCode = pane.code;
        pane.language = "plaintext";
    } finally {
        loadingPaneId.value = null;
    }
    fetchMtime(path).then(mt => { if (mt !== null) lastMtime.set(paneId, mt); });
    saveWorkspaceConfig();
}

let isSaving = false;

async function savePaneFile(paneId: string) {
    const pane = panes.value.find(p => p.id === paneId);
    if (!pane || !pane.filePath || isSaving) return;
    isSaving = true;
    try {
        const res = await apiFetch("/write", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: pane.filePath, content: pane.code }),
        });
        if (!res.ok) {
            console.error("Save failed:", await res.text());
        } else {
            pane.savedCode = pane.code;
            fetchMtime(pane.filePath).then(mt => { if (mt !== null) lastMtime.set(paneId, mt); });
        }
    } catch {
        console.error("Network error: unable to save file");
    } finally {
        isSaving = false;
    }
}

async function saveActivePane() {
    await savePaneFile(activePaneId.value);
    saveSuccess.value = true;
    setTimeout(() => saveSuccess.value = false, 600);
}

// --- Language detection ---
const langMap: Record<string, string> = {
    js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
    ts: "typescript", tsx: "typescript", mts: "typescript",
    vue: "html", svelte: "html", html: "html", htm: "html",
    css: "css", scss: "scss", less: "less",
    json: "json", jsonc: "json",
    md: "markdown", mdx: "markdown",
    py: "python", pyw: "python",
    rs: "rust",
    go: "go",
    c: "c", h: "c",
    cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hxx: "cpp",
    cs: "csharp",
    java: "java",
    kt: "kotlin", kts: "kotlin",
    swift: "swift",
    rb: "ruby",
    php: "php",
    lua: "lua",
    r: "r", R: "r",
    hs: "haskell",
    scala: "scala",
    dart: "dart",
    pl: "perl", pm: "perl",
    sh: "shell", bash: "shell", zsh: "shell",
    ps1: "powershell",
    sql: "sql",
    xml: "xml", xsl: "xml", xsd: "xml", svg: "xml",
    yaml: "yaml", yml: "yaml",
    toml: "toml",
    ini: "ini", conf: "ini",
    dockerfile: "dockerfile",
    graphql: "graphql", gql: "graphql",
    proto: "protobuf",
    zig: "zig",
    ex: "elixir", exs: "elixir",
    erl: "erlang",
    clj: "clojure", cljs: "clojure",
    ml: "ocaml", mli: "ocaml",
    fs: "fsharp", fsx: "fsharp",
    tf: "hcl",
    sol: "solidity",
};

function detectLanguage(path: string): string {
    const ext = path.split(".").pop() || "";
    return langMap[ext] || "plaintext";
}
</script>
