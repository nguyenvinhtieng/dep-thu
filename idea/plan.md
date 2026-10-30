# DÉP THỦ — Prompt kế hoạch triển khai chi tiết (game online)

> Prompt này là kế hoạch triển khai chi tiết cho `idea/init.md` (ý tưởng + luật chơi). **Luật chơi, cơ chế ném–bắt–nhặt, cảm giác chơi** lấy theo `init.md` (mục 3, 5, 6). Khi mâu thuẫn về công nghệ/netcode, tài liệu này thắng.

---

## 0. Vai trò & cách làm việc

Bạn là lập trình viên game web 2D **nhiều người chơi realtime**, có kinh nghiệm về netcode (server authoritative, client prediction, reconciliation, interpolation, lag compensation), game feel và tối ưu băng thông. Hãy xây dựng game **chơi được hoàn chỉnh qua mạng giữa các máy khác nhau**, không chỉ UI hay demo.

Nguyên tắc:
- Làm theo từng **Phase** (mục 11). Hết phase phải chạy được và qua checklist của phase rồi mới sang phase sau.
- Kiểm tra API theo **phiên bản thực tế đã cài** (`npm ls`, đọc type definitions), không đoán theo trí nhớ.
- **Đo trước khi tối ưu**: mọi quyết định về băng thông/độ trễ phải có số đo.
- Không tuyên bố đã kiểm tra những gì chưa thực sự chạy.
- Code ngắn gọn, dễ sửa, không trừu tượng hóa quá mức.

---

## 1. Tóm tắt sản phẩm

- Game đối kháng ném dép 2D, **chỉ chơi online**, mỗi người một máy (trình duyệt desktop).
- Phòng 2–5 người chơi, **chủ yếu 1v1**; có **người xem** (spectator) vào xem bất kỳ lúc nào.
- Có **sảnh danh sách phòng**, tạo phòng, vào phòng, chơi nhanh, vào bằng mã/link.
- **Không login, không database**: chỉ biệt danh + mã khách lưu trên trình duyệt.
- Đồ họa **Việt Nam dân dã**: con hẻm, dép tổ ong, nhân vật xóm (mục 9).

---

## 2. Đề xuất công nghệ (và lý do)

### 2.1 Bài toán độ trễ — điều gì thực sự gây lag
Theo thứ tự ảnh hưởng:
1. **Khoảng cách tới server** (RTT). Người chơi ở Việt Nam → server ở **Singapore** (RTT ~30–50 ms từ HN/HCM) hoặc VPS tại Việt Nam (~5–20 ms). Đặt server ở Mỹ/EU là lag nặng dù code tốt đến đâu.
2. **Netcode**: không có prediction/interpolation thì 40 ms ping cũng thấy giật. Có thì 120 ms vẫn chơi được.
3. **Mất gói trên TCP (WebSocket)**: một gói mất chặn các gói sau (head-of-line blocking) → giật vài trăm ms. Giảm bằng input dư thừa + jitter buffer thích ứng, hoặc dùng kênh kiểu UDP.
4. **Kích thước gói**: JSON 30 lần/giây lãng phí; dùng **binary**.

### 2.2 Stack đề xuất

