# LoCode

## Description

Éditeur de code web léger et rapide, alternative à VSCode orientée performance et accessibilité mobile.
Conçu pour le développement sur serveurs distants via SSH, avec une interface simple et ergonomique.

L'objectif principal est la vitesse : chargement instantané, interactions fluides, et une UI qui ne ralentit pas le développeur.

## Architecture

- **Frontend** : Nuxt 4 + Vue 3 + Monaco Editor (même moteur d'édition que VSCode)
- **Backend** : Deno (serveur HTTP standalone, port 8080)
- **Proxy** : Nuxt server route `server/api/[...url].ts` redirige les appels `/api/*` vers le backend Deno
- **Style** : Design glassmorphism (blur + transparence) avec Tailwind CSS via @nuxt/ui

## Structure du projet

```
app/                              # Frontend Nuxt
  app.vue                         # Layout racine + fond animé gradient
  pages/
    index.vue                     # Page principale (éditeur + explorateur)
    [..._].vue                    # Catch-all redirect vers /
  components/
    FileExplorer.vue              # Sidebar explorateur de fichiers
    FileTree.vue                  # Arbre de fichiers récursif
    MonacoEditor.client.vue       # Éditeur Monaco (client-only)
  plugins/
    monaco.client.ts              # Initialisation des workers Monaco
  middleware/
    auth.global.ts                # Middleware auth (désactivé pour le moment)
  assets/css/
    main.css                      # Import Tailwind

backend/
  server.ts                       # API Deno (read/write/list)

server/
  api/[...url].ts                 # Proxy Nuxt → Deno
```

## API Backend (Deno)

Le serveur Deno expose 3 endpoints REST :

| Route | Méthode | Description | Paramètres |
|-------|---------|-------------|------------|
| `/list` | GET | Liste le contenu d'un répertoire | `path` (query, défaut: `.`) |
| `/read` | GET | Lit le contenu d'un fichier | `path` (query) |
| `/write` | POST | Écrit/sauvegarde un fichier | `{ path, content }` (body JSON) |

Le frontend appelle ces routes via `/api/list`, `/api/read`, `/api/write` — le proxy Nuxt redirige vers le backend Deno.

## Commandes

```bash
# Démarrer le backend Deno
deno run --allow-all backend/server.ts

# Démarrer le frontend Nuxt (dev)
npm run dev

# Build de production
npm run build

# Preview du build
npm run preview
```

Les deux serveurs doivent tourner simultanément en développement.

## Configuration

Fichier `.env` à la racine :

```
DENO_URL="http://localhost"
DENO_PORT="8080"
```

## Ce qui a été fait

- Éditeur Monaco avec coloration syntaxique (JS, TS, Vue, JSON, HTML, CSS, Markdown)
- Détection automatique du langage selon l'extension du fichier
- Explorateur de fichiers avec chargement lazy des sous-dossiers
- Lecture et écriture de fichiers via API REST
- Design glassmorphism avec fond animé en gradient (bleu/vert)
- Proxy Nuxt vers backend Deno (server route catch-all)
- Préchargement du répertoire racine côté backend (cache mémoire au démarrage du serveur Deno)
- Layout responsive avec sidebar mobile en drawer slide-in depuis la gauche (bords arrondis)
- Bouton hamburger pour toggle de la sidebar sur mobile (masqué sur desktop)
- Fermeture automatique du drawer à la sélection d'un fichier sur mobile
- Touch targets agrandis pour l'explorateur de fichiers sur mobile
- Persistance du fichier ouvert via `localStorage` (restauré après refresh)
- Protection contre le rechargement inutile d'un fichier déjà ouvert
- Poids de police progressif dans le file tree (medium → bold au hover → extra-bold pour le fichier actif)

## Stack technique

- **Nuxt** 4.1.0
- **Vue** 3.5.20
- **Monaco Editor** 0.53.0
- **Deno** 2.4.4 (backend)
- **@nuxt/ui** 3.3.3 + **@nuxt/ui-pro** 3.3.3
- **Tailwind CSS** (via @nuxt/ui)
