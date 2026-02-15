<template>
    <ul>
        <li v-for="node in nodes" :key="node.path">
            <div class="node cursor-pointer p-1 rounded select-none flex items-center"
                :class="{ active: openFiles.includes(node.path) }"
                :draggable="node.type === 'file'"
                @dragstart="e => { if (node.type === 'file') { e.dataTransfer?.setData('text/locode-file', node.path); e.dataTransfer!.effectAllowed = 'move'; } }"
                @click="props.onClick(node)">
                <span class="flex-1 min-w-0 overflow-hidden">
                    {{ node.type !== 'dir' ? "📄" : node.open ? "📂" : "📁" }} {{ node.name }}
                </span>
                <button v-if="onSelect && node.type === 'dir'"
                    @click.stop="onSelect(node)"
                    class="select-btn flex-shrink-0">
                    Open
                </button>
            </div>
            <FileTree v-if="node.type === 'dir' && node.open" class="ml-5" :nodes="node.children || []"
                :openFiles="openFiles" :folder="folder" :onClick="onClick" :onSelect="onSelect" />
        </li>
    </ul>
</template>

<script setup lang="ts">
const props = defineProps<{
    openFiles: string[], folder: string,
    nodes: { name: string; path: string; type: "file" | "dir"; children?: any[]; open?: Boolean }[],
    onClick: (node: any) => void,
    onSelect?: (node: any) => void
}>();
</script>

<style lang="css" scoped>
.node {
    font-weight: 600;
    font-size: 0.95rem;
    transition: font-weight .1s ease;
    white-space: nowrap;
    overflow: hidden;
}

.node:hover {
    font-weight: 800;
}

.node.active {
    font-weight: 800;
}

.select-btn {
    font-size: 0.65rem;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.12);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: white;
    cursor: pointer;
    margin-left: 4px;
    transition: .15s ease;
}

.select-btn:hover {
    transform: translateY(-2px);
    background: rgba(255, 255, 255, 0.25);
    border-color: rgba(255, 255, 255, 0.37);
}

@media (max-width: 767px) {
    .node {
        font-size: 0.8rem;
        font-weight: 500;
    }
}
</style>
