// Run after the production frontend build. Produces the dedicated Hostinger document root.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
execFileSync('npm', ['run', 'build'], { cwd: path.join(root, 'frontend'), stdio: 'inherit', env: { ...process.env, CI: 'true', REACT_APP_ADMIN_MODE: 'true' } });
const target = path.join(root, 'dist', 'admin');
fs.mkdirSync(target, { recursive: true });
fs.cpSync(path.join(root, 'frontend', 'build'), target, { recursive: true });
const index = fs.readFileSync(path.join(target, 'index.html'), 'utf8')
  .replace(/<title>.*?<\/title>/s, '<title>Crestus Admin</title>')
  .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?\s*>/g, '')
  .replace('</head>', '<meta name="robots" content="noindex,nofollow"/><meta name="description" content="Crestus administrator workspace"/></head>');
fs.writeFileSync(path.join(target, 'index.html'), index);
fs.writeFileSync(path.join(target, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
fs.writeFileSync(path.join(target, '.htaccess'), `DirectoryIndex index.html
Options -Indexes
<IfModule mod_rewrite.c>
RewriteEngine On
RewriteBase /
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.html [L]
</IfModule>
<IfModule mod_headers.c>
Header always set X-Robots-Tag "noindex, nofollow"
<Files "index.html">
Header set Cache-Control "no-cache"
</Files>
</IfModule>
`);
const output = path.join(root, 'output');
fs.mkdirSync(output, { recursive: true });
const archive = path.join(output, 'crestus-admin-hostinger.zip');
// Use a fresh archive; zip otherwise retains obsolete hashed assets from older builds.
const temporaryArchive = path.join(output, `crestus-admin-${Date.now()}.zip`);
execFileSync('/usr/bin/zip', ['-qr', temporaryArchive, '.'], { cwd: target });
fs.renameSync(temporaryArchive, archive);
console.log(`Admin document root: ${target}\nHostinger archive: ${archive}`);
