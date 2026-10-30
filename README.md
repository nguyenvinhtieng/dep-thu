# DÉP THỦ — Phase 1–3 (online 1v1)

Game ném dép 2D trong hẻm Sài Gòn. Monorepo npm workspaces:

| Thư mục | Nội dung |
|---|---|
| `shared/` | `@dep/shared`: sim tất định 60 Hz, config, codec nhị phân (input/snapshot/event), test Vitest |
| `server/` | Node + Colyseus 0.18 (uWebSockets): lobby, phòng `match`, tick 60 Hz, snapshot 30 Hz, bù trễ khi bắt dép |
| `client/` | TS + Vite + Phaser 3: UI DOM (tên, sảnh, phòng, chat), dự đoán/reconcile, nội suy thích ứng, netsim, overlay F3 |
| `tools/bot.ts` | Bot headless dùng đúng `NetMatch` của client — để thử online không cần trình duyệt |

## Chạy

```bash
npm install
```

Dev (server :2567 + Vite :5173, LAN mở sẵn `host: true`):

```bash
npm run dev
```

Prod (một tiến trình phục vụ `client/dist` + WebSocket trên :2567; build lại client thì khởi động lại server):

```bash
npm run build && npm start
```

Test sim + codec:

```bash
npm test
```

Bot:

```bash
npm run bots                                       # 2 bot tự tạo phòng riêng và đánh nhau
npm run bots -- --lag 120 --jitter 30 --loss 2 --matches 2
npm run bots -- --join ABCDE                       # 1 bot vào phòng mã ABCDE (người tạo trên trình duyệt)
```

Tuỳ chọn bot: `--server URL`, `--lag ms`, `--jitter ms`, `--loss %`, `--matches N`, `--duration giây`, `--wins N`, `--join CODE`. Env `DBG=1` in chi tiết mỗi lần reconcile lệch > 20 px.

URL client: `?room=CODE` vào thẳng phòng, `?server=URL` đổi server, `?lag=&jitter=&loss=` bật netsim (giả lập trễ hai chiều).

## Deploy Render — depthu.vinhtieng.com

1. Push repo (bao gồm `package-lock.json`, `render.yaml` và `client/public/brand/`) lên GitHub/GitLab/Bitbucket.
2. Trong Render chọn **New → Blueprint**, kết nối repo, chọn branch cần deploy và tạo Blueprint. Để Root Directory trống (gốc repo).
3. Render đọc `render.yaml`: Node 22.22.2, region Singapore, cài cả devDependencies để build/chạy `tsx`, build client, rồi chạy server. Không cần nhập biến môi trường hay URL WebSocket thủ công.
4. Khi service chạy, mở **Settings → Custom Domains** để xem `depthu.vinhtieng.com` đã được Blueprint thêm. Trong DNS của `vinhtieng.com`, tạo **CNAME** tên `depthu`, giá trị là hostname `*.onrender.com` thực tế Render cấp cho service (không có `https://` hay đường dẫn).
5. Bấm **Verify** cạnh domain trên Render. Render tự cấp HTTPS. Nếu dùng Cloudflare, đặt bản ghi ở **DNS only** khi xác minh; gỡ bản ghi A/AAAA cũ xung đột của riêng subdomain `depthu` nếu có.

Kiểm tra sau deploy: `https://depthu.vinhtieng.com/healthz` trả JSON `{"status":"ok"}`, trang chủ có banner/logo, tạo phòng và dùng tab/trình duyệt khác nhập mã để kiểm tra WebSocket. Ảnh chia sẻ nằm tại `/brand/banner.png`; canonical và OG đã trỏ đúng domain.

Blueprint chọn compute **Free**; bandwidth/build vẫn theo hạn mức tài khoản Render. Free ngủ khi không có traffic nên lượt vào đầu có thể phải chờ; có thể đổi sang gói trả phí trên Render nếu cần luôn sẵn sàng. Giữ **1 instance**: phòng game hiện lưu trong RAM, chưa có Redis/shared presence để chạy nhiều instance. Deploy lại/restart làm mất phòng hiện tại; không cần database cho phiên bản này.

Tham khảo: [Blueprint](https://render.com/docs/blueprint-spec), [custom domain/DNS](https://render.com/docs/custom-domains), [WebSocket](https://render.com/docs/websocket), [giới hạn Free](https://render.com/docs/free).

## Điều khiển

| Hành động | Phím mặc định |
|---|---|
| Sang trái / phải | A / D hoặc ← / → |
| Nhảy | W, ↑, Space |
| Ném | giữ J hoặc F để gồng, thả để ném |
| Bắt dép | K hoặc G |
| Bảng thông số mạng | F3 |

- Đổi phím: bấm ô phím trong bảng ở màn phòng hoặc nút ⌨️ trong trận (Esc huỷ); lưu localStorage.
- Trang không cuộn khi bấm phím trừ lúc đang gõ chữ; mất focus cửa sổ thì nhả hết phím; trận online không tạm dừng.

## Đã kiểm thử thật (máy local, Node 22, macOS)

- `npm test`: 23/23 pass. `npm run build`: OK.
- 2 bot, không netsim, chạm 2: hết trận, rtt ~1 ms, nội suy 59 ms, 30 snap/s, client nhận ~2.8 KB/s / gửi 0.43 KB/s, reconcile 0 px.
- 2 bot, `lag 120 jitter 30 loss 2`, 2 trận: cả 2 trận xong (đấu lại chạy), rtt 133–176 ms, nội suy 87–125 ms, 27–35 snap/s, nhận 2.5–3.2 KB/s.
  Server 1 phòng: gửi ~5 KB/s, tick trung bình 0.02–0.04 ms, max ≤ 0.28 ms.
- `lag 120 jitter 30` không mất gói: lệch reconcile ngoài lúc bị trúng phần lớn 0 px, tối đa 11 px.
- Trình duyệt (bản prod, `?lag=120&jitter=30`) đấu với bot `--join`: màn tên, sảnh, tạo phòng có mã, bot vào phòng, bảng thành viên (sẵn sàng, ping, nút trao chủ/mời ra), chat, đếm ngược, HUD, di chuyển/nhảy/ném, overlay F3; hết trận hiện bảng kết quả "Bạn thắng!" kèm bộ đếm đấu lại; bot rớt mạng quá lâu → xử thua và quay về phòng.

**Chưa kiểm thử:** xem trận (spectate) trên trình duyệt, kick/trao chủ bằng tay, kết nối lại sau F5, danh sách phòng công khai trên sảnh trình duyệt, đổi phím bằng UI, nhả phím khi blur, `npm run dev` (chế độ Vite dev), hai người thật trên hai máy.

## Hạn chế

- Thông tin phòng gửi JSON (không dùng Schema); snapshot gửi đầy đủ, chưa nén delta.
- Phase 4–6 chưa làm; hình là placeholder vẽ bằng Phaser Graphics; chưa kèm font tiếng Việt.
- Knockback khi trúng do server quyết, không dự đoán được → nhân vật bị giật về vị trí server (lệch 100–150 px lúc trúng/đổi hiệp).
- Netsim mô phỏng mất gói như TCP gửi lại (chặn đầu hàng) → buffer input server cạn rồi bỏ input; ở 2% loss lệch reconcile 20–60 px (có lần 126 px).
- Dép "bóng ma" khi ném dự đoán có thể nhảy hình nhẹ lúc khớp với dép thật từ server.
- `npm audit` báo 3 lỗ hổng trong dependency (chưa xử lý).
- AI bot rất đơn giản, chỉ để thử mạng.
