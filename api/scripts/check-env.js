const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const ignoredDirs = new Set(['node_modules', '.git']);
const ignoredFiles = new Set(['config.js', 'check-env.js', 'scripts/check-env.js', 'ecosystem.config.js']);

function collectFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      files.push(...collectFiles(path.join(dir, entry.name)));
    } else if (entry.isFile()) {
      if (!entry.name.endsWith('.js')) continue;
      if (ignoredFiles.has(entry.name)) continue;
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

function findViolations(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const matches = [];
  lines.forEach((line, index) => {
    if (line.includes('process.env')) {
      matches.push({ line: index + 1, content: line.trim() });
    }
  });
  return matches;
}

const jsFiles = collectFiles(rootDir);
const violations = [];

for (const file of jsFiles) {
  const hits = findViolations(file);
  if (hits.length > 0) {
    violations.push({ file, hits });
  }
}

if (violations.length > 0) {
  console.error('❌ process.env usage found outside api/config.js:\n');
  violations.forEach(({ file, hits }) => {
    hits.forEach((hit) => {
      console.error(`${file}:${hit.line}: ${hit.content}`);
    });
  });
  process.exit(1);
}

console.log('✅ No process.env usage found outside api/config.js');
