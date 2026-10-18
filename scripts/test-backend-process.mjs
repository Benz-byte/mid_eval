import './register-typescript.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
const { stopBackendProcess: stop } = await import('../frontend/src/desktop/backendProcess.ts')
const fake = { pid: process.pid, exitCode: null, signalCode: null, kill: () => true }
let calls = 0
stop(fake, 'win32', (command, args, options) => {
  calls++
  assert.equal(command, 'taskkill.exe')
  assert.deepEqual(args, ['/pid', String(process.pid), '/f', '/t'])
  assert.equal(options.windowsHide, true)
  assert.equal(options.timeout, 10000)
  return { status: 0 }
})
assert.equal(calls, 1)
for (const inactive of [{ ...fake, exitCode: 0 }, { ...fake, signalCode: 'SIGTERM' }, { ...fake, pid: undefined }]) {
  stop(inactive, 'win32', () => { throw Error('Must not kill an inactive process') })
}
assert.throws(() => stop(fake, 'win32', () => ({ status: 1, stderr: 'Access denied' })), /Access denied/)
assert.throws(() => stop(fake, 'win32', () => ({ status: null, error: Error('Timed out') })), /Timed out/)
stop({ ...fake, kill: signal => { assert.equal(signal, 'SIGTERM'); return true } }, 'linux')
assert.throws(() => stop({ ...fake, kill: () => false }, 'linux'), /Could not stop/)
console.log('Backend shutdown unit checks passed: exact owned PID, full tree, synchronous completion, hidden execution, and failure handling.')

if (process.argv.includes('--integration')) {
  assert.equal(process.platform, 'win32', 'This integration check targets Windows process-tree cleanup')
  const tree = spawn(process.execPath, ['-e', `
    const {spawn}=require('node:child_process');
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
    console.log(JSON.stringify({root:process.pid,child:child.pid}));
    setInterval(()=>{},1000);
  `], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
  let childPid
  try {
    const [output] = await once(tree.stdout, 'data')
    const ids = JSON.parse(output.toString())
    childPid = ids.child
    assert.ok(alive(ids.root) && alive(childPid))
    const closed = once(tree, 'close')
    stop(tree)
    await closed
    for (let attempt = 0; attempt < 40 && alive(childPid); attempt++) await new Promise(resolve => setTimeout(resolve, 50))
    assert.ok(!alive(ids.root) && !alive(childPid), 'Both disposable processes must be gone')
    console.log('Windows integration passed: the backend-like parent and its child are both terminated before shutdown finishes.')
  } finally {
    if (tree.pid && alive(tree.pid)) stop(tree)
    if (childPid && alive(childPid)) stop({ ...fake, pid: childPid })
  }
}
