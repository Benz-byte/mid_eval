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
  console.error('Python 3 was not found. Install the development requirements before packaging.')
  process.exit(1)
}

const result = spawnSync(
  python.command,
  [
    ...python.args,
    '-m',
    'PyInstaller',
    '--noconfirm',
    '--clean',
    '--onefile',
    '--name',
    'auto-scheduler-backend',
    '--distpath',
    'dist-backend',
    '--workpath',
    'build-backend/work',
    '--specpath',
    'build-backend',
    '--paths',
    'backend',
    '--collect-all',
    'ortools',
    'backend/app.py',
  ],
  { stdio: 'inherit' },
)

if (result.status !== 0) {
  console.error('Standalone backend packaging failed.')
  process.exit(result.status ?? 1)
}
