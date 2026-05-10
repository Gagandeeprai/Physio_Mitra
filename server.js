const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const { spawn } = require('child_process');
const path    = require('path');
const readline = require('readline');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

const PYTHON_SCRIPT = path.join(__dirname, 'backend.py');
const PYTHON_CMDS   = ['python', 'py', 'python3'];  // tried in order

app.use(express.static(path.join(__dirname, 'public')));

let pyProc   = null;
let rl       = null;

function trySpawn(cmds, args, opts) {
  for (const cmd of cmds) {
    try {
      const p = spawn(cmd, args, opts);
      // If spawn would have thrown synchronously it already did; otherwise assume ok
      return { proc: p, cmd };
    } catch (e) { /* try next */ }
  }
  return null;
}

function spawnPython() {
  const result = trySpawn(PYTHON_CMDS, ['-u', PYTHON_SCRIPT], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  if (!result) {
    console.error('[server] Could not find Python. Make sure python/py is in PATH.');
    return;
  }

  pyProc = result.proc;
  console.log(`[server] Spawned background Python via "${result.cmd}"`);

  pyProc.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg) console.error('[PY stderr]', msg);
  });

  pyProc.on('error', (err) => {
    console.error('[server] Failed to start Python:', err.message);
    pyProc = null;
  });

  pyProc.on('close', (code) => {
    console.log('[server] Python exited with code', code);
    pyProc = null;
    // Auto-restart background process if it dies
    setTimeout(spawnPython, 2000);
  });

  rl = readline.createInterface({ input: pyProc.stdout });
  rl.on('line', (line) => {
    try {
      const data = JSON.parse(line);
      io.emit('py_event', data);
    } catch (_) { }
  });
}

// Start python immediately in the background
spawnPython();

io.on('connection', (socket) => {
  console.log('Browser connected:', socket.id);

  socket.on('start', (config) => {
    console.log('Starting session with config:', config);
    if (pyProc && pyProc.stdin.writable) {
      pyProc.stdin.write(JSON.stringify({ type: 'config', ...config }) + '\n');
    }
  });

  socket.on('stop', () => {
    if (pyProc && pyProc.stdin.writable) {
      pyProc.stdin.write(JSON.stringify({ type: 'stop' }) + '\n');
    }
    io.emit('py_event', { type: 'stopped' });
  });

  // Next set — send command to running python process
  socket.on('next_set', (data) => {
    if (pyProc && pyProc.stdin.writable) {
      pyProc.stdin.write(JSON.stringify({ type: 'next_set', ...data }) + '\n');
    }
  });

  socket.on('disconnect', () => {
    console.log('Browser disconnected:', socket.id);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`\n✅  Physiotherapy UI running at http://localhost:${PORT}\n`);
});
