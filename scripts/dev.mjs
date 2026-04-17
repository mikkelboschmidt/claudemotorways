import { spawn } from 'node:child_process';

const rawArgs = process.argv.slice(2);

function parseHostArg(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--host') {
      const next = args[i + 1];
      return next && !next.startsWith('-') ? next : '0.0.0.0';
    }
    if (arg.startsWith('--host=')) {
      const value = arg.slice('--host='.length);
      return value || '0.0.0.0';
    }
  }
  return undefined;
}

const host = parseHostArg(rawArgs) ?? process.env.HOST ?? '0.0.0.0';

function spawnChild(command, args, env = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  return child;
}

const clientArgs = ['run', 'dev:client'];
if (rawArgs.length > 0) {
  clientArgs.push('--', ...rawArgs);
}

const client = spawnChild('npm', clientArgs);
const server = spawnChild('npm', ['run', 'dev:server'], { HOST: host });

let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  client.kill('SIGTERM');
  server.kill('SIGTERM');
  process.exitCode = exitCode;
}

client.on('exit', (code, signal) => {
  if (signal) {
    shutdown(0);
    return;
  }
  shutdown(code ?? 0);
});

server.on('exit', (code, signal) => {
  if (signal) {
    shutdown(0);
    return;
  }
  shutdown(code ?? 0);
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
