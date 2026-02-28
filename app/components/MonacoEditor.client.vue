<template>
    <div ref="editorContainer" class="h-full"></div>
</template>

<script setup lang="ts">
const props = defineProps<{
    modelValue: string;
    language?: string;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "focus"): void;
}>();

const { $monaco } = useNuxtApp();

const editorContainer = ref<HTMLDivElement | null>(null);
let editor: import("monaco-editor").editor.IStandaloneCodeEditor | null = null;
let contentDisposable: import("monaco-editor").IDisposable | null = null;

onMounted(async () => {
    await nextTick();

    if (editorContainer.value) {
        editor = $monaco.editor.create(editorContainer.value, {
            value: props.modelValue,
            language: props.language,
            theme: "vs-dark",
            automaticLayout: true,
            fontSize: 12,
        });

        contentDisposable = editor.onDidChangeModelContent(() => {
            const value = editor!.getValue();
            emit("update:modelValue", value);
        });

        editor.onDidFocusEditorWidget(() => {
            emit("focus");
        });
    }
});

watch(
    () => props.modelValue,
    (newValue) => {
        if (!editor || editor.getValue() === newValue) return;
        // Replace full content while preserving cursor & scroll position
        const model = editor.getModel();
        if (!model) { editor.setValue(newValue); return; }
        const fullRange = model.getFullModelRange();
        editor.executeEdits("auto-reload", [{
            range: fullRange,
            text: newValue,
        }]);
    }
);

watch(
    () => props.language,
    (newLanguage) => {
        if (editor && newLanguage) {
            $monaco.editor.setModelLanguage(editor.getModel()!, newLanguage);
        }
    }
);

defineExpose({
    focus() { editor?.focus(); }
});

onBeforeUnmount(() => {
    if (contentDisposable) {
        contentDisposable.dispose();
        contentDisposable = null;
    }
    if (editor) {
        editor.dispose();
        editor = null;
    }
});
</script>
