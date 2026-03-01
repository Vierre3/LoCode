<template>
    <ul :class="{ 'browse-mode': !!onSelect }">
        <li v-for="node in sortedNodes" :key="node.path">
            <div class="node-row">
                <div class="node cursor-pointer p-0.5 rounded select-none"
                    :class="{ active: openFiles.includes(node.path) }"
                    :draggable="node.type === 'file'"
                    @dragstart="e => { if (node.type === 'file') { e.dataTransfer?.setData('text/locode-file', node.path); e.dataTransfer!.effectAllowed = 'move'; } }"
                    @click="props.onClick(node)"
                    @mouseenter="onEnter($event, node.path)"
                    @mouseleave="onLeave">
                    {{ node.type !== 'dir' ? "📄" : node.open ? "📂" : "📁" }} {{ node.name }}
                </div>
                <button v-if="onSelect && node.type === 'dir'"
                    @click.stop="onSelect(node)"
                    class="select-btn">
                    Open
                </button>
            </div>
            <div class="tooltip-spacer" :class="{ open: hoveredRawPath === node.path }"></div>
            <div v-if="node.loading" class="ml-5 loading-dots">
                <span></span><span></span><span></span>
            </div>
            <FileTree v-else-if="node.type === 'dir' && node.open" class="ml-5" :nodes="node.children || []"
                :openFiles="openFiles" :folder="folder" :onClick="onClick" :onSelect="onSelect" />
        </li>
    </ul>
</template>

<script setup lang="ts">
const props = defineProps<{
    openFiles: string[], folder: string,
    nodes: { name: string; path: string; type: "file" | "dir"; children?: any[]; open?: Boolean; loading?: boolean }[],
    onClick: (node: any) => void,
    onSelect?: (node: any) => void
}>();

const sortedNodes = computed(() =>
    [...props.nodes].sort((a, b) => {
        // Folders before files
        if (a.type === "dir" && b.type !== "dir") return -1;
        if (a.type !== "dir" && b.type === "dir") return 1;
        // Dotfiles/dotfolders first within same type
        const aDot = a.name.startsWith(".");
        const bDot = b.name.startsWith(".");
        if (aDot && !bDot) return -1;
        if (!aDot && bDot) return 1;
        // Alphabetical (case-insensitive)
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    })
);

const hoveredRawPath = inject<Ref<string>>("hoveredRawPath")!;
const showTooltip = inject<(path: string, rect: DOMRect) => void>("showTooltip");
const hideTooltip = inject<() => void>("hideTooltip");

const isMobile = import.meta.client && window.matchMedia("(max-width: 767px)").matches;

let hoverTimer: ReturnType<typeof setTimeout> | null = null;

function onEnter(e: MouseEvent, path: string) {
    if (hoverTimer) clearTimeout(hoverTimer);
    const el = e.currentTarget as HTMLElement;
    hoverTimer = setTimeout(() => {
        if (el) showTooltip?.(path, el.getBoundingClientRect());
    }, isMobile ? 100 : 600);
}

function onLeave() {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    hideTooltip?.();
}

onBeforeUnmount(() => {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    hideTooltip?.();
});
</script>

<style lang="css" scoped>
.node-row {
    display: flex;
    align-items: center;
}

.node {
    font-weight: 500;
    font-size: 0.85rem;
    transition: font-weight .1s ease;
    white-space: nowrap;
    overflow: hidden;
    color: rgba(255, 255, 255, 0.9);
    flex: 1;
    min-width: 0;
}

.node:hover {
    font-weight: 700;
}

.node.active {
    font-weight: 700;
}

.browse-mode .node {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    mask-image: linear-gradient(to right, black calc(100% - 12px), transparent);
    -webkit-mask-image: linear-gradient(to right, black calc(100% - 12px), transparent);
}

.tooltip-spacer {
    height: 0;
    transition: height .1s ease;
}

.tooltip-spacer.open {
    height: 30px;
}

.select-btn {
    flex-shrink: 0;
    font-size: 0.65rem;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.12);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.9);
    cursor: pointer;
    margin-left: 4px;
    transition: .15s ease;
}

.select-btn:hover {
    background: rgba(255, 255, 255, 0.25);
    border-color: rgba(255, 255, 255, 0.37);
}

@media (max-width: 767px) {
    .node {
        /* font-size: 0.8rem; */
        font-weight: 500;
    }
}

.loading-dots {
    display: flex;
    gap: 3px;
    padding: 3px 2px;
}

.loading-dots span {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.35);
    animation: dot-pulse 1s ease infinite;
}

.loading-dots span:nth-child(2) { animation-delay: 0.15s; }
.loading-dots span:nth-child(3) { animation-delay: 0.30s; }
</style>
