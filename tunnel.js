import { spawn } from 'child_process';

console.log('Starting Permanent Tunnel (Localtunnel)...');

const tunnel = spawn('npx', ['localtunnel', '--port', '3001', '--subdomain', 'bfi-classroom-live'], { 
  shell: true,
  stdio: 'inherit'
});

tunnel.on('close', (code) => {
  console.log(`Tunnel process exited with code ${code}`);
});
