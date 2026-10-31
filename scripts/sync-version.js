// Đồng bộ version từ package.json sang docs/version.js (bản web + Electron dùng chung).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const v = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
fs.writeFileSync(path.join(root, 'docs', 'version.js'), `window.APP_VERSION = '${v}';\n`);
const wn = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'whatsnew.json'), 'utf8'));
if (wn.version !== v) { console.error(`whatsnew.json đang ghi v${wn.version} nhưng package.json là v${v} — cập nhật whatsnew.json trước khi phát hành.`); process.exit(1); }
console.log('version', v);
