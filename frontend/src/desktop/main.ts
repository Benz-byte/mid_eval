import { app, BrowserWindow, dialog } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { isDev } from './environment.js'
import { stopBackendProcess } from './backendProcess.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let flaskProcess: ChildProcess | null = null

function startFlask(): void {
  const backendCommand = isDev()
    ? process.platform === 'win32' ? 'python' : 'python3'
    : path.join(
        process.resourcesPath,
        'backend-bin',
        process.platform === 'win32' ? 'auto-scheduler-backend.exe' : 'auto-scheduler-backend',
      )
  const backendArguments = isDev()
    ? [path.join(process.cwd(), 'backend', 'app.py')]
    : []

  flaskProcess = spawn(backendCommand, backendArguments, {
    stdio: 'pipe',
    env: { ...process.env },
    windowsHide: true,
  })

  flaskProcess.stdout?.on('data', (data: Buffer) => {
    console.log(`[Flask] ${data.toString().trim()}`)
  })

  flaskProcess.stderr?.on('data', (data: Buffer) => {
    console.error(`[Flask] ${data.toString().trim()}`)
  })

  flaskProcess.on('close', (code: number | null) => {
    console.log(`[Flask] process exited with code ${code}`)
    flaskProcess = null
  })

  flaskProcess.on('error', (error: Error) => {
    console.error(`[Flask] failed to start: ${error.message}`)
  })
}

function stopFlask(): boolean {
  if (!flaskProcess) return true
  try {
    stopBackendProcess(flaskProcess)
    flaskProcess = null
    return true
  } catch (error) {
    console.error('[Flask] shutdown failed:', error)
    dialog.showErrorBox('Could not close the backend', 'The app could not stop its backend process. Try closing the app again.')
    return false
  }
}

app.on('ready', () => {
  // In dev, Flask is started by `npm run dev` — only auto-spawn in production
  if (!isDev()) startFlask()

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.on('close', event => {
    if (!stopFlask()) event.preventDefault()
  })

  if (isDev()) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), 'dist-react', 'index.html'))
  }

})

app.on('before-quit', event => {
  if (!stopFlask()) event.preventDefault()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
  else stopFlask()
})
