const { spawn } = require('child_process');
const path = require('path');

const pythonPath = path.join(__dirname, '.venv', 'Scripts', 'python.exe');
const serverPath = path.join(__dirname, 'owl_unified_server.py');

// Spawn the Python unified server and inherit stdio streams for transparent MCP protocol transport
const child = spawn(pythonPath, [serverPath], {
  stdio: 'inherit'
});

child.on('exit', (code) => {
  process.exit(code || 0);
});

child.on('error', (err) => {
  console.error("Failed to start OWL Unified Python server wrapper:", err);
  process.exit(1);
});
