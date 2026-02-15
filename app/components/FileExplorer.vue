<template>
    <div class="h-full navbar flex flex-col">
        <button class="browse-btn" @click="toggleBrowse">
            {{ browsing ? 'Select Folder' : 'Open Folder' }}
        </button>
        <div class="overflow-y-auto overflow-x-hidden flex-1 p-1">
            <FileTree :nodes="tree" :openFiles="openFiles" :folder="folder" :onClick="click"
                :onSelect="browsing ? selectFolder : undefined" />
        </div>
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
    width: calc(100% - 12px);
    margin: 6px;
    padding: 5px 8px;
    font-size: 0.88rem;
    font-weight: 700;
    cursor: pointer;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    color: white;
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

<script setup lang="ts">
const props = defineProps<{ openFiles: string[], rootPath: string }>();

const storageKey = computed(() =>
    props.rootPath ? `locode:openFolders:${props.rootPath}` : "locode:openFolders"
);
const emit = defineEmits<{
    (e: "select-file", path: string): void,
    (e: "select-root", path: string): void
}>();

const tree = ref<any[]>([]);
const folder = ref("");
const browsing = ref(!props.rootPath);

async function loadTree(path: string, dirsOnly = false): Promise<any[]> {
    folder.value = path;
    const res = await fetch("/api/list?path=" + path);
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
    localStorage.setItem(storageKey.value, JSON.stringify(getOpenPaths(tree.value)));
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
    tree.value = await loadTree(props.rootPath);
    const saved = localStorage.getItem(storageKey.value);
    if (saved) {
        try {
            const openPaths = new Set<string>(JSON.parse(saved));
            await restoreOpenFolders(tree.value, openPaths);
        } catch {}
    }
}

async function loadBrowseTree() {
    tree.value = await loadTree("/home", true);
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
    emit("select-root", node.path);
}

async function click(node: any) {
    if (browsing.value) {
        if (node.type === "dir") {
            node.open = !node.open;
            if (node.open)
                node.children = await loadTree(node.path, true);
        }
    } else {
        if (node.type !== "file") {
            node.open = !node.open;
            if (node.open)
                node.children = await loadTree(node.path);
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
    }
});

onMounted(async () => {
    if (browsing.value) {
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
