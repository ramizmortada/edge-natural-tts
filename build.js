const fs = require('fs');
const { execSync } = require('child_process');

console.log("Cleaning out directory...");
fs.rmSync('out', { recursive: true, force: true });
fs.mkdirSync('out', { recursive: true });

let start = Date.now();
console.log("Copying public files...");
fs.cpSync('public', 'out', { recursive: true });

console.log("Building popup script...");
execSync('npx esbuild src/popup/index.ts --bundle --outfile=out/popup.js --format=iife --target=es2020', { stdio: 'inherit' });
console.log('Done in ' + (Date.now() - start) + 'ms');

start = Date.now();
console.log("Building content script...");
execSync('npx esbuild src/content/index.ts --bundle --outfile=out/content.js --format=iife --target=es2020 --platform=browser');
console.log('Done in ' + (Date.now() - start) + 'ms');

start = Date.now();
console.log('Building background script...');
execSync('npx esbuild src/background/index.ts --bundle --outfile=out/background.js --format=esm --target=es2020 --platform=browser');
console.log('Done in ' + (Date.now() - start) + 'ms');

console.log("Build complete!");