| Lớp | Chọn | Lý do |
|---|---|---|
| Client render | **TypeScript + Vite + Phaser 3** (bản ổn định mới nhất), `Phaser.AUTO` | 2D nhẹ, WebGL, tween/particle sẵn. Chỉ dùng để **vẽ + input + hiệu ứng**, không dùng Arcade Physics cho gameplay. |
| Mô phỏng gameplay | **Tự viết, TS thuần, tất định**, package `shared` | Server và client chạy **cùng một code** → prediction khớp server, ít sai lệch. Arcade Physics không chạy headless tin cậy trên Node. |
| Server | **Node.js LTS + TypeScript + Colyseus** (transport **uWebSockets.js** — `@colyseus/uwebsockets-transport`) | Có sẵn room, matchmaking, `LobbyRoom` (danh sách phòng realtime), `allowReconnection`, metadata phòng. uWS nhanh và ít RAM hơn `ws` nhiều lần. |
| Kênh gameplay | **Message nhị phân** (`Uint8Array`) qua Colyseus (`room.send` bytes / `onMessage` bytes — kiểm tra API bản cài), **không dùng Schema state sync cho gameplay** | Tự đóng gói bằng `DataView`: input ~6–10 byte/gói, snapshot 1v1 ~60–90 byte. Schema chỉ dùng cho **metadata phòng** (danh sách người, ready, chủ phòng) vì đổi ít. |
| Kênh UDP-like (tùy chọn, Phase 6) | **WebTransport datagrams** hoặc **geckos.io** (WebRTC DataChannel unreliable/unordered) | Chỉ bật khi số đo cho thấy giật do mất gói trên WebSocket. Luôn giữ WebSocket làm fallback (mạng công ty/4G chặn UDP). Thiết kế lớp `Transport` mỏng từ đầu để thay được. |
| Đồng bộ thời gian | Ping/pong tự viết, ước lượng clock offset + RTT (trung vị 5–10 mẫu gần nhất) | Cần cho interpolation, lag compensation, đếm ngược khớp nhau. |
| Test | **Vitest** (sim + codec), **bot client headless** (Node) để chạy trận tự động | Kiểm tra tất định, bất biến số dép, tải server. |
| Deploy | 1 tiến trình Node phục vụ cả client tĩnh + WebSocket; **Fly.io region `sin`** hoặc VPS Singapore/Việt Nam; HTTPS/WSS; Docker | Gần người chơi Việt Nam nhất. |

### 2.3 Vì sao không chọn
- **P2P WebRTC + rollback (kiểu GGPO)**: cảm giác 1v1 tốt nhất, nhưng cần TURN server cho nhiều NAT, khó với 3–5 người + người xem, dễ gian lận, tất định khó hơn (float). Chỉ cân nhắc sau nếu 1v1 cạnh tranh là trọng tâm.
- **Socket.IO**: overhead thêm, tự làm lại room/lobby/reconnect — Colyseus đã có.
- **Firebase/Supabase realtime**: độ trễ và tần suất gửi không hợp game hành động 60 Hz.
- **Colyseus Schema cho toàn bộ state gameplay ở 30 Hz**: được, nhưng khó kiểm soát kích thước gói và thời điểm gửi; tự đóng gói binary nhỏ và rõ hơn.

---

## 3. Cấu trúc repo

npm workspaces:

```
dep-thu/
  package.json                # workspaces + scripts gốc
  Dockerfile, fly.toml
  shared/src/
    config.ts                 # mọi thông số gameplay + mạng, có đơn vị (px, px/s, ms, Hz)
    sim/
      world.ts                # map, tường, bục (AABB)
      player.ts               # di chuyển, nhảy, coyote, buffer, knockback, i-frame
      slipper.ts              # state held/flying/grounded, quỹ đạo, nảy, swept test
      combat.ts               # ném, bắt, trúng, nhặt; thứ tự xử lý trong 1 step
      step.ts                 # step(state, inputsByPlayer) -> events
      state.ts                # GameState thuần dữ liệu, clone nhanh
    net/
      codec.ts                # encode/decode binary: input, snapshot, events
      messages.ts             # mã message (u8) + kiểu
      quantize.ts             # lượng tử hóa vị trí/vận tốc/góc
  server/src/
    index.ts                  # Colyseus + uWS transport + serve client tĩnh
    rooms/MatchRoom.ts        # một phòng: chờ → trận → kết quả
    rooms/lobby.ts            # LobbyRoom có sẵn + chơi nhanh
    game/ServerGame.ts        # vòng tick 60 Hz, input buffer, snapshot, lag comp
    game/history.ts           # ring buffer state ~200 ms cho lag compensation
    guard.ts                  # rate limit, validate, giới hạn phòng/kết nối
  client/src/
    main.ts
    net/
      transport.ts            # interface mỏng: send/onMessage/close (WS; sau này UDP-like)
      clock.ts                # đồng bộ thời gian, RTT, jitter
      prediction.ts           # chạy sim cho bản thân, reconcile
      interpolation.ts        # buffer snapshot, nội suy người khác + dép
      netsim.ts               # giả lập lag/jitter/loss khi dev (?lag=&jitter=&loss=)
    input/                    # phím -> action bitmask, rebind, chống cuộn trang
    scenes/                   # Boot, Title, Nickname, Lobby, RoomWaiting, Match, Result
    render/                   # nhân vật, dép, map, hiệu ứng (pool), palette
    ui/                       # DOM overlay cho form/sảnh (không cập nhật mỗi frame)
    assets/                   # font, âm thanh, sprite (bundle local)
  tools/bot.ts                # bot headless: vào phòng, gửi input ngẫu nhiên/kịch bản
```

