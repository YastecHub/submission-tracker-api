const cp = require('child_process');
const fs = require('fs');

console.log('Generating Prisma client...');
try {
  cp.execSync('npx prisma generate', { stdio: 'inherit' });
} catch (error) {
  // On Windows, if dev server is actively running, query_engine DLL is locked by the node process
  if (process.platform === 'win32' && fs.existsSync('node_modules/.prisma/client/index.js')) {
    console.warn('\n[warn] Prisma client is already present. Skipped regeneration due to Windows file lock from running dev server.');
    try {
      const dir = 'node_modules/.prisma/client';
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) {
          if (f.includes('.tmp')) {
            try { fs.unlinkSync(`${dir}/${f}`); } catch {}
          }
        }
      }
    } catch {}
  } else {
    throw error;
  }
}

console.log('Compiling TypeScript...');
cp.execSync('npx tsc', { stdio: 'inherit' });
console.log('Build complete!');
