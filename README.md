# M AppHub

Dashboard nhỏ, nhẹ để xem các app của Mondiro trên GitHub: tên, mô tả 1 dòng, bản mới nhất, nền tảng (PC / Android), chia nhóm tuỳ ý.

- **Windows**: tải `M-AppHub-Setup-x.y.z.exe` ở mục Releases. App tự kiểm tra và cài bản mới.
- **Android (Z Fold 7) / web**: mở https://satthupc00.github.io/M-App-Hub/ rồi "Thêm vào màn hình chính".

Thư mục `docs/` là toàn bộ app (HTML + JS thuần, không framework). Electron chỉ bọc lại để chạy trên Windows.

## Phát hành bản mới
1. Tăng `version` trong `package.json` và cập nhật `docs/whatsnew.json` (cùng số version).
2. `node scripts/sync-version.js`, commit.
3. Tạo tag `vX.Y.Z` và push → GitHub Actions tự build installer Windows và đăng lên Releases; web tự deploy lên Pages.

Created by Mondiro
