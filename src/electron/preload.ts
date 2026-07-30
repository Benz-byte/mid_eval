import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  flaskUrl: 'http://127.0.0.1:5000',
})