Scripts:
- `npm install` → `npm run dev`: chạy server (watch) + Vite client cùng lúc.
- `npm test`, `npm run build`, `npm start` (prod, một cổng, đọc `PORT`).
- `npm run bots -- --rooms 20 --players 2`: tạo tải giả.

---

## 4. Danh tính không cần login

- Lần đầu: nhập **biệt danh** (2–16 ký tự, có dấu tiếng Việt); gợi ý ngẫu nhiên "Chú Tư Xe Ôm", "Bé Na Lớp 3", "Cô Ba Bún Bò".
- `guestId` (UUID) lưu `localStorage` (bọc try/catch, lỗi thì id tạm trong phiên). Chọn nhân vật cũng lưu `localStorage`.
- Server: trim, giới hạn độ dài, chặn ký tự điều khiển/zero-width, danh sách từ cấm ngắn; trùng tên trong phòng thêm `#2`.
- `guestId` chỉ dùng để nhận lại slot khi reconnect và chống spam, không phải bảo mật.

---

## 5. Sảnh & phòng

### 5.1 Sảnh
- Danh sách phòng realtime (`LobbyRoom`). Mỗi dòng: tên phòng, chủ phòng, chế độ (1v1 / Hỗn chiến), người chơi `x/max`, số người xem, trạng thái (**Đang chờ** / **Đang đánh** / **Đầy**), khóa nếu riêng tư, **ping tới server**.
- Lọc: Tất cả / Đang chờ / Đang đánh. Phòng đang chờ còn chỗ lên đầu.
- Mỗi phòng: **Vào chơi** (còn slot + đang chờ), **Xem** (luôn có nếu phòng cho phép xem).
- Nút chung: **Chơi nhanh** (vào phòng 1v1 công khai đang chờ, không có thì tạo mới và chờ), **Tạo phòng**, **Nhập mã phòng**.
- Trống: "Hẻm vắng hoe… Tạo phòng đi!".

### 5.2 Tạo phòng
- Tên phòng (mặc định "Hẻm của <biệt danh>").
- Chế độ: **1v1** (mặc định) hoặc **Hỗn chiến** tối đa 3/4/5 người.
- Số hiệp thắng: 2 / **3** / 5.
- Công khai / **riêng tư** (ẩn khỏi danh sách, vào bằng mã 5 ký tự hoặc link).
- Cho phép xem: bật/tắt; tối đa người xem (mặc định 20).

### 5.3 Phòng chờ
- Mã phòng + link `?room=ABCDE` (mở link vào thẳng; chưa có biệt danh thì hỏi trước).
- Slot người chơi và danh sách người xem tách riêng, hiện ping từng người.
- **Sẵn sàng**; 1v1 tự bắt đầu khi đủ 2 người sẵn sàng; hỗn chiến do chủ phòng bấm **Bắt đầu** (≥2 người, tất cả sẵn sàng).
- Người xem **Vào chơi** khi có slot trống; người chơi **Ra xem**.
- Chủ phòng: đổi cài đặt khi đang chờ, kick, chuyển chủ. Chủ thoát → chuyển cho người vào sớm nhất. Phòng trống → hủy sau 30 s.
- Chat ngắn + emoji phản ứng ("Ối giời ơi!", "Né đi!", 🩴, 😂), rate limit.

