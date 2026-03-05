<template>
    <div class="h-full navbar flex flex-col">
        <button class="browse-btn" @click="toggleBrowse">
            {{ browsing ? 'Select Folder' : 'Open Folder' }}
        </button>
        <div class="overflow-y-auto overflow-x-hidden flex-1 p-1">
            <FileTree v-if="tree.length" :nodes="tree" :openFiles="openFiles" :folder="folder" :onClick="click"
                :onSelect="browsing ? selectFolder : undefined" />
        </div>
        <Teleport to="body">
            <div v-if="hoveredPath" class="path-tooltip" :style="tooltipStyle">
                {{ hoveredPath }}
            </div>
        </Teleport>
    </div>
</template>

<style lang="css" scoped>
.navbar {
    background-color: rgba(255, 255, 255, 0.12);
    backdrop-filter: blur(15px);
    box-shadow: 0px 0px 25px rgba(227, 228, 237, 0.37);
    border: 2px solid rgba(255, 255, 255, 0.12);
    border-radius: 5px;
    transition: .1s ease;
}

@media (max-width: 767px) {
    .navbar {
        backdrop-filter: blur(5px);
    }
}

.navbar:hover {
    border-color: rgba(255, 255, 255, 0.37);
}

.browse-btn {
    display: block;
    margin: 6px;
    padding: 2px 4px;
    font-size: 0.88rem;
    font-weight: 700;
    cursor: pointer;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.9);
    text-align: center;
    transition: .2s ease;
    flex-shrink: 0;
}

.browse-btn:hover {
    transform: translateY(-2px);
    background: rgba(255, 255, 255, 0.2);
    border-color: rgba(255, 255, 255, 0.37);
}

.browse-btn:active {
    transform: scale(0.97);
}

@media (max-width: 767px) {
    .browse-btn {
        font-size: 0.75rem;
    }
}

</style>

<style lang="css">
.path-tooltip {
    position: fixed;
    z-index: 100;
    font-size: 0.7rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.9);
    background: rgba(30, 30, 30, 0.92);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    padding: 3px 6px;
    white-space: nowrap;
    pointer-events: none;
    max-width: 90vw;
    overflow: hidden;
    text-overflow: ellipsis;
}
</style>

<script setup lang="ts">
const { apiFetch } = useApi()

const props = defineProps<{
    openFiles: string[];
    rootPath: string;
    initialOpenFolders?: string[];
}>();
const emit = defineEmits<{
    (e: "select-file", path: string): void,
    (e: "select-root", path: string): void,
    (e: "update:openFolders", folders: string[]): void,
}>();

const tree = ref<any[]>([]);
const folder = ref("");
const browsing = ref(false);
const treeLoading = ref(false);

// --- Tooltip ---
const hoveredRawPath = ref("");
const hoveredPath = computed(() =>
    hoveredRawPath.value.replace(/^\/home\/[^/]+/, "~")
);
const tooltipStyle = ref<Record<string, string>>({});
provide("hoveredRawPath", hoveredRawPath);

provide("showTooltip", (path: string, rect: DOMRect) => {
    hoveredRawPath.value = path;
    tooltipStyle.value = {
        top: rect.bottom + 4 + "px",
        left: rect.left + "px",
    };
});

provide("hideTooltip", () => {
    hoveredRawPath.value = "";
});

async function fetchList(path: string, dirsOnly = false): Promise<any[]> {
    const res = await apiFetch("/list?path=" + encodeURIComponent(path));
    let items = await res.json();
    if (dirsOnly) items = items.filter((n: any) => n.type === "dir");
    return items;
}

async function loadTree(path: string, dirsOnly = false): Promise<any[]> {
    folder.value = path;
    return fetchList(path, dirsOnly);
}

// --- Worktree polling: reconcile visible directories every 1s ---
let pollTimer: ReturnType<typeof setInterval> | null = null;

function reconcileChildren(existing: any[], fresh: any[]) {
    const freshMap = new Map(fresh.map(n => [n.path, n]));
    const existingMap = new Map(existing.map(n => [n.path, n]));
    // Remove deleted
    for (let i = existing.length - 1; i >= 0; i--) {
        if (!freshMap.has(existing[i].path)) existing.splice(i, 1);
    }
    // Add new + update names
    for (const fn of fresh) {
        const en = existingMap.get(fn.path);
        if (!en) {
            existing.push(fn);
        } else if (en.name !== fn.name) {
            en.name = fn.name;
        }
    }
}

async function pollVisibleDirs(nodes: any[]) {
    const dirs = nodes.filter(n => n.type === "dir" && n.open && n.children);
    await Promise.all(dirs.map(async (node) => {
        try {
            const fresh = await fetchList(node.path);
            reconcileChildren(node.children, fresh);
            await pollVisibleDirs(node.children);
        } catch {}
    }));
    // Also reconcile the root level
    if (nodes === tree.value && props.rootPath) {
        try {
            const fresh = await fetchList(props.rootPath);
            reconcileChildren(tree.value, fresh);
        } catch {}
    }
}

