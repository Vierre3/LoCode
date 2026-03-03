# LoCode

## Description

Éditeur de code web léger et rapide, alternative à VSCode orientée performance et accessibilité mobile.
Conçu pour le développement sur serveurs distants via SSH, avec une interface simple et ergonomique.

L'objectif principal est la vitesse : chargement instantané, interactions fluides, et une UI qui ne ralentit pas le développeur.

## Architecture

- **Frontend** : Nuxt 4 + Vue 3 + Monaco Editor (même moteur d'édition que VSCode)
- **Backend local** : Nuxt server routes (`server/api/local/*`) pour les opérations fichier via Node.js fs
- **Backend SSH** : Nuxt server routes (`server/api/ssh/*`) pour les opérations fichier via ssh2 SFTP
- **Style** : Design glassmorphism (blur + transparence) avec Tailwind CSS via @nuxt/ui
- **Desktop** : Electron wrapper (`electron/main.cjs`) qui lance Nuxt en sous-processus

### Modes de fonctionnement

```
MODE LOCAL / DESKTOP
  Electron BrowserWindow → localhost:{port}
    Nuxt Nitro
      ├─ /api/local/* ────────────► Node.js fs (file ops)
      └─ /_terminal (WebSocket) ──► node-pty (shell local)

MODE SSH DISTANT
  Navigateur ──► Nuxt frontend
    ├─ /api/ssh/* ─────────────────► ssh2 SFTP (file ops sur machine distante)
    └─ /_ssh-terminal (WebSocket) ─► ssh2 shell channel (PTY distant)
```

`useApi.ts` route automatiquement vers `/api/local/*` ou `/api/ssh/*` selon la config SSH dans `sessionStorage("locode:sshTarget")` (per-window). Le routage est transparent pour les composants.

## Structure du projet

```
app/                              # Frontend Nuxt
  app.vue                         # Layout racine + fond animé gradient
  pages/
    index.vue                     # Page principale (orchestrateur : éditeur, terminal, header)
    [..._].vue                    # Catch-all redirect vers /
  components/
    FileExplorer.vue              # Sidebar explorateur de fichiers
    FileTree.vue                  # Arbre de fichiers récursif (avec drag-and-drop)
    MonacoEditor.client.vue       # Éditeur Monaco (client-only, émet focus)
    EditorArea.vue                # Container split editor (1-2 panneaux) avec drop zones
    UnsavedDialog.vue             # Dialog modal glassmorphism pour modifications non sauvegardées
    Terminal.client.vue           # Composant xterm.js (client-only, PTY via WebSocket)
    TerminalPanel.vue             # Panel multi-terminaux avec sidebar et split
    SettingsModal.vue             # Modal paramètres (URL backend distant)
  composables/
    useApi.ts                     # Fetch centralisé : route vers /api/local/* ou /api/ssh/* + WebSocket
    useLocodeConfig.ts            # Config workspace persistée (.LoCode file, cache mémoire)
  plugins/
    monaco.client.ts              # Initialisation des workers Monaco
  middleware/
    auth.global.ts                # Middleware auth (désactivé pour le moment)
  assets/css/
    main.css                      # Import Tailwind

server/
  api/local/                        # Routes API mode local (Node.js fs)
    read.get.ts, list.get.ts, write.post.ts, stat.get.ts, info.get.ts
  api/ssh/                          # Routes API mode SSH (ssh2 SFTP)
    read.get.ts, list.get.ts, write.post.ts, stat.get.ts, info.get.ts, connect.post.ts, disconnect.post.ts
  routes/
    _terminal.ts                  # WebSocket handler + node-pty (terminal local)

electron/
  main.cjs                        # Process principal Electron (spawn Nuxt, BrowserWindow, CLI installer)

.github/
  workflows/
    electron-build.yml            # CI GitHub Actions : builds Windows/Mac/Linux en parallèle
```

## API Backend

Les routes Nuxt server exposent les mêmes endpoints en mode local et SSH :

| Route | Méthode | Description | Paramètres |
|-------|---------|-------------|------------|
| `/api/{local,ssh}/list` | GET | Liste le contenu d'un répertoire | `path` (query) |
| `/api/{local,ssh}/read` | GET | Lit le contenu d'un fichier | `path` (query) |
| `/api/{local,ssh}/write` | POST | Écrit/sauvegarde un fichier | `{ path, content }` (body JSON) |
| `/api/{local,ssh}/stat` | GET | Stats d'un fichier (mtime) | `path` (query) |
| `/api/{local,ssh}/info` | GET | Info machine (home, user) | — |
| `/_terminal` | WebSocket | Shell PTY local (node-pty) | messages JSON (create/input/resize) |
| `/_ssh-terminal` | WebSocket | Shell PTY distant (ssh2) | messages JSON (create/input/resize) |

`useApi().apiFetch(path)` route automatiquement vers `/api/local` ou `/api/ssh` selon la config.

## Commandes

```bash
# Démarrer le frontend Nuxt (dev)
npm run dev

# Build de production
npm run build

# Preview du build
npm run preview

# App Electron (dev — build nuxt puis lance electron)
npm run electron:dev

# Packager l'app desktop
npm run electron:build:linux   # AppImage (Linux/WSL)
npm run electron:build:mac     # DMG (macOS)
npm run electron:build:win     # NSIS installer (Windows)
```

Le serveur Nuxt gère tout (API locale + SSH + terminal) en mode dev.

## Mode SSH distant — usage

1. Dans LoCode settings (icône engrenage dans le header) : entrer les informations SSH (host, port, username)
2. L'explorateur de fichiers et l'éditeur opèrent sur le filesystem distant via SFTP (ssh2)
3. Le terminal spawn les shells distants via ssh2 shell channel (WebSocket `/_ssh-terminal`)

## CI / Releases

`.github/workflows/electron-build.yml` — déclenché par un tag `v*` ou manuellement :
- Matrix build : `windows-latest` (exe), `macos-latest` (dmg x64+arm64), `ubuntu-latest` (AppImage)
- Caches : `node_modules` (par OS + hash lockfile), `.output` Nuxt (partagé cross-platform), binaires Electron
- La sortie Nuxt (`.output`) est cachée sans `runner.os` dans la clé — platform-indépendant, partagé entre les 3 runners
- Crée une GitHub Release avec les artefacts via `softprops/action-gh-release`

```bash
git tag v0.1.0 && git push --tags   # déclenche le workflow
```

## Ce qui a été fait

- Éditeur Monaco avec coloration syntaxique (~50 langages : JS, TS, Vue, Python, Rust, Go, C/C++, Haskell, Java, Kotlin, Ruby, PHP, etc.)
- Détection automatique du langage selon l'extension du fichier (table `langMap` extensible)
- Explorateur de fichiers avec chargement lazy des sous-dossiers
- Lecture et écriture de fichiers via API REST
- Design glassmorphism avec fond animé en gradient (bleu/vert)
- Routes API local (`server/api/local/*`) pour les opérations fichier via Node.js fs
- Routes API SSH (`server/api/ssh/*`) pour les opérations fichier via ssh2 SFTP
- Layout responsive avec sidebar mobile en drawer slide-in depuis la gauche (bords arrondis)
- Bouton hamburger pour toggle de la sidebar sur mobile (masqué sur desktop)
- Fermeture automatique du drawer à la sélection d'un fichier sur mobile
- Touch targets agrandis pour l'explorateur de fichiers sur mobile
- Persistance du fichier ouvert via `localStorage` (restauré après refresh)
- Protection contre le rechargement inutile d'un fichier déjà ouvert
- Poids de police progressif dans le file tree (medium → bold au hover → extra-bold pour le fichier actif)
- Persistance du worktree (dossiers ouverts) dans `localStorage` — restaurés récursivement après refresh
- Sidebar redimensionnable sur desktop via drag du bord droit (largeur persistée dans `localStorage`, min 150px / max 500px)
- Transition fluide sur la largeur de la sidebar (désactivée pendant le drag pour réactivité)
- Noms de fichiers sur une seule ligne avec coupure visuelle (overflow hidden, pas d'ellipsis)
- Éditeur Monaco affiché immédiatement avec fond `#1e1e1e` (même couleur que le thème vs-dark) avant le chargement du contenu
- Raccourci clavier `Ctrl+S` / `Cmd+S` pour sauvegarder le fichier avec animation visuelle sur le bouton Save
- Correction de la coloration syntaxique des fichiers `.vue` (mappé vers le mode `html` de Monaco)
- Sélecteur de dossier de travail (bouton "Open Folder" / "Select Folder") avec navigation dans `/home` (dossiers uniquement)
- Bouton "Open" sur chaque dossier en mode browse pour le sélectionner comme racine de travail
- Persistance du dossier de travail sélectionné dans `localStorage` — restauré après refresh
- Première visite : affichage automatique du sélecteur de dossier
- Sélection d'un dossier de travail ferme automatiquement le mode browse et charge le worktree
- Retour au worktree de travail via Escape ou re-clic sur le bouton
- Animations hover cohérentes sur tous les boutons (translateY -2px)
- Chemin du fichier affiché en relatif par rapport au dossier de travail sélectionné
- Troncature du chemin par le début (`...`) pour garder le nom du fichier visible sur mobile (CSS `direction: rtl` + `<bdo dir="ltr">`)
- Tooltip sur le chemin du fichier pour afficher le chemin complet au survol
- Protection contre les fichiers trop volumineux (max 5 MB) côté backend — retourne HTTP 413 au lieu de crasher
- Gestion des erreurs de lecture côté frontend (message affiché dans l'éditeur en plaintext)
- Validation POST `/write` : JSON parsing protégé, vérification des types `path` et `content`, status 500 en cas d'erreur d'écriture (au lieu de 200)
- Correction memory leaks frontend : cleanup du listener `MediaQueryList`, cleanup des listeners resize si unmount pendant un drag, dispose du listener `onDidChangeModelContent` de Monaco
- Watcher de `language` séparé dans MonacoEditor — le changement de coloration syntaxique s'applique indépendamment du changement de contenu
- Restauration parallèle des dossiers ouverts (`Promise.all` au lieu de boucle séquentielle)
- Error handling sur `loadFile()` et `saveFile()` : try-catch réseau, vérification `res.ok`, mutex anti-spam sur save
- Gestion du `<head>` via `useHead()` de Nuxt (titre + viewport) au lieu de tags HTML bruts dans le template
- Polices adaptatives mobile : tailles réduites sur mobile (file tree, file label, boutons, Monaco Editor 12px vs 15px desktop)
- `"overrides": { "minimatch": ">=10.2.1" }` dans package.json — force la déduplication de toutes les copies imbriquées de minimatch vers la version safe (corrige 24 vulnérabilités npm audit)

### Tooltip chemin fichier/dossier
- Survol prolongé (600ms) d'un fichier ou dossier dans le worktree/browse affiche un tooltip flottant avec le chemin complet
- Tooltip rendu via `<Teleport to="body">` + `position: fixed` pour dépasser la sidebar
- Spacer inline dans le tree (div avec `height: 0` → `height: 30px`) pour décaler les nodes en dessous et éviter qu'ils soient cachés par le tooltip
- Transition CSS de 0.1s sur la hauteur du spacer pour un décalage fluide
- Chemin affiché avec `~` à la place de `/home/<user>` (regex `^\/home\/[^/]+` → `~`)
- Communication FileExplorer ↔ FileTree via `provide`/`inject` : `hoveredRawPath` (ref partagé pour le spacer, chemin brut), `hoveredPath` (computed avec `~`, pour l'affichage du tooltip), `showTooltip`/`hideTooltip` (fonctions pour le tooltip flottant)
- Style glassmorphism cohérent (fond sombre, blur, bordure semi-transparente)

### Explorateur de fichiers — scroll et mode browse
- Worktree scrollable horizontalement en bloc (`overflow-x: auto` sur le container)
- Mode browse : texte des noms de dossiers clippé avant le bouton "Open" via `mask-image` gradient (pas de scroll horizontal)
- Classe `.browse-mode` conditionnelle sur `<ul>` selon `!!onSelect`

### Split Editor
- Composant `EditorArea.vue` : container pour 1 ou 2 panneaux éditeur côte à côte
- Drag-and-drop depuis le file tree (`FileTree.vue`) vers l'éditeur pour ouvrir en split (drop zones : left/center/right)
- `draggable="true"` + `@dragstart` sur les fichiers du file tree avec MIME type `text/locode-file`
- Drop zone overlay visuel avec 3 zones (Split Left / Replace / Split Right) pendant le drag
- Resize handle vertical entre les 2 panneaux (min 20% / max 80%, persisté dans `localStorage("locode:splitRatio")`)
- Noms des fichiers ouverts affichés dans le header, alignés avec la largeur de chaque pane via `splitRatio` exposé par `EditorArea`
- Bouton close (×) sur chaque fichier ouvert — ferme le pane (ou le vide si c'est le dernier)
- Clic sur le nom de fichier → focus de l'éditeur correspondant
- Indicateur dirty (`*` devant le nom) quand le fichier a des modifications non sauvegardées
- Pas de split sur mobile (< 768px) — un seul pane visible
- `MonacoEditor.client.vue` émet `focus` via `editor.onDidFocusEditorWidget` pour détecter le pane actif

### Dialog modifications non sauvegardées
- Composant `UnsavedDialog.vue` : dialog modal glassmorphism centré
- 3 boutons : Save (sauvegarde puis continue), Discard (continue sans sauver), Cancel (annule)
- Affiché avant de changer de fichier ou fermer un pane dirty
- Backdrop semi-transparent, fermeture par clic extérieur ou Escape

### Terminal intégré
- Terminal PTY complet via xterm.js + node-pty (WebSocket)
- `Terminal.client.vue` : composant xterm.js avec FitAddon + WebLinksAddon
- `TerminalPanel.vue` : panel multi-terminaux avec sidebar de sélection
- `server/routes/_terminal.ts` : WebSocket handler avec `defineWebSocketHandler`, spawn node-pty, messages JSON (create/input/resize/output/exit)
- `nuxt.config.ts` : `nitro.experimental.websocket: true` pour activer les WebSockets
- Toggle terminal via clic logo ou raccourci `Ctrl+J` / `Cmd+J` avec gestion du focus (ouverture → focus terminal, fermeture → focus éditeur actif)
- Fonctions `openTerminal()` / `closeTerminal()` dédiées pour éviter les race conditions (nextTick chaîné)
- `Ctrl+J` et `Ctrl+S` passent au travers de xterm via `attachCustomKeyEventHandler` (bubble au window handler)
- Multiples terminaux : création (+), suppression (×), sélection dans la sidebar
- Numérotation des terminaux avec réutilisation des gaps (Terminal 3 supprimé → le prochain sera Terminal 3)
- Numérotation réinitialisée à 1 par workspace
- IDs terminaux préfixés par `epoch` (`t${Date.now()}-${id}`) pour forcer la re-création des composants Vue au changement de workspace
- Hauteur du panel terminal auto-sized à l'ouverture pour afficher exactement N lignes : `TerminalPanel.autoSize(targetRows)` mesure la hauteur de cellule réelle via `Terminal.client.getCellHeight()` (utilise `_core._renderService.dimensions.css.cell.height` ou fallback container/rows), puis fixe `panelHeight = targetRows * cellH + 14` (6px handle + 8px padding xterm)
- `terminalHeight` sauvegardé en config : `null` = jamais redimensionné manuellement → auto-size à l'ouverture ; valeur = hauteur choisie par l'utilisateur → restaurée
- Resize vertical du panel terminal (min 100px, max 60% viewport, persisté dans `localStorage("locode:terminalHeight")`)
- Fermeture du dernier terminal → ferme le panel, réouverture crée un Terminal 1 frais
- Auto-focus du terminal à la création : `Terminal.client.vue` appelle `term.focus()` à la fin de `onMounted` si `props.active` est `true` (corrige le focus manquant sur les nouveaux terminaux)

### Terminal split
- Drag-and-drop des onglets terminaux pour créer un split (2 terminaux côte à côte)
- Drop overlay avec zones Left/Right pendant le drag
- Resize handle horizontal entre les 2 terminaux
- `activeId` = terminal gauche (positionnement), `focusedId` = terminal sélectionné dans la sidebar (highlight)
- `savedSplit` : mémorise le dernier couple split pour restauration quand on revient
- Clic sur le contenu d'un terminal en split → met à jour `focusedId` via `@mousedown`
- Fermeture d'un terminal en split → sélection automatique de l'autre terminal du split
- Pas de split terminal sur mobile — un seul terminal visible
- Mobile : barre horizontale d'onglets au-dessus du terminal (pas en overlay)

### Persistance par workspace
- État de l'éditeur (fichiers ouverts, panes, split) persisté par workspace dans `localStorage`
- Nombre de terminaux et index de split sauvegardés par workspace
- Restauration complète au changement de workspace ou refresh

### Loading overlay
- Overlay plein écran glassmorphism affiché au démarrage : blur 20px, carte centrée, logo pulsant, barre de progression, messages rotatifs
- Messages bullshit défilent via CSS pur (`@keyframes rotate` sur chaque span avec `animationDelay: i * 2s`) — pas de setInterval
- `messageIndex` via `useState('loaderMsgIdx')` : calculé une fois côté serveur, sérialisé dans le payload HTML, réutilisé à l'identique côté client → zéro hydration mismatch
- Overlay visible dès le premier octet HTML (SSR), caché via `loading = false` dans `onMounted`
- Fade-out via `<Transition name="loader-fade">` (opacity 0.4s ease)

### Animations boutons
- Bouton close (×) dans l'éditeur et les terminaux : `<span class="close-icon">` avec `transform: rotate(90deg)` au hover, transition spring `cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s` — seul le texte tourne, pas le fond
- Bouton + des terminaux : `<span class="add-icon">` avec `rotate(90deg) scale(1.15)` au hover, même transition spring

### Dialog modifications non sauvegardées — fade-in
- `UnsavedDialog.vue` : `.modal-enter-active` animé avec `backdrop-fade-in` (opacity 0 → 1 en 0.25s)
- Apparition et disparition toutes deux animées (symétrique)

### Monaco workers
- `app/plugins/monaco.client.ts` : imports directs des web workers Monaco (`editor.worker`, `json.worker`, `css.worker`, `html.worker`, `ts.worker`)
- `self.MonacoEnvironment.getWorker` défini pour router chaque langage vers le bon worker — élimine les erreurs console "You must define MonacoEnvironment.getWorkerUrl"

### App desktop Electron
- `electron/main.cjs` (CommonJS, `.cjs` pour éviter le conflit avec `"type": "module"`) : spawn Nuxt server en sous-processus via `ELECTRON_RUN_AS_NODE`, attend que le port soit prêt via `net.createConnection`, crée `BrowserWindow`
- Port attribué dynamiquement via `getFreePort()` (bind port 0, récupère le port assigné)
- `ELECTRON_CACHE` et `ELECTRON_BUILDER_CACHE` pointés sur des chemins workspace-relatifs dans le workflow CI pour un cache cross-platform cohérent
- Liens externes ouverts dans le navigateur système via `setWindowOpenHandler` + `shell.openExternal`
- Single-instance lock via `app.requestSingleInstanceLock()` — un seul processus principal, les lancements suivants déclenchent `second-instance`

### Commande CLI `locode`
- `locode .` ou `locode /path/to/project` → ouvre l'app directement sur ce dossier (skip session restore)
- `parseDirArg(argv, cwd)` : parse le premier argument qui résout vers un répertoire existant
- `app.on("second-instance", (event, argv, workingDirectory))` : résout les chemins relatifs par rapport au CWD du second processus, ouvre une nouvelle fenêtre sur le dossier donné ou focus une fenêtre existante si pas d'argument
- **macOS / Linux** : symlink `/usr/local/bin/locode` → binaire de l'app, prompt admin une seule fois, préférence "declined" persistée dans un fichier pour ne plus redemander
- **Windows** : stub C# compilé à l'exécution via `csc.exe` (.NET Framework) dans `appDir/cli/locode.exe` — évite le retour chariot des fichiers `.cmd` ; fallback sur `locode.cmd` si compilation échoue ; `appDir/cli` ajouté au PATH utilisateur via registre (`HKCU\Environment`)

### Support WSL (Windows Subsystem for Linux)
- Install CLI dans toutes les distros WSL : détection via `wsl -l -q` (UTF-16LE), shell script `/usr/local/bin/locode` installé dans chaque distro
- `shell.openPath(batFile)` pour ouvrir une fenêtre CMD visible (seul moyen d'avoir un prompt `sudo` depuis un GUI Electron sans TTY)
- Prompts Y/n par distro avec préférences persistées dans `wsl-cli-prefs.json` (userData) : `"accepted"` / `"declined"` par distro, distros déjà installées auto-détectées comme `"accepted"`
- Shell script WSL : convertit les chemins via `wslpath -w` et lance l'exe Windows en background
- Terminal WSL : détecte les chemins UNC (`\\wsl.localhost\...` via regex `^\\\\wsl[.$\\]`), spawn `wsl.exe -d <distro> --cd <linuxPath>` au lieu de PowerShell — dans le IPC `term:create` (main.cjs, mode Electron) ET dans `server/routes/_terminal.ts` (mode web)
- Fichiers WSL : `path.normalize()` ajouté dans les 4 routes server local (`read.get.ts`, `list.get.ts`, `stat.get.ts`, `write.post.ts`) pour restaurer les chemins UNC depuis `//wsl.localhost/...` (mangé par le parsing URL de H3/Nitro qui convertit `%5C` → `/`)
- `encodeURIComponent()` sur les appels `apiFetch` frontend pour les chemins de fichiers (`FileExplorer.vue`, `index.vue`)

### Améliorations diverses
- Tri des fichiers dans l'explorateur (dossiers en premier, puis alphabétique)
- `Ctrl+R` bloqué dans le terminal pour éviter le reload de la page
- Effets glow sur les boutons (hover lumineux)
- Bouton Save : style hover désactivé quand `disabled`
- Messages d'erreur SSH améliorés (affichage clair en cas d'échec de connexion)
- Limite max de terminaux
- Reconnexion SSH automatique + barre de progression
- Optimisations taille de l'app (réduction du bundle)

### Mode SSH distant
- `app/composables/useApi.ts` : composable centralisé `useApi()` exposant `apiFetch(path)` (route vers `/api/local/*` ou `/api/ssh/*` selon config), `getWsUrl()` (retourne `/_terminal` ou `/_ssh-terminal`), `getMode()` (retourne `"local"` ou `"ssh"`)
- **Isolation per-window** : état SSH actif stocké dans `sessionStorage("locode:sshTarget")` (propre à chaque fenêtre Electron), credentials mémorisés dans `localStorage("locode:sshCreds")` (partagés). Ouvrir une nouvelle fenêtre = mode local par défaut, indépendamment des autres fenêtres connectées en SSH
- `app/components/SettingsModal.vue` : modal glassmorphism avec champs SSH (host, port, username). À l'ouverture, charge depuis `sessionStorage` (connexion active) puis fallback `localStorage` (credentials sauvegardés). Connexion écrit dans les deux, déconnexion ne supprime que `sessionStorage`
- `server/api/ssh/*` : routes SFTP via ssh2 (read, write, list, stat, info, connect, disconnect)
- `server/routes/_ssh-terminal.ts` : WebSocket handler pour shell distant via ssh2 shell channel
- `Terminal.client.vue` : connexion WebSocket via `useApi().getWsUrl()` (local ou distant selon config)
- Icône engrenage dans le header de `index.vue` avec indicateur visuel `.btn-remote` quand un backend distant est actif
- Cache fichier vidé à la connexion/déconnexion SSH (changement de filesystem)

### Cache fichier en mémoire
- `fileCache` (`Map<string, CachedFile>`) : cache in-memory des fichiers ouverts, clé = chemin absolu, valeur = `{ code, language }`
- Cache alimenté uniquement à la première lecture (`loadFileIntoPane`) et à la sauvegarde (`savePaneFile`) — jamais par le polling mtime
- Réouverture d'un fichier déjà caché : contenu servi instantanément depuis le cache (pas de progress bar, pas de fetch réseau), identique visuellement à un chargement API
- Cache vidé au changement de workspace (`onSelectRoot`, `resetToFolderSelector`) — pas de persistance, détruit à la fermeture de fenêtre
- Gain majeur en mode SSH : évite le re-téléchargement de gros fichiers (ex: `package-lock.json` ~3s → instantané)

### Hot-reload fichiers ouverts
- Polling mtime toutes les 1s (au lieu de 2s) pour les fichiers actuellement ouverts dans les panes
- `refreshPaneFromDisk(paneId)` : compare le mtime courant au précédent, re-lit le fichier uniquement si changé sur le disque ET pas de modifications non sauvegardées
- Le polling ne touche pas le cache — il met à jour uniquement le contenu du pane (`pane.code`, `pane.savedCode`)
- Clic sur un fichier déjà ouvert dans un pane → focus du pane + refresh mtime en background (pas de rechargement complet)

### Persistance cross-mode (SSH ↔ local)
- Les chemins dans `.LoCode` (`paneFiles`, `openFolders`) sont stockés en **relatif** par rapport au `rootPath` (ex: `src/index.ts` au lieu de `/home/py/project/src/index.ts`)
- `toRelative(absPath, root)` / `toAbsolute(relOrAbs, root)` : conversion à la sauvegarde / restauration
- Rétrocompatible : les anciens chemins absolus (commençant par `/`, `C:\`, `\\\\`) sont détectés et passent au travers sans modification
- Résout le conflit entre chemins Linux (SSH depuis Mac) et chemins UNC Windows (`\\wsl.localhost\...` en mode local desktop)

### Lancement WSL amélioré
- Shell script WSL détache stdin/stdout/stderr (`</dev/null >/dev/null 2>&1 &`) pour éviter que le processus Electron reste attaché au terminal WSL
- `second-instance` handler : `w.show()` + `setAlwaysOnTop(true/false)` pour forcer la fenêtre au premier plan sur Windows (contourne la protection anti-focus-stealing)

### Refactoring code cleanup
- Suppression de `server/api/[...url].ts` (ancien proxy Deno catch-all, remplacé par routes `/api/local/*` et `/api/ssh/*`)
- `useApi.ts` simplifié : déduplication logique protocole dans `getWsUrl()`, appel unique `getStoredSSHTarget()` par fonction
- `useLocodeConfig.ts` : cache-first dans `loadConfig()` (skip requête disque si déjà en cache), déduplication des paths success/failure
- `index.vue` : 5 watchers terminaux consolidés en 1 `watch([...], cb)`, factory `emptyPane(id)` extrait (8 duplications supprimées), suppression code commenté mort
- `electron/main.cjs` : tous les `require("child_process")` centralisés en haut, helper `getWindowFromEvent(event)` extrait (déduplication lookup fenêtre par webContents), helper `parseWslPath()` + regex WSL partagées, `buildShellScript()` factorisé (macOS/WSL), logs de démarrage réduits, helper `installBlock()` pour génération bat WSL
- `server/routes/_terminal.ts` : `getShellConfig()` extrait (shell + args + cwd selon plateforme/WSL), `cleanupPty()` dédupliqué (close/error handlers), regex WSL partagées

## Stack technique

- **Nuxt** 4.x
- **Vue** 3.5.x
- **Monaco Editor** 0.53.0
- **@nuxt/ui** 3.3.x + **@nuxt/ui-pro** 3.3.x
- **Tailwind CSS** (via @nuxt/ui)
- **@xterm/xterm** 6.0.0 + **@xterm/addon-fit** 0.11.0 + **@xterm/addon-web-links** 0.12.0
- **node-pty** 1.1.0 (PTY backend pour le terminal local)
- **ssh2** (connexion SSH + SFTP pour le mode distant)
- **Electron** 36.x (desktop wrapper)
- **electron-builder** 26.x (packaging installateurs)
