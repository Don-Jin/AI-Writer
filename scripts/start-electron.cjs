// 启动 Electron，确保清除 ELECTRON_RUN_AS_NODE 环境变量
// 因为 Electron C++ 层检查的是 env var 是否存在，而非是否为空
delete process.env.ELECTRON_RUN_AS_NODE;

const { spawn } = require('child_process');
const child = spawn('npx', ['electron', '.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: 'http://localhost:5173' },
  shell: true,
});

child.on('exit', (code) => process.exit(code || 0));
