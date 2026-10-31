# M AppHub

Dashboard nhỏ, nhẹ để xem các app của Mondiro trên GitHub: tên, mô tả 1 dòng, bản mới nhất, nền tảng (PC / Android), chia nhóm tuỳ ý.

- **Windows**: tải `M-AppHub-Setup-x.y.z.exe` ở mục Releases. App tự kiểm tra và cài bản mới.
- **Android (Z Fold 7) / web**: mở https://satthupc00.github.io/M-App-Hub/ rồi "Thêm vào màn hình chính".

Thư mục `docs/` là toàn bộ app (HTML + JS thuần, không framework). Electron chỉ bọc lại để chạy trên Windows.

## Phát hành bản mới
1. Tăng `version` trong `package.json` và cập nhật `docs/whatsnew.json` (cùng số version).
2. `node scripts/sync-version.js`, commit.
3. Chạy workflow **Release Windows** (Actions → Run workflow) hoặc push tag `vX.Y.Z` → GitHub Actions build installer Windows, đăng lên Releases kèm nội dung từ `whatsnew.json`; web tự deploy lên Pages khi `docs/` thay đổi.

Lần đầu cần bật GitHub Pages: Settings → Pages → Source: **GitHub Actions**.

Created by Mondiro