function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
        if (browsing.value || !props.rootPath || treeLoading.value) return;
        pollVisibleDirs(tree.value);
    }, 1000);
}

function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function getOpenPaths(nodes: any[]): string[] {
    const paths: string[] = [];
    for (const node of nodes) {
        if (node.type === "dir" && node.open) {
            paths.push(node.path);
            if (node.children) paths.push(...getOpenPaths(node.children));
        }
    }
    return paths;
}

function saveOpenFolders() {
    emit("update:openFolders", getOpenPaths(tree.value));
}

async function restoreOpenFolders(nodes: any[], openPaths: Set<string>) {
    await Promise.all(
        nodes.filter(n => n.type === "dir" && openPaths.has(n.path)).map(async (node) => {
            node.open = true;
            node.children = await loadTree(node.path);
            await restoreOpenFolders(node.children, openPaths);
        })
    );
}

async function loadWorkTree() {
    treeLoading.value = true;
    try {
        tree.value = await loadTree(props.rootPath);
        if (props.initialOpenFolders && props.initialOpenFolders.length > 0) {
            const openPaths = new Set<string>(props.initialOpenFolders);
            await restoreOpenFolders(tree.value, openPaths);
        }
    } finally {
        treeLoading.value = false;
        startPolling();
    }
}

async function loadBrowseTree() {
    stopPolling();
    treeLoading.value = true;
    try {
        // Determine target home path: from rootPath, API, or nothing
        let homePath: string | undefined;
        const rpMatch = props.rootPath?.match(/^(\/(?:home|Users)\/[^/]+)/);
        if (rpMatch) {
            homePath = rpMatch[1];
        } else {
            try {
                const res = await apiFetch("/info");
                if (res.ok) {
                    const info = await res.json();
                    if (info.home) homePath = info.home;
                }
            } catch {}
        }

        tree.value = await loadTree("/", true);

        if (!homePath) return;

        // Expand each path segment down to the home dir (e.g. / → home → toto)
        const segments = homePath.split("/").filter(Boolean);
        let currentNodes = tree.value;
        let currentPath = "";
        for (const seg of segments) {
            currentPath += "/" + seg;
            const node = currentNodes.find((n: any) => n.path === currentPath);
            if (!node) break;
            node.open = true;
            node.children = await loadTree(node.path, true);
            currentNodes = node.children;
        }
    } finally {
        treeLoading.value = false;
    }
}

function toggleBrowse() {
    hoveredRawPath.value = "";
    if (browsing.value && props.rootPath) {
        browsing.value = false;
        loadWorkTree();
    } else {
        browsing.value = true;
        loadBrowseTree();
    }
}

function selectFolder(node: any) {
    hoveredRawPath.value = "";
    browsing.value = false;
    if (node.path === props.rootPath) {
        loadWorkTree();
    }
    emit("select-root", node.path);
}

async function click(node: any) {
    if (browsing.value) {
        if (node.type === "dir") {
            node.open = !node.open;
            if (node.open) {
                node.loading = true;
                node.children = await loadTree(node.path, true);
                node.loading = false;
            }
        }
    } else {
        if (node.type !== "file") {
            node.open = !node.open;
            if (node.open) {
                node.loading = true;
                node.children = await loadTree(node.path);
                node.loading = false;
            }
            saveOpenFolders();
        } else
            emit("select-file", node.path);
    }
}

function onEscape(e: KeyboardEvent) {
    if (e.key === "Escape" && browsing.value && props.rootPath) {
        browsing.value = false;
        loadWorkTree();
    }
}

watch(() => props.rootPath, (newPath) => {
    if (newPath) {
        browsing.value = false;
        loadWorkTree();
    } else {
        browsing.value = true;
        loadBrowseTree();
    }
});

// One-shot: re-apply open folders when config loads after the tree is already mounted
// (happens on initial page load when rootPath is pre-set but config loads async)
const unwatchInitialFolders = watch(() => props.initialOpenFolders, async (newVal, oldVal) => {
    // Only fire when going from empty → non-empty (config first load, not workspace switch)
    if (!newVal?.length || oldVal?.length || treeLoading.value || !tree.value.length) return;
    unwatchInitialFolders();
    await restoreOpenFolders(tree.value, new Set(newVal));
}, { immediate: false });

onMounted(async () => {
    treeLoading.value = true;
    if (!props.rootPath) {
        browsing.value = true;
        await loadBrowseTree();
    } else {
        await loadWorkTree();
    }
    window.addEventListener("keydown", onEscape);
});

onBeforeUnmount(() => {
    stopPolling();
    window.removeEventListener("keydown", onEscape);
});

defineExpose({
    showBrowse() {
        browsing.value = true;
        loadBrowseTree();
    },
});
</script>
