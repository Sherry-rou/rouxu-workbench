# 柔序工作台

一个纯前端的个人效率与生活记录 PWA —— 九个板块收在一个侧边栏里，数据全部只存在你自己的浏览器里，可安装到手机主屏、断网也能用。

![状态](https://img.shields.io/badge/version-1.0-7BAE8C) ![无依赖](https://img.shields.io/badge/dependencies-0-7BAE8C) ![PWA](https://img.shields.io/badge/PWA-offline--ready-7BAE8C)

柔序工作台永久链接：https://sherry-rou.github.io/rouxu-workbench/

## 功能

| 板块 | 说明 |
| --- | --- |
| 打卡 & 待办 | 每日打卡、分组习惯、待办勾选与进度统计 |
| 记账管理 | 收支记录、分类筛选、月度统计、CSV 导出 |
| 好好吃饭 | 菜品库 + 饮食记录，记录每餐吃了什么 |
| 转盘转转转 | 自定义选项、保存方案、转盘抽签 |
| 倒数日 | 纪念日倒数、到期提醒 |
| 饮食规划 | 一周早中晚餐单编排、采购清单 |
| 生理期记录 | 周期记录、日历视图、下次预测 |
| 愿望清单 | 愿望收集、优先级与完成状态 |
| 专注 | 计时器、专注记录、统计图表 |

另有：深色模式、Toast 提示与撤销、JSON 备份快照、数据导入导出、分享长图、本地通知提醒。

## 技术栈

无框架、无构建、无依赖：

- 原生 HTML / CSS / JavaScript
- `localStorage` 本地持久化，按模块分键（`workbench.<module>`）
- Service Worker 缓存优先，离线可用
- Web App Manifest，支持安装到桌面 / 主屏
- 移动端优先的响应式布局（≤768px 为 72px 图标窄栏）

## 目录结构

```
.
├── index.html            # 唯一页面，九个板块的挂载点
├── styles.css            # 全部样式，含深色主题变量与移动端覆盖
├── app.js                # 模块配置、渲染器、存储与交互逻辑
├── manifest.json         # PWA 清单
├── service-worker.js     # 离线缓存
├── icons/
│   ├── logo.svg          # 品牌标（超椭圆绿底「柔」字）
│   ├── icon-192.png      # PWA 图标
│   ├── icon-512.png
│   ├── maskable-512.png  # Android 自适应图标
│   └── modules/          # 九个板块的图标
├── .well-known/
│   └── assetlinks.json   # 供 Android TWA 校验的 Digital Asset Links
└── generate_icons.py     # 图标生成脚本（开发用，非运行依赖）
```

## 本地运行

Service Worker 需要 HTTPS 或 `localhost`，所以别直接双击打开 `index.html`，起一个静态服务即可：

```bash
python -m http.server 8080
# 然后访问 http://localhost:8080
```

## 部署

任何静态托管都行（GitHub Pages、Netlify、Vercel、对象存储……），把整个目录原样上传即可。

> 用 GitHub Pages 时请保留仓库里的 `.nojekyll` 文件，否则 `.well-known/assetlinks.json` 这类点开头的目录不会被发布。

## 安装到手机

- **Android / Chrome**：打开页面 → 菜单 →「添加到主屏幕」，会以独立窗口运行，没有浏览器地址栏。
- **iOS / Safari**：分享 →「添加到主屏幕」。

## 关于数据

所有记录都保存在浏览器的 `localStorage` 里，不上传任何服务器。这意味着：

- 换浏览器、换设备、清理浏览器数据，记录都不会跟过去；
- **换一个域名访问，等于换了一份空白数据**；
- 想迁移就用设置页里的「导出备份」，在新环境里导入。

## License

个人项目，未附带开源许可证。