### 5.4 Người xem
- Vào bất kỳ lúc nào: nhận **snapshot đầy đủ** (keyframe) rồi theo delta.
- Không gửi input gameplay (server bỏ qua). Nhận snapshot **15–20 Hz**, interpolation delay lớn hơn (~150 ms) để mượt.
- HUD đủ mọi người chơi; emoji phản ứng bay ở mép màn hình, không che sân.

### 5.5 Rớt mạng & rời phòng
- Giữ slot **30 s** (`allowReconnection`), token lưu `sessionStorage`. Nhân vật đứng yên, hiện "📶 mất sóng". Vào lại nhận keyframe ngay.
- Quá 30 s: 1v1 → người còn lại thắng trận; hỗn chiến → bị loại khỏi hiệp, dép rơi tại chỗ (tổng dép không đổi).
- Tab mất focus: xóa input đang giữ, gửi input trống; **không pause** trận.

---

## 6. Luật theo số người

- Mỗi người 3 máu, 2 dép, mang tối đa 2. **Tổng dép = 2 × số người khi bắt đầu hiệp**, bất biến trong hiệp (assert ở debug, kiểm trong test).
- 1v1: thắng N hiệp thắng trận.
- Hỗn chiến: hết hiệp khi còn 1 người; người bị loại làm rơi dép; giới hạn 90 s/hiệp, hết giờ người nhiều máu nhất thắng, hòa thì "đột tử" (mọi người còn 1 máu).
- Vị trí xuất phát cố định, đối xứng theo số người.
- Vòng đời: phòng chờ → đếm ngược "3-2-1-Ném!" (khớp theo đồng hồ server) → hiệp → kết hiệp 2 s → hiệp mới (reset đầy đủ) → kết trận → **Đấu lại** (tất cả đồng ý trong 15 s) / **Về sảnh**.

---

## 7. Netcode chi tiết

### 7.1 Mô phỏng
- Fixed timestep **60 Hz** ở cả server và client, tách khỏi tần số màn hình (accumulator; tối đa 5 step/frame để tránh spiral).
- Tất định trong mức hợp lý: chỉ dùng phép tính đơn giản, không `Math.random` trong sim (RNG có seed nếu cần), làm tròn/lượng tử hóa state sau mỗi step giống nhau ở cả hai phía để prediction khớp server.
- Thứ tự trong step: áp input → di chuyển người → **bắt hợp lệ** → di chuyển dép (swept test) + nảy → trúng → nhặt → kiểm tra hết hiệp. Trả về `events`.

### 7.2 Input (client → server)
- Mỗi tick client tạo input `{ seq: u16, buttons: u8 }` (trái, phải, nhảy, giữ-ném, bắt). Nút ném dùng **giữ/thả**, server tự tính lực theo số tick giữ → không gửi lực từ client (chống gian lận).
- Gửi **2 tick một gói (30 Hz)**, mỗi gói kèm **3–5 input gần nhất chưa được xác nhận** (dư thừa) → mất gói không mất input. Gói ~8–14 byte.
- Server giữ **input buffer** mỗi người (mục tiêu 1–2 tick); thiếu input thì lặp input trước (trừ cạnh nhấn nút: không lặp "bắt"/"thả ném").
- Giới hạn: input đến quá sớm/quá muộn so với tick server bị bỏ; quá nhiều gói/giây → cảnh báo rồi kick.

