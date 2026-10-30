Bạn là lập trình viên game web 2D nhiều người chơi realtime, có kinh nghiệm về netcode, game feel và tối ưu hiệu năng. Hãy xây dựng game chơi được hoàn chỉnh qua mạng theo mô tả dưới đây, không chỉ tạo giao diện hoặc bản demo animation.

Kế hoạch triển khai chi tiết (công nghệ, netcode, phòng, phase, checklist) nằm trong `idea/plan.md`. File này mô tả ý tưởng và luật chơi.

TÊN GAME: DÉP THỦ

1. Công nghệ
- Client: TypeScript + Vite + Phaser 3, dùng phiên bản ổn định tương thích với nhau. Phaser.AUTO, ưu tiên WebGL. Phaser chỉ dùng để vẽ, nhận input và hiệu ứng.
- Server: Node.js + TypeScript + Colyseus (transport uWebSockets.js), server authoritative.
- Mô phỏng gameplay tự viết bằng TypeScript thuần trong package dùng chung, chạy fixed timestep 60 Hz ở cả server và client.
- Dữ liệu gameplay gửi dạng nhị phân; client prediction cho bản thân, interpolation cho người khác.
- Không đăng nhập, không database. Người chơi chỉ nhập biệt danh.
- Chỉ chơi online, mỗi người một máy (trình duyệt desktop).
- Dự án chạy được bằng npm install và npm run dev (chạy cả server và client).
- Kiểm tra API theo phiên bản thực tế đã cài.

2. Ý tưởng
Game đối kháng 2D online góc nhìn ngang, vui nhộn, bối cảnh một con hẻm Việt Nam.
Người chơi ném dép, né đòn, bắt dép và tranh nhau nhặt lại vũ khí.
Một phòng có 2–5 người chơi, chủ yếu đấu 1v1; người khác có thể vào xem.
Có sảnh danh sách phòng, tạo phòng, vào phòng, chơi nhanh, vào bằng mã/link.
Phong cách hoạt hình hài hước, Việt Nam dân dã, dễ đọc tình huống, không máu me.

3. Luật chơi
- Mỗi người bắt đầu với 3 máu và 2 chiếc dép.
- Tổng số dép trong hiệp luôn bằng 2 × số người chơi lúc bắt đầu hiệp (1v1 là 4 chiếc).
- Mỗi người mang tối đa 2 chiếc; có thể nhặt dép của người khác.
- Trúng một chiếc dép đang gây sát thương thì mất 1 máu.
- 1v1: hết máu thua hiệp; thắng 3 hiệp (chỉnh được khi tạo phòng) thắng trận.
- Hỗn chiến 3–5 người: người cuối cùng còn trụ thắng hiệp; người bị loại làm rơi dép tại chỗ; giới hạn thời gian hiệp, hết giờ người nhiều máu nhất thắng.
- Reset đầy đủ máu, vị trí, dép và trạng thái khi bắt đầu hiệp mới.
- Có màn hình nhập biệt danh, sảnh, phòng chờ, hướng dẫn, đếm ngược, kết quả, đấu lại và về sảnh.

4. Điều khiển (mỗi máy một người)
- A/D hoặc mũi tên trái/phải: di chuyển.
- W, mũi tên lên hoặc Space: nhảy.
- J (hoặc F): giữ để lấy lực, thả để ném.
- K (hoặc G): bắt dép.

- Tự nhặt dép nằm dưới đất khi đi đủ gần và còn chỗ.
- Hiển thị rõ phím điều khiển trước trận.
- Ngăn trình duyệt cuộn trang khi dùng phím chơi; không chặn khi đang gõ trong ô nhập.
- Khi tab mất focus: xóa input đang giữ; trận online không pause.
- Có thể đổi phím, lưu trên trình duyệt.

5. Cơ chế ném và bắt
- Ném theo hướng nhân vật đang quay mặt.
- Giữ nút tăng lực đến giới hạn, có thanh báo lực. Lực do server tính theo thời gian giữ, client không gửi lực.
- Dép bay theo quỹ đạo có trọng lực và xoay khi bay.
- Dép nảy tường, mất dần năng lượng; chạm đất và chậm lại sẽ thành vật có thể nhặt.
- Không gây sát thương cho người ném trong cùng lượt bay.
- Sau khi gây sát thương một lần, dép chuyển sang trạng thái không gây sát thương cho đến khi được nhặt và ném lại.
- Bắt thành công khi dép nằm trong vùng bắt phía trước, người chơi còn chỗ chứa và bấm đúng thời điểm.
- Cửa sổ bắt ban đầu khoảng 150 ms, hồi chiêu khoảng 500 ms; cho phép chỉnh trong config.
- Server xét bắt có bù trễ giới hạn (lag compensation) theo thời điểm người bắt nhìn thấy dép.
- Ưu tiên xử lý bắt hợp lệ trước xử lý trúng đòn trong cùng physics step.
- Không thể ném và bắt đồng thời.
- Khi bắt thành công, chiếc dép được chuyển vào kho người bắt, không tạo thêm dép.

