# 迹屿 · TravelMap

一个轻量、自托管的私人旅行影像地图。旅行地点显示为可点击的地球气泡；每段旅程可以保存手记，并批量上传、查看、下载照片和视频。

![迹屿——把走过的地方，留在一颗地球上](public/og.png)

## 技术栈

- 前端：React、TypeScript、Vite
- 后端：Node.js、Express
- 数据库：SQLite（`better-sqlite3`，WAL 模式）
- 媒体存储：服务器本地磁盘；SQLite 只保存旅行信息和媒体索引
- 图片处理：Sharp 生成 WebP 缩略图

## 为什么适合这台服务器

- 单个 Node.js 进程，前端构建后由同一进程提供，不需要 Redis、对象存储或第二个后端服务。
- SQLite 使用 WAL 模式保存旅行与媒体索引；原文件直接保存在磁盘。
- 上传使用磁盘流，不会把整个视频读进 2 GiB 内存。
- 照片自动生成 WebP 小图；媒体列表分页；视频只在打开时加载。
- 整段旅程下载为边读取边生成的 ZIP，不在内存里制作压缩包。

## 功能

- 可拖动、自动旋转的地球和旅行地点气泡
- 新增、编辑、删除旅程
- 照片/视频多选上传与逐文件进度
- 照片缩略图、图片灯箱、视频播放
- 原文件单独下载、整段旅程 ZIP 下载
- 可选的单用户管理口令，保护所有写操作
- 响应式界面，适配手机和桌面

## 本地运行

需要 Node.js 22 或更高版本。

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。开发环境首次启动会显示三段无媒体的示例旅程；生产环境不会创建示例。

运行完整检查：

```bash
npm run check
```

## Ubuntu 24.04 部署

以下示例使用 `/opt/jiyu`，媒体建议放在容量足够的数据盘上。

```bash
sudo apt update
sudo apt install -y nginx build-essential
sudo useradd --system --home /opt/jiyu --shell /usr/sbin/nologin jiyu
sudo mkdir -p /opt/jiyu
sudo chown -R jiyu:jiyu /opt/jiyu
```

安装 Node.js 22 后，将项目复制到 `/opt/jiyu`，执行：

```bash
cd /opt/jiyu
sudo -u jiyu npm ci
sudo -u jiyu npm run build
sudo -u jiyu cp .env.example .env
sudo -u jiyu mkdir -p data uploads thumbnails
```

编辑 `/opt/jiyu/.env`，至少把 `ADMIN_TOKEN` 换成随机长字符串。建议生成方式：

```bash
openssl rand -hex 32
```

安装仓库里的 systemd 和 Nginx 配置：

```bash
sudo cp deployment/jiyu.service /etc/systemd/system/jiyu.service
sudo cp deployment/nginx.conf /etc/nginx/sites-available/jiyu
sudo ln -s /etc/nginx/sites-available/jiyu /etc/nginx/sites-enabled/jiyu
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable --now jiyu nginx
```

状态检查：

```bash
systemctl status jiyu --no-pager
curl http://127.0.0.1:8787/api/health
```

正式公网使用前，请为 Nginx 配置 HTTPS（例如 Certbot），并在阿里云安全组只开放 80/443，不开放 8787。

## 数据目录与备份

必须一起备份以下三个目录：

- `data/`：SQLite 数据库
- `uploads/`：照片与视频原文件
- `thumbnails/`：可重新生成的照片小图

SQLite 运行在 WAL 模式。最稳妥的备份是在短暂停止服务后复制：

```bash
sudo systemctl stop jiyu
sudo tar -C /opt/jiyu -czf /var/backups/jiyu-$(date +%F).tar.gz data uploads thumbnails .env
sudo systemctl start jiyu
```

3 Mbps 上行带宽上传 1 GiB 视频理论上约需 45–50 分钟；应用和 Nginx 已把大文件超时放宽，但建议优先上传压缩后的视频。应用不进行视频转码，以避免占满 2 核 CPU。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | Node 服务端口 |
| `SITE_URL` | 自动识别 | 公网地址，用于生成分享图绝对地址 |
| `DATA_DIR` | `./data` | SQLite 目录 |
| `UPLOAD_DIR` | `./uploads` | 原媒体目录 |
| `THUMBNAIL_DIR` | `./thumbnails` | 缩略图目录 |
| `MAX_UPLOAD_MB` | `2048` | 单文件上传上限（MiB） |
| `ADMIN_TOKEN` | 空 | 设置后保护所有写操作 |
| `SEED_DEMO` | 开发为 `true` | 是否在空库生成演示旅程 |

## 常用命令

```bash
npm run dev      # 本地前后端开发
npm run test     # API 自动化测试
npm run build    # 类型检查和生产构建
npm start        # 运行生产服务（需先构建）
```