### 7.3 Snapshot (server → client)
- Server tick 60 Hz, gửi snapshot **30 Hz** cho người chơi, 15–20 Hz cho người xem.
- Nội dung: `tick`, `lastProcessedSeq` của người nhận, mỗi người chơi (x, y, vx, vy lượng tử 1/8 px, flags: hướng mặt, trên đất, đang gồng, i-frame, máu, số dép), mỗi dép (state 2 bit, x, y, vx, vy, góc u8, chủ sở hữu, còn gây sát thương).
- **Delta theo snapshot client đã ack**: chỉ gửi trường đổi; keyframe đầy đủ khi vào phòng/reconnect/mỗi 2 s.
- **Events** (throw, catch, hit, bounce, pickup, roundStart/End) gửi kèm snapshot, có `tick`, lặp lại trong vài snapshot đến khi được ack (để không mất trên kênh unreliable sau này).
- Mục tiêu băng thông: 1v1 < **4 KB/s** mỗi chiều mỗi người; 5 người < 10 KB/s. Ghi số đo thực tế.

### 7.4 Client
- **Prediction** nhân vật của mình: chạy `step()` cục bộ với input của mình (người khác giữ theo snapshot gần nhất). Nhận snapshot → đặt lại state bản thân về server tại `lastProcessedSeq`, **phát lại** các input chưa ack. Sai lệch < ngưỡng (vd 4 px) thì làm mượt hiển thị trong ~100 ms, lớn hơn thì snap.
- **Interpolation** người khác và dép: render tại `serverTime - interpDelay`. `interpDelay` **thích ứng** = khoảng gửi + jitter đo được (kẹp 50–150 ms). Thiếu snapshot thì extrapolate tối đa 100 ms rồi đứng.
- **Ném dự đoán**: thả nút → hiện dép bay ngay trên client (dép "tạm"), khi snapshot xác nhận thì gắn sang dép thật, làm mượt sai lệch. Server bác bỏ (vd đang bị choáng) → dép tạm biến mất có hiệu ứng nhẹ.
- **Hiệu ứng trúng/bắt**: chỉ phát chắc chắn khi có event từ server (có thể phát âm "vút" dự đoán khi ném). Không hiển thị mất máu trước khi server xác nhận.

### 7.5 Lag compensation cho bắt & trúng
- Server lưu ring buffer state ~200 ms.
- **Bắt**: khi nhận lệnh bắt ở tick client T, server kiểm tra vị trí dép tại thời điểm người bắt nhìn thấy (≈ T − interpDelay của họ), **tua lại tối đa min(RTT/2 + interpDelay, 120 ms)**. Hợp lệ → dép về kho người bắt ở tick hiện tại. Cửa sổ bắt 150 ms và hồi chiêu 500 ms lấy từ config.
- **Trúng**: xét tại thời gian server (không tua) — người né được thấy công bằng với vị trí của chính họ. Nếu cùng tick vừa bắt hợp lệ (đã tua) vừa trúng → **ưu tiên bắt**.
- Ghi log tranh chấp bắt/trúng ở debug để tinh chỉnh.

### 7.6 Đồng bộ thời gian & chất lượng mạng
- Ping/pong 2 lần/giây; RTT và clock offset lấy trung vị; jitter = độ lệch chuẩn.
- HUD: ping (xanh < 80 ms, vàng < 150 ms, đỏ ≥ 150 ms), biểu tượng mất gói.
- Ping > 250 ms kéo dài: hiện cảnh báo "Mạng yếu".

### 7.7 Công cụ dev
- `?lag=120&jitter=30&loss=2` trên client: giả lập trễ/mất gói ở lớp `transport` (cả hai chiều).
- Debug overlay (phím F3): FPS, ping, jitter, interpDelay, số snapshot trong buffer, sai lệch reconcile, byte/s in/out, hitbox, state dép, tick server.
- Server log mỗi 10 s: số phòng, số kết nối, thời gian tick trung bình/p99, byte/s.

---

## 8. Điều khiển (mỗi máy một người)

- Di chuyển: **A/D** hoặc **←/→**. Nhảy: **W / ↑ / Space**.
- Ném: **J** (hoặc **F**) giữ để lấy lực, thả để ném. Bắt: **K** (hoặc **G**).
- Đổi phím được, lưu `localStorage`. Màn hướng dẫn trước trận vẽ phím bằng hình phím.
- Chặn cuộn trang bằng phím chơi; không chặn khi đang gõ trong ô nhập (biệt danh, chat).
- (Sau) Gamepad API.

