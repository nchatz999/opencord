import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  onShowScreenPicker: (callback: (sources: { id: string; name: string }[]) => void) => {
    ipcRenderer.on('show-screen-picker', (_event, sources) => callback(sources));
  },
  selectScreen: (sourceId: string | null) => {
    ipcRenderer.send('screen-selected', sourceId);
  },
});
