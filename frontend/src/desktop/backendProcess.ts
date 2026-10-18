import { spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'

/** Wait for Windows to stop this app's backend and its PyInstaller child. */
export function stopBackendProcess(child: ChildProcess, platform = process.platform, run = spawnSync): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  if (platform !== 'win32') {
    if (!child.kill('SIGTERM')) throw new Error('Could not stop the backend process.')
    return
  }
  const result = run('taskkill.exe', ['/pid', String(child.pid), '/f', '/t'], {
    windowsHide: true, timeout: 10000, encoding: 'utf8',
  })
  if (!result.error && result.status === 0) return
  // The backend may have exited by itself before taskkill reached it.
  try { process.kill(child.pid, 0) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return }
  throw new Error(result.error?.message || String(result.stderr).trim() || 'Could not stop the backend process tree.')
}
