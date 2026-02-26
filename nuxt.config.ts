// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    compatibilityDate: '2025-07-15',
    devtools: { enabled: false },
    modules: ['@nuxt/ui', '@nuxt/ui-pro', 'nuxt-svgo', 'nuxt-charts'],
    css: ['~/assets/css/main.css'],
    nitro: {
        experimental: { websocket: true },
        externals: { inline: [], external: ['ssh2'] },
    },
});
