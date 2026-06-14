const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Enter your Chrome Extension ID (from chrome://extensions): ', (extId) => {
  extId = extId.trim();
  if (!extId) {
    console.error("Extension ID cannot be empty.");
    process.exit(1);
  }

  const manifestPath = path.join(__dirname, 'com.edgetts.host.json');
  const batPath = path.join(__dirname, 'tts-host.bat');
  
  // Create JSON manifest
  const manifest = {
    name: "com.edgetts.host",
    description: "Edge TTS Host",
    path: batPath,
    type: "stdio",
    allowed_origins: [
      `chrome-extension://${extId}/`
    ]
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Created manifest at: ${manifestPath}`);

  // Add registry key
  try {
    const regCommand = `REG ADD "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.edgetts.host" /ve /t REG_SZ /d "${manifestPath}" /f`;
    execSync(regCommand, { stdio: 'inherit' });
    console.log("Successfully added registry key.");
  } catch (e) {
    console.error("Failed to add registry key.", e);
  }

  rl.close();
});
