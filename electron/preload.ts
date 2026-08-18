import { contextBridge, ipcRenderer } from "electron";

// Preload: the renderer is sandboxed (contextIsolation: true, sandbox: true),
// so it cannot touch Node/Electron directly. This bridge exposes a single,
// safe channel for native app-menu events (e.g. File → New Conversation) so
// the React app can react to menu items without broad exposure.
//
// Keep this surface tiny and intentional — every method here is a deliberate
// capability the renderer is granted. Do not expose ipcRenderer itself.
const api = {
  onMenuAction: (callback: (action: string) => void) => {
    const handler = (_event: unknown, action: string) => callback(action);
    ipcRenderer.on("menu:action", handler);
    return () => ipcRenderer.removeListener("menu:action", handler);
  },
};

export type LoomNativeAPI = typeof api;

contextBridge.exposeInMainWorld("loomNative", api);