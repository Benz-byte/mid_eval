import { spawnSync } from 'node:child_process'

const candidates = process.platform === 'win32'
  ? [
      { command: 'python', args: [] },
      { command: 'py', args: ['-3'] },
    ]
  : [
      { command: 'python3', args: [] },
      { command: 'python', args: [] },
    ]

const python = candidates.find(({ command, args }) => {
  const result = spawnSync(command, [...args, '--version'], { stdio: 'ignore' })
  return result.status === 0
})

if (!python) {
  console.error(
    '\nPython 3 was not found. Install Python 3.10 or newer, then run npm install again.\n',
  )
  process.exit(1)
}

console.log(`Installing Python packages with ${python.command}...`)

const result = spawnSync(
  python.command,
  [...python.args, '-m', 'pip', 'install', '-r', 'python/requirements.txt'],
  { stdio: 'inherit' },
)

if (result.status !== 0) {
  console.error('\nPython package installation failed.\n')
  process.exit(result.status ?? 1)
}