6. Di chuyển và cảm giác chơi
- Di chuyển nhanh, tăng/giảm tốc ngắn, đổi hướng rõ ràng.
- Nhảy có coyote time khoảng 80 ms và jump buffer khoảng 100 ms.
- Nhảy có độ cao thay đổi theo thời gian giữ nút.
- Trúng đòn có knockback và bất tử ngắn, tránh mất nhiều máu liên tiếp.
- Hiệu ứng squash/stretch nhẹ, bụi chân, vệt bay, lóe khi bắt.
- Hitstop rất ngắn (chỉ ở phần hiển thị, không dừng mô phỏng) và rung màn hình nhẹ khi trúng đòn.
- Nhân vật của mình được dự đoán ngay trên client, không chờ server; hiệu ứng trúng/mất máu chỉ hiện khi server xác nhận.
- Hiệu ứng phải giữ được khả năng quan sát trận đấu.
- Có bật/tắt âm thanh và rung màn hình.

7. Map và đồ họa
- Một màn hình cố định, kích thước thiết kế 1280×720, scale giữ tỉ lệ.
- Bối cảnh hẻm Việt Nam: tường vôi vàng ố/xanh ngọc, cửa sắt kéo, dây điện chằng chịt, bảng hiệu sơn tay.
- Sàn xi măng/gạch tàu, hai hoặc ba bục để nhảy (mái tôn, chồng ghế nhựa, thùng xốp) và tường hai bên cho dép nảy.
- 5 nhân vật xóm phân biệt rõ bằng màu, hình dáng, ký hiệu và tên trên đầu; hitbox giống nhau; nhân vật của mình có vòng đánh dấu dưới chân.
- Dép tổ ong bay nổi bật trên nền; hitbox khớp hợp lý với hình ảnh.
- HUD gồm máu, số dép đang cầm, số hiệp thắng và ping.
- Có thể tự tạo texture bằng Phaser Graphics nếu chưa có asset.
- Không phụ thuộc ảnh hoặc font từ dịch vụ bên ngoài; font có đủ dấu tiếng Việt được đóng gói kèm game.
- Bản đầu tập trung ném–né–bắt–nhặt. Công tắc và vật rơi chỉ thêm sau khi vòng chơi chính hoạt động tốt.

8. Hiệu năng, mạng và tính đúng
- Mục tiêu 60 FPS trên laptop phổ thông; đo và báo kết quả thực tế nếu môi trường cho phép.
- Gameplay không phụ thuộc tần số màn hình 60/120/144 Hz.
- Dùng physics step cố định ở cả server và client; nội suy hình ảnh nếu cần.
- Dùng swept collision hoặc segment test từ vị trí cũ đến vị trí mới để dép nhanh không xuyên người hoặc tường.
- Server quyết định mọi kết quả; client chỉ gửi nút bấm. Validate và rate limit mọi message.
- Gói dữ liệu nhỏ, nhị phân; mục tiêu băng thông 1v1 dưới 4 KB/s mỗi chiều.
- Chịu được mạng xấu: input gửi kèm dư thừa, interpolation delay thích ứng theo jitter.
- Người rớt mạng được giữ chỗ 30 s để vào lại.
- Không tạo object, collider, listener hoặc texture liên tục trong update.
- Tái sử dụng object dép; pool hiệu ứng khi phù hợp.
- Giới hạn particle và device pixel ratio tối đa 2.
- Không cập nhật DOM mỗi frame.
- Dọn listener, timer, tween và kết nối khi restart hoặc đổi scene.
- Có debug toggle hiển thị FPS, ping, jitter, băng thông, hitbox và trạng thái dép; có giả lập lag/mất gói khi dev.
- Đặt server gần người chơi (Singapore hoặc Việt Nam).

9. Cấu trúc code
- Tách shared (config, mô phỏng, codec), server (phòng, vòng tick) và client (scene, input, net, render).
- Các thông số gameplay và mạng tập trung trong config, có đơn vị rõ ràng.
- Dép có state rõ ràng: held, flying, grounded.
- Input được đọc thành action, tách khỏi logic nhân vật để dễ mở rộng.
- Ưu tiên code ngắn gọn, dễ sửa; không xây hệ thống trừu tượng quá mức.

10. Kiểm tra trước khi hoàn thành
- Hai người trên hai máy khác nhau di chuyển, nhảy và ném đồng thời.
- Ném hết dép, nhặt lại và nhặt dép đối thủ.
- Bắt thành công, bắt hụt và bắt khi kho đầy.
- Dép nảy tường và không xuyên mục tiêu ở tốc độ cao.
- Một lượt ném không gây sát thương lặp.
- Tổng số dép luôn bằng 2 × số người chơi.
- Tạo, vào, xem và rời phòng; danh sách phòng cập nhật realtime.
- Người xem vào giữa hiệp thấy đúng trạng thái.
- Rớt mạng rồi vào lại đúng chỗ.
- Vẫn chơi được khi giả lập lag 120 ms, jitter 30 ms, mất gói 2%.
- Đấu lại nhiều trận không nhân đôi input, listener hoặc kết nối.
- Tab mất focus không gây kẹt phím.
- npm test và npm run build thành công.

Hãy triển khai và chạy kiểm tra trong môi trường hiện có.
Đưa ra bản chơi được qua mạng trước, sau đó tinh chỉnh cảm giác chơi và đồ họa.
Khi hoàn thành, ghi ngắn gọn cách chạy, điều khiển, phần đã kiểm tra và hạn chế còn lại. Không tuyên bố đã kiểm tra những gì chưa thực sự chạy.
