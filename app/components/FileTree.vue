<template>
    <ul class="ml-2">
        <li v-for="node in nodes" :key="node.path">
            <div class="node cursor-pointer py-1.5 px-2 rounded select-none"
                :class="{ active: node.path === file }"
                @click="props.onClick(node)">
                <span>
                    {{ node.type !== 'dir' ? "📄" : node.open ? "📂" : "📁" }} {{ node.name }}
                </span>
            </div>
            <FileTree v-if="node.type === 'dir' && node.open" :nodes="node.children || []"
                :file="file" :folder="folder" :onClick="onClick" />
        </li>
    </ul>
</template>

<script setup lang="ts">
const props = defineProps<{
    file: string, folder: string,
    nodes: { name: string; path: string; type: "file" | "dir"; children?: any[]; open?: Boolean }[],
    onClick: (node: any) => void
}>();
</script>

<style lang="css" scoped>
.node {
    font-weight: 600;
    font-size: 0.85rem;
    transition: font-weight .1s ease;
}

.node:hover {
    font-weight: 800;
}

.node.active {
    font-weight: 800;
}

</style>
