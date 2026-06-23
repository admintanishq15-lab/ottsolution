import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, 'dist');
const destDir = path.join(__dirname, '../backend/dist');

function copyFolderSync(from, to) {
  if (!fs.existsSync(to)) {
    fs.mkdirSync(to, { recursive: true });
  }
  fs.readdirSync(from).forEach((element) => {
    const srcElement = path.join(from, element);
    const destElement = path.join(to, element);
    if (fs.lstatSync(srcElement).isDirectory()) {
      copyFolderSync(srcElement, destElement);
    } else {
      fs.copyFileSync(srcElement, destElement);
    }
  });
}

try {
  console.log(`[Copy] Copying ${srcDir} to ${destDir}...`);
  // Ensure destination is clean
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
  copyFolderSync(srcDir, destDir);
  console.log('[Copy] Copy completed successfully.');
} catch (err) {
  console.error('[Copy] Copy failed:', err);
  process.exit(1);
}