---

## 9. Đồ họa & âm thanh — Việt Nam dân dã

Mục tiêu: nhìn là thấy **con hẻm Việt Nam**, hài hước, ấm áp, dễ đọc tình huống. Không máu me, không logo/thương hiệu thật.

### 9.1 Map (1280×720, scale giữ tỉ lệ, DPR tối đa 2)
- Nền: tường vôi **vàng ố / xanh ngọc** loang lổ, **cửa sắt kéo**, **dây điện chằng chịt**, bảng hiệu sơn tay tự nghĩ ("Cắt tóc 20k", "Bún bò cô Ba", "Sửa xe – Vá ruột"), giàn bông giấy, chậu kiểng, lồng chim.
- Sàn xi măng / gạch tàu đỏ. Bục: **mái tôn** sạp, **chồng ghế nhựa đỏ-xanh**, **thùng xốp**. Hitbox bục khớp mặt trên nhìn thấy.
- Tường hai bên cho dép nảy: tường nhà hàng xóm, cổng sắt.
- Chi tiết sống (tắt được): mèo ngủ trên mái, gà chạy góc, xe máy cũ dựng tường, khói bếp than.
- Bảng màu trong `render/palette.ts`: vàng ố `#E8C66A`, xanh ngọc `#4FA3A5`, đỏ gạch `#B5523B`, xanh lá chuối `#6BA368`, trắng ngà `#F4EBD9`, nâu gỗ `#7A5235`, viền đậm `#2B2118`. Nền giảm bão hòa để **nhân vật và dép nổi bật**.

### 9.2 Nhân vật (5, khác nhau về màu + dáng + ký hiệu + tên trên đầu)
1. **Chú Tư Xe Ôm** — áo ba lỗ, mũ bảo hiểm xanh, dáng to.
2. **Cô Ba Bún Bò** — nón lá, áo bà ba tím, khăn rằn.
3. **Bé Na** — áo trắng khăn quàng đỏ, cặp sau lưng, dáng nhỏ.
4. **Ông Bảy Cờ Tướng** — sơ mi caro, quần đùi, kính lão.
5. **Anh Sáu Shipper** — áo khoác cam, balo vuông.
- Hitbox giống nhau cho mọi nhân vật (công bằng), chỉ khác hình.
- Animation: đứng, chạy, nhảy/rơi, gồng ném, ném, bắt, trúng đòn (mặt méo, sao quay), thắng, thua.
- Vẽ bằng Phaser Graphics → `generateTexture` lúc Boot, hoặc sprite sheet tự vẽ bundle local. Viền đậm hoạt hình.
- Trong trận: **nhân vật của mình có vòng chỉ dưới chân** để dễ nhận ra.

### 9.3 Dép
- **Dép tổ ong** trắng-xanh mặc định; skin (dép tổ ong hồng, dép tông) chỉ đổi hình.
- Viền màu theo người ném cuối. Đang gây sát thương: vệt bay + viền sáng. Vô hại: nhạt màu. Nằm đất: nhấp nhô + mũi tên "nhặt".

