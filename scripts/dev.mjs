// Sobe backend (porta 3001) e frontend Vite (porta 5173) juntos em modo desenvolvimento.
import { spawn } from 'node:child_process';

const procs = [
  spawn('node', ['--watch', 'backend/src/server.js'], { stdio: 'inherit' }),
  spawn('npm', ['run', 'dev', '-w', 'frontend'], { stdio: 'inherit', shell: process.platform === 'win32' }),
];

const stop = () => {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => { if (code) stop(); });
