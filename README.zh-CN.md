# Kelan Image Uploader 中文说明

[English](README.md)

这是一个 Obsidian 图片上传插件，用来处理从设备选择、粘贴、拖拽或通过 Obsidian 原生附件入口插入到编辑器里的图片。插件可以在上传前压缩、缩放或转换格式，并把上传接口返回的图片 URL 插入到笔记中。

## 功能

- 支持从命令面板选择图片、粘贴图片、拖拽图片，以及 Obsidian 原生附件图片上传。
- 支持任意兼容 `multipart/form-data` 的上传接口。
- 可通过 `url`、`data.link`、`0.src` 等路径从 JSON 返回值中提取图片地址。
- 可选图片缩放、压缩，以及 JPEG/PNG/WebP 格式转换。
- SVG、动图 GIF、ICO 等不适合转换的格式会保留原文件上传。
- 多图上传时保持插入顺序。
- 自动同排图片：开启后，没有空行隔开的相邻 Markdown 图片或同排图片会合并为固定高度、可换行的图片流。

自动同排的分组规则：

```md
![](one.webp)
![](two.webp)
![](three.webp)

![](four.webp)
![](five.webp)
![](six.webp)
```

中间的空行会把图片分成两组。图片会保持设置里的同排图片高度，宽度按原始比例缩放；一行放不下时自动换行。继续往同一组里添加图片时，会按当前高度重渲染整组图片。普通换行不会断开分组，空行才会断开。

## 要求

- Obsidian 1.8.7 或更新版本。

## 安装

从 Release 下载 `main.js`、`manifest.json` 和 `styles.css`，放到当前库的插件目录：

```text
.obsidian/plugins/kelan-uploader/
```

重启或刷新 Obsidian，然后在第三方插件中启用 **Kelan Image Uploader**。

## 设置

| 设置项 | 说明 |
| --- | --- |
| API 地址 | 接收图片文件的 POST 接口。 |
| 文件字段名 | multipart 表单中的图片字段名，默认是 `file`。 |
| 图片 URL 路径 | 从接口返回 JSON 中读取图片地址的点路径。 |
| HTTP 请求头 | 可选请求头，例如 `Authorization`。 |
| 图片处理 | 上传前缩放、压缩或转换格式。 |
| 自动同排图片 | 将没有空行隔开的相邻 Markdown 图片或同排图片合并为固定高度、可换行的图片流。 |
| 同排图片高度 | 自动同排图片使用的高度，宽度按图片原始比例缩放。 |

`Content-Type` 会由上传请求自动生成，不能在设置中手动覆盖。

## 手机端

在 Obsidian 手机端编辑 Markdown 笔记时，可以运行 **Kelan Image Uploader: 从设备选择图片上传** 命令，或点击 Obsidian 原生链接/附件图标后从相册选择图片。插件会上传图片，并把返回的图片 URL 插入到当前光标位置；原生附件入口先插入的本地 `![[...]]` 图片 embed 会被自动替换。

## CloudFlare ImgBed 示例

使用 [MarSeventh/CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed) 时，常见配置如下：

| 设置项 | 值 |
| --- | --- |
| API 地址 | `https://your-domain.example/upload?returnFormat=full` |
| 文件字段名 | `file` |
| 图片 URL 路径 | `0.src` |
| 请求头名称 | `Authorization` |
| 请求头值 | `Bearer your_imgbed_api_token` |

如果要指定上传通道，可以追加查询参数：

```text
&uploadChannel=cfr2
```

## 隐私

插件只会把图片发送到你配置的上传接口，不收集遥测数据，也不会把文件发送到内置第三方服务。

设置中的 API token 会保存在本地库的插件配置中，请按敏感信息处理。

## 开发

```bash
npm install
npm run build
```

生产构建会在仓库根目录生成 `main.js`。发布时需要上传：

- `main.js`
- `manifest.json`
- `styles.css`

Release tag 需要和 `manifest.json` 中的 `version` 一致。
