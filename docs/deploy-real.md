# 真实多端部署（家长手机/Web · 儿童 Mac/华为平板）

## 1. 启动真实模式

```bash
./scripts/start.sh --real
```

- 数据目录：`./data/prod`（首次启动写入 180 节核心课程）
- 不写入演示家庭、不展示演示账号
- 首次打开会进入「创建管理员」；创建后即真实家庭
- 之后启动也用 `--real`，不要用 `--demo`

生产建议：
```bash
APP_SECRET=$(openssl rand -hex 32) PUBLIC_URL=https://你的域名 ./scripts/start.sh --real
```

- `--real` 会在本机生成并打印一次性 `SETUP_TOKEN`；本机初始化可留空，反向代理/Docker/远程访问必须在初始化页填写该令牌。
- 不要把 `SETUP_TOKEN` 写进前端代码或公开仓库。

### Docker
```bash
PUBLIC_URL=https://你的域名 SETUP_TOKEN=$(openssl rand -hex 16) docker compose up -d
```
- 必须显式设置 `PUBLIC_URL` 为手机/平板可访问的地址；容器内网地址（172.17.x）不能用于二维码。
- 反向代理需转发 `X-Forwarded-Proto`；否则 HTTPS 会被识别成 HTTP。

## 2. 手机和儿童设备访问

同一 Wi-Fi 下：

1. 家长手机打开 `http://<电脑局域网IP>:8080`
2. 登录后进入「多端」→「配对学习设备」
3. 弹窗会生成 **二维码 + 地址 + 6 位一次性配对码**（10 分钟有效）
4. 儿童 Mac / 华为平板扫码或在浏览器打开该地址，输入配对码
5. 设备获得独立令牌；家长可推送计划、查看回传、请求拍照、随时撤销

配对地址优先使用 `PUBLIC_URL`；未配置时按请求 Host 或本机局域网 IPv4 自动生成。跨网/VPN/公网部署请显式设置 `PUBLIC_URL`。

## 3. HTTPS（摄像头与 PWA 安装必需）

```bash
./scripts/gen-cert.sh
# 在 .env 设置 TLS_CERT / TLS_KEY
```

- 手机/平板首次访问自签证书需手动信任；正式使用建议受信任证书（Caddy/Nginx/Cloudflare Tunnel）。
- `http://localhost` 是安全上下文；局域网 IP 的 HTTP 不是。

## 4. 安装到桌面

### Mac（Safari / Chrome）
- Safari 17+：分享 → **添加到程序坞**；或菜单「文件 → 添加到程序坞」
- Chrome：地址栏右侧安装图标 → **安装星芽学堂**
- 学习端打开 `https://<host>/device` 后安装；全屏后由家长密码退出

### 华为平板（HarmonyOS / 华为浏览器 / Chrome）
- 华为浏览器：菜单 → **添加到桌面**
- Chrome/Edge：菜单 → **安装应用 / 添加到主屏幕**
- 打开 `/device` 后安装；横屏使用，建议开启自动旋转

## 5. 真实联动能力

- 家长推送计划 → 设备 SSE 实时收到收件箱（页面打开时）
- 设备学习完成 → 家长看板/计划回传
- 家长请求拍照 → 设备端明确同意后上传；照片仅家庭可见
- 撤销设备 → 令牌立即失效
- 断网时设备可继续打开已缓存的页面；写操作待网络恢复后重试

### 当前边界
- 没有 Web Push：页面关闭后不会收到系统推送；下次打开会补发到期提醒。
- SSE 需要页面保持打开；平板休眠会断线，唤醒后自动重连。
- 摄像头/PWA 安装依赖 HTTPS；局域网自签证书需要设备信任。

## 6. 备份

```bash
./scripts/backup.sh
```

数据、照片、密钥都在 `DATA_DIR`；不要把 `data/` 提交到 Git。
