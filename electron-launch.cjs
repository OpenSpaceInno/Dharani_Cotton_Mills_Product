const { spawn } = require('child_process');
const electron = require('electron');

const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.'], {
  cwd: __dirname,
  env,
  stdio: 'ignore',
  detached: true,
  windowsHide: false,
});

child.unref();
console.log('Electron launched in background');
process.exit(0);
