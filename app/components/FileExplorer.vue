<template>
    <div class="h-full navbar flex flex-col">
        <button class="browse-btn" @click="toggleBrowse">
            {{ browsing ? 'Select Folder' : 'Open Folder' }}
        </button>
        <div class="overflow-y-auto overflow-x-hidden flex-1 p-1">
            <div v-if="treeLoading" class="tree-skeleton">
                <div v-for="(node, i) in skeletonBlueprint" :key="i" class="skeleton-row"
                    :style="{ paddingLeft: node.depth * 20 + 'px' }">
                    <span class="skeleton-icon"></span>
                    <div class="skeleton-node" :style="{ width: node.width + '%' }"></div>
                </div>
            </div>
            <FileTree v-else :nodes="tree" :openFiles="openFiles" :folder="folder" :onClick="click"
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

.tree-skeleton {
    padding: 4px 2px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.skeleton-row {
    display: flex;
    align-items: center;
    gap: 6px;
}

.skeleton-icon {
    width: 12px;
    height: 12px;
    border-radius: 2px;
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.07);
    animation: shimmer 1.4s ease infinite;
    background: linear-gradient(
        90deg,
        rgba(255, 255, 255, 0.04) 0%,
        rgba(255, 255, 255, 0.1) 50%,
        rgba(255, 255, 255, 0.04) 100%
    );
    background-size: 200% 100%;
}

.skeleton-node {
    height: 12px;
    border-radius: 3px;
    background: linear-gradient(
        90deg,
        rgba(255, 255, 255, 0.05) 0%,
        rgba(255, 255, 255, 0.12) 50%,
        rgba(255, 255, 255, 0.05) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.4s ease infinite;
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
import type { SkeletonNode } from '~/composables/useLocodeConfig'
import { DEFAULT_SKELETON } from '~/composables/useLocodeConfig'
const { apiFetch } = useApi()

const props = defineProps<{
    openFiles: string[];
    rootPath: string;
    initialOpenFolders?: string[];
    initialSkeleton?: SkeletonNode[];
}>();
const emit = defineEmits<{
    (e: "select-file", path: string): void,
    (e: "select-root", path: string): void,
    (e: "update:openFolders", folders: string[]): void,
    (e: "update:skeleton", skeleton: SkeletonNode[]): void,
}>();

const tree = ref<any[]>([]);
const folder = ref("");
const browsing = ref(false);
const treeLoading = ref(false);

// --- Skeleton blueprint ---
function readSkeletonFromProps(): SkeletonNode[] {
    if (props.initialSkeleton && props.initialSkeleton.length > 0) return props.initialSkeleton;
    return DEFAULT_SKELETON;
}

const skeletonBlueprint = ref<SkeletonNode[]>(readSkeletonFromProps());

function flattenTree(nodes: any[], depth = 0): SkeletonNode[] {
    const result: SkeletonNode[] = [];
    for (const node of nodes) {
        const nameLen = Math.min(node.name?.length || 5, 20);
        result.push({ depth, type: node.type, width: 25 + nameLen * 3 });
        if (node.type === "dir" && node.open && node.children) {
            result.push(...flattenTree(node.children, depth + 1));
        }
    }
    return result;
}

function saveSkeletonBlueprint() {
    if (!props.rootPath) return;
    const blueprint = flattenTree(tree.value);
    if (blueprint.length > 0) {
        emit("update:skeleton", blueprint);
    }
}

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

async function loadTree(path: string, dirsOnly = false): Promise<any[]> {
    folder.value = path;
    const res = await apiFetch("/list?path=" + path);
    let items = await res.json();
    if (dirsOnly) items = items.filter((n: any) => n.type === "dir");
    return items;
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
        saveSkeletonBlueprint();
    } finally {
        treeLoading.value = false;
    }
}

async function loadBrowseTree() {
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

        // Expand each path segment down to the home dir (e.g. / → Users → py)
        const segments = homePath.split("/").filter(Boolean); // ["Users", "py"] or ["home", "py"]
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
    if (browsing.value && props.rootPath) {
        browsing.value = false;
        loadWorkTree();
    } else {
        browsing.value = true;
        loadBrowseTree();
    }
}

function selectFolder(node: any) {
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
            saveSkeletonBlueprint();
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
        skeletonBlueprint.value = readSkeletonFromProps();
        loadWorkTree();
    }
});

// When parent pushes fresh config values (workspace switch), update skeleton
watch(() => props.initialSkeleton, (val) => {
    if (val && val.length > 0) skeletonBlueprint.value = val;
});

// One-shot: re-apply open folders when config loads after the tree is already mounted
// (happens on initial page load when rootPath is pre-set but config loads async)
const unwatchInitialFolders = watch(() => props.initialOpenFolders, async (newVal, oldVal) => {
    // Only fire when going from empty → non-empty (config first load, not workspace switch)
    if (!newVal?.length || oldVal?.length || treeLoading.value || !tree.value.length) return;
    unwatchInitialFolders();
    await restoreOpenFolders(tree.value, new Set(newVal));
    saveSkeletonBlueprint();
}, { immediate: false });

onMounted(async () => {
    skeletonBlueprint.value = readSkeletonFromProps();
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
    window.removeEventListener("keydown", onEscape);
});
</script>
