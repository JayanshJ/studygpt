import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, Menu, shell, ipcMain } from "electron";
// Next's programmatic server start. Importing this and calling startServer()
// runs the production server IN-PROCESS — no child process, no spawning a
// binary from inside the asar (which fails with ENOTDIR because asar paths
// aren't real executables). Resolves once the server is listening.
import { startServer } from "next/dist/server/lib/start-server.js";
// Electron main process for Loom.
//
// Lifecycle: on app ready, start the Next.js production server IN-PROCESS on
// a free-ish port via startServer(), then open a single BrowserWindow pointed
// at it. The SQLite db lives in the per-user Application Support directory so
// it survives app updates and is never inside the .app bundle. Ollama is
// expected to already be running on localhost:11434 (same as `npm run dev`) —
// the app does not manage it.
//
// Personal-use build: no code signing / notarization. Gatekeeper's
// "right-click → Open" works for an unsigned .app on the developer's own Mac(s).
const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 59171; // fixed-ish; unlikely to collide with `next dev` on 3000
let mainWindow = null;
// Resolve the project root lazily — app.getAppPath() is only valid after the
// app is ready. In dev this is the repo root (one level above electron/).
// In a packaged app, app.getAppPath() is the asar root, which IS where .next
// and node_modules live (electron-builder packs them into the asar, and Next's
// startServer reads through the asar transparently).
function projectRoot() {
    return app.isPackaged ? app.getAppPath() : resolve(__dirname, "..");
}
// Where the SQLite db lives. ~/Library/Application Support/Loom/studygpt.db on
// macOS — Apple's sanctioned per-user app data location. Keeps the DB out of
// the bundle so updates don't clobber it, and the bundle stays read-only.
function userDataDbPath() {
    const dir = app.getPath("userData");
    return join(dir, "studygpt.db");
}
// Start the Next production server in-process. startServer resolves once the
// HTTP server is listening on PORT. The server lives in this process, so when
// the app quits the server goes with it — no orphaned child process to kill.
async function startNextServer() {
    const root = projectRoot();
    // Set the DB path before any route module imports the db singleton. In dev
    // this also needs NODE_ENV so Next doesn't think it's a dev server.
    process.env.NODE_ENV = "production";
    process.env.PORT = String(PORT);
    process.env.DATABASE_URL = userDataDbPath();
    await startServer({
        dir: root,
        port: PORT,
        hostname: "127.0.0.1",
        isDev: false,
        allowRetry: false,
        customServer: true,
    });
}
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 832,
        minWidth: 640,
        minHeight: 480,
        // macOS vibrancy: the window uses a translucent material so the sidebar
        // (whose React background is transparent) shows the blurred desktop
        // wallpaper behind it, like ChatGPT/Claude's native Mac apps. No
        // backgroundColor — vibrancy supplies the surface.
        vibrancy: "under-window",
        visualEffectState: "active",
        // Hidden-inset titlebar gives the clean look, with the traffic-light
        // buttons floating over the vibrancy sidebar. Equal inset from the top
        // and left edges (20px / 20px). The sidebar's first nav row sits below
        // this (pt-10 / 40px top padding reserved for the lights).
        titleBarStyle: "hiddenInset",
        trafficLightPosition: { x: 20, y: 20 },
        webPreferences: {
            // The renderer is the Next.js web app talking to its own server over
            // localhost. No nodeIntegration. A preload exposes a tiny safe bridge
            // for native menu actions (File → New Conversation, etc.) via
            // contextBridge, so the sandboxed renderer can hear the menu without
            // touching Electron APIs directly.
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            preload: join(__dirname, "preload.mjs"),
        },
    });
    mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);
    // Open external links (http/https) in the user's browser, not the app window.
    // The app's own links are all same-origin relative, so this only catches
    // genuine external hrefs.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("http://") || url.startsWith("https://")) {
            void shell.openExternal(url);
            return { action: "deny" };
        }
        return { action: "allow" };
    });
    buildAppMenu();
}
// Send a menu action to the focused window's renderer. The renderer listens
// via the preload's loomNative.onMenuAction and routes each action to the
// matching handler (e.g. "new-conversation" → newConversation()).
function sendMenuAction(action) {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
    win?.webContents.send("menu:action", action);
}
// Native macOS application menu: Loom (About/Quit), File (New/Close), Edit
// (standard text-edit + Undo/Redo), View (Toggle Sidebar), Window (standard),
// Help. This is what makes the app read as a proper Mac citizen — the menu
// bar at the top of the screen, with standard shortcuts and roles.
function buildAppMenu() {
    const isMac = process.platform === "darwin";
    const template = [
        ...(isMac
            ? [{
                    label: app.name,
                    submenu: [
                        { role: "about" },
                        { type: "separator" },
                        { role: "services" },
                        { type: "separator" },
                        { role: "hide" },
                        { role: "hideOthers" },
                        { role: "unhide" },
                        { type: "separator" },
                        { role: "quit" },
                    ],
                }]
            : []),
        {
            label: "File",
            submenu: [
                { label: "New Conversation", accelerator: "CmdOrCtrl+N", click: () => sendMenuAction("new-conversation") },
                { type: "separator" },
                { label: "Close Window", accelerator: "CmdOrCtrl+W", role: "close" },
            ],
        },
        {
            label: "Edit",
            submenu: [
                { role: "undo" },
                { role: "redo" },
                { type: "separator" },
                { role: "cut" },
                { role: "copy" },
                { role: "paste" },
                { role: "pasteAndMatchStyle" },
                { role: "delete" },
                { role: "selectAll" },
                { type: "separator" },
                { label: "Find…", accelerator: "CmdOrCtrl+F", click: () => sendMenuAction("search") },
            ],
        },
        {
            label: "View",
            submenu: [
                { label: "Toggle Sidebar", accelerator: "CmdOrCtrl+\\", click: () => sendMenuAction("toggle-sidebar") },
                { type: "separator" },
                { role: "reload" },
                { role: "forceReload" },
                { role: "toggleDevTools" },
                { type: "separator" },
                { role: "resetZoom" },
                { role: "zoomIn" },
                { role: "zoomOut" },
                { type: "separator" },
                { role: "togglefullscreen" },
            ],
        },
        {
            label: "Window",
            submenu: [
                { role: "minimize" },
                { role: "zoom" },
                { type: "separator" },
                { role: "front" },
            ],
        },
        {
            label: "Help",
            submenu: [{ label: "Loom Help", click: () => sendMenuAction("help") }],
        },
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}
// Keep ipcMain warm — the renderer's onMenuAction subscribes to "menu:action".
// No-arg setup; the channel is created on demand by .send above.
ipcMain.handle("menu:ping", () => true);
// Single-instance: a second launch focuses the existing window instead of
// starting a second server on a port that's already taken.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
}
else {
    app.on("second-instance", () => {
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            mainWindow.focus();
        }
    });
    app.whenReady().then(async () => {
        // Verify the production build exists — a common failure is launching the
        // packaged app without having run `next build`.
        if (!existsSync(join(projectRoot(), ".next", "BUILD_ID"))) {
            console.error("[loom] No production build found (.next/BUILD_ID missing). Run `npm run build` before packaging.");
            app.quit();
            return;
        }
        try {
            await startNextServer();
        }
        catch (err) {
            console.error(`[loom] Next server failed to start: ${err instanceof Error ? err.message : err}`);
            app.quit();
            return;
        }
        createWindow();
    });
    app.on("window-all-closed", () => {
        // The Next server runs in-process, so quitting the app tears it down
        // automatically — no headless server lingers on the port. (We intentionally
        // deviate from the macOS "keep alive with no window" convention because a
        // local app with an embedded server should not keep serving with no UI.)
        app.quit();
    });
}
