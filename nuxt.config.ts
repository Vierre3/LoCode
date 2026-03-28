// https://nuxt.com/docs/api/configuration/nuxt-config
const mode = process.env.LOCODE_MODE || 'desktop'; // 'desktop' | 'web'

// Share server URL: auto-detected from Railway, or set via LOCODE_SHARE_URL
const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
const shareUrl = process.env.LOCODE_SHARE_URL
    || (railwayDomain ? `https://${railwayDomain}` : '');

export default defineNuxtConfig({
    compatibilityDate: '2025-07-15',
    devtools: { enabled: false },
    modules: ['@nuxt/ui', '@nuxt/ui-pro'],
    css: ['~/assets/css/main.css'],
    runtimeConfig: {
        public: {
            mode, // 'desktop' = full (local + SSH), 'web' = SSH-only
            shareUrl, // Public URL of the share server (Railway)
        },
    },
    nitro: {
        experimental: { websocket: true },
        rollupConfig: {
            external: mode === 'web'
                ? [/^ssh2/]
                : [/^ssh2/, /^node-pty/],
        },
    },
});
