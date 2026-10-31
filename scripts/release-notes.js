// Tạo nội dung GitHub Release từ docs/whatsnew.json
const fs = require('fs'), path = require('path');
const w = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'whatsnew.json'), 'utf8'));
const sec = (t, a) => a && a.length ? `### ${t}\n${a.map(x => '- ' + x).join('\n')}\n\n` : '';
let out = `## M AppHub v${w.version} · ${w.date}\n\n` + sec('Mới', w.new) + sec('Cải thiện', w.improved) + sec('Sửa lỗi', w.fixed);
out += `**Windows:** tải file \`M-AppHub-Setup-${w.version}.exe\` bên dưới (bản đã cài sẽ tự cập nhật).\n**Android / web:** mở https://satthupc00.github.io/M-App-Hub/\n`;
fs.writeFileSync(process.argv[2] || 'release-notes.md', out);