### 9.4 UI
- Font có đủ dấu tiếng Việt, license mở, **bundle local** (vd *Be Vietnam Pro* cho chữ, *Pangolin*/*Patrick Hand* cho tiêu đề — kiểm tra OFL và dấu trước khi dùng).
- Logo "DÉP THỦ" kiểu **bảng hiệu sơn tay trên tôn**. Sảnh như **bảng tin tổ dân phố** / bảng đen quán cà phê.
- HUD: máu là **nón lá**, dép là icon dép, hiệp thắng là **dấu tick phấn**, ping ở góc.
- Câu chữ: "Trúng mặt!", "Bắt gọn!", "Hụt rồi cha!", "Hết dép rồi!", "Dép thủ số 1 hẻm!".

### 9.5 Âm thanh (bundle local, nút tắt riêng sfx/nhạc/ambient)
- "Chát" khi trúng, "bộp" khi bắt, dép nảy tường, nhảy.
- Ambient hẻm nhỏ (xe máy xa, tiếng rao bánh mì, gà gáy).
- Nhạc nền vui kiểu ngũ cung ngắn, lặp. Không có asset license rõ → tổng hợp sfx bằng WebAudio, để trống nhạc. Không dùng âm thanh có bản quyền.

---

## 10. Hiệu năng, bảo mật, vận hành

- Client 60 FPS trên laptop phổ thông với 5 người + 10 dép + hiệu ứng. Không tạo object/listener/texture trong update; pool dép (`2 × maxPlayers`) và hiệu ứng; DOM không cập nhật mỗi frame; rời scene dọn listener/timer/tween/kết nối.
- Server: 1 phòng 5 người < 0.5 ms/tick; mục tiêu **≥ 200 phòng 1v1** trên 1 vCPU (đo bằng bot, ghi kết quả thực).
- Tất cả state gameplay do server quyết; client chỉ gửi nút bấm. Validate mọi message (độ dài, mã, giá trị). Rate limit chat/emoji/input. Giới hạn kết nối mỗi IP và tổng số phòng.
- HTTPS/WSS bắt buộc khi deploy. Biến môi trường: `PORT`, `PUBLIC_URL`, `MAX_ROOMS`.
- Graceful shutdown: báo client "server bảo trì", không mất kết nối đột ngột khi deploy nếu tránh được.

---

## 11. Các phase triển khai

### Phase 1 — Lõi mô phỏng + codec (chưa có mạng)
- Monorepo, `shared/sim`, `shared/net/codec`.
- Client scene `Match` chạy sim cục bộ với **1 người do bàn phím điều khiển + 1 bot đứng/ném đơn giản** (chỉ để kiểm cảm giác chơi; không phải chế độ chơi cho người dùng).
- **Vitest**: coyote/jump buffer; ném/bắt/trúng; bắt trước trúng cùng step; không tự trúng; một lượt ném chỉ 1 sát thương; swept không xuyên ở tốc độ cao; **tổng dép bất biến** qua 10.000 step input ngẫu nhiên (2 và 5 người); **tất định**: chạy cùng chuỗi input 2 lần ra state giống hệt; codec encode→decode khớp, kích thước gói trong ngân sách.
- ✅ Xong khi: test pass, cảm giác di chuyển/ném đúng `init.md`, `npm run build` pass.

### Phase 2 — Server, sảnh, phòng
- Colyseus + uWS transport, `LobbyRoom`, `MatchRoom` (metadata bằng Schema), chơi nhanh, mã/link phòng, sẵn sàng, chủ phòng, kick, vào chơi/ra xem, chat + emoji, đo ping.
- ✅ Xong khi: 3+ tab (hoặc 2 máy trong LAN) tạo/vào/xem/rời phòng, danh sách cập nhật realtime, chuyển chủ phòng đúng, phòng trống tự hủy.

### Phase 3 — Trận đấu online 1v1
- Server tick 60 Hz, input buffer, snapshot binary 30 Hz + delta + events.
- Client: clock sync, prediction + reconcile, interpolation thích ứng, ném dự đoán, lag compensation khi bắt.
- Netsim `?lag=&jitter=&loss=`, debug overlay F3.
- ✅ Xong khi: 1v1 giữa **2 máy khác nhau** (hoặc 2 trình duyệt) mượt ở mạng LAN; ở `?lag=120&jitter=30&loss=2` vẫn di chuyển không giật bản thân, bắt dép được; băng thông đo được trong ngân sách mục 7.3.

### Phase 4 — Người xem, hỗn chiến, reconnect
- Người xem vào giữa hiệp (keyframe), snapshot 15–20 Hz.
- Hỗn chiến 3–5 người, đột tử, người bị loại rơi dép.
- Reconnect 30 s, đấu lại / về sảnh.
- ✅ Xong khi: 5 người + 3 người xem chạy ổn; rút mạng 10 s rồi vào lại đúng slot; tổng dép luôn đúng.

### Phase 5 — Đồ họa & âm thanh Việt Nam + game feel
- Map hẻm, 5 nhân vật, dép tổ ong, UI bảng hiệu, font local, sfx.
- Squash/stretch, bụi chân, vệt dép, lóe khi bắt, hitstop rất ngắn (chỉ ở render, **không dừng sim**), rung màn hình nhẹ (tắt được), chữ bật.
- ✅ Xong khi: ảnh chụp nhìn rõ hẻm Việt Nam, dép/nhân vật dễ đọc, vẫn 60 FPS.

### Phase 6 — Tải, tối ưu mạng, deploy
- Bot headless tạo tải; đo tick time, CPU, RAM, byte/s.
- Đo trải nghiệm qua mạng thật (4G, Wi-Fi) tới server Singapore. **Nếu** mất gói làm giật rõ: thêm transport UDP-like (WebTransport datagrams hoặc geckos.io) cho input/snapshot, giữ WebSocket fallback, so sánh số đo trước/sau.
- Dockerfile, deploy region Singapore (hoặc VPS Việt Nam), HTTPS/WSS, hướng dẫn deploy.
- ✅ Xong khi: bản prod chạy trên server thật, 2 máy ở 2 mạng khác nhau đấu được, có số đo ping/băng thông/tick.

---

## 12. Checklist trước khi hoàn thành

Từ `init.md` mục 10, chi tiết hơn:
- [ ] 2 người trên **2 máy khác nhau** di chuyển, nhảy, ném đồng thời; nhân vật của mình không giật khi có lag giả lập.
- [ ] Ném hết dép, nhặt lại, nhặt dép đối thủ; bắt thành công, bắt hụt, bắt khi kho đầy — đều qua mạng.
- [ ] Dép nảy tường, không xuyên người ở tốc độ cao; một lượt ném không gây sát thương lặp.
- [ ] Tổng dép = 2 × số người suốt mọi hiệp (1v1 và 5 người).
- [ ] Tạo phòng công khai/riêng tư; phòng riêng ẩn nhưng vào được bằng mã/link.
- [ ] Danh sách phòng cập nhật realtime số người/người xem/trạng thái.
- [ ] Vào chơi phòng đầy bị từ chối rõ ràng, gợi ý "Xem".
- [ ] Người xem vào giữa hiệp thấy đúng state, không gửi được input gameplay.
- [ ] Chủ phòng thoát → chuyển chủ; phòng trống tự hủy.
- [ ] Rớt mạng < 30 s vào lại đúng slot; > 30 s xử lý đúng theo chế độ.
- [ ] Tab mất focus không kẹt phím, không làm trận dừng.
- [ ] Đấu lại nhiều trận không nhân đôi listener, timer, kết nối, room handler (debug counter).
- [ ] Băng thông 1v1 < 4 KB/s mỗi chiều (đo thực); server tick p99 trong ngân sách.
- [ ] Gameplay không phụ thuộc màn hình 60/120/144 Hz.
- [ ] Biệt danh có dấu hiển thị đúng ở sảnh, phòng, HUD.
- [ ] `npm test`, `npm run build` pass; `npm start` chạy prod.

---

## 13. Báo cáo khi hoàn thành

Ghi ngắn vào `README.md`:
- Cách chạy dev / build / prod / bot tải; cách thử 2 máy trong LAN (dùng IP máy chạy server).
- Điều khiển.
- Mục checklist **đã thực sự chạy** (kèm cách kiểm) và mục chưa kiểm được.
- Số đo thực: FPS client, ping, băng thông, thời gian tick server, số phòng tối đa đã thử.
- Hạn chế và việc tiếp theo (UDP-like transport nếu chưa làm, gamepad, mobile, skin dép, vật rơi/công tắc trên map, rollback cho 1v1 xếp hạng).
