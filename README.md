# kelan-image-uploader

[中文文档](README.zh-CN.md)

An Obsidian plugin for uploading selected, pasted, or dropped images to a configurable `multipart/form-data` API. It can resize, compress, or convert images before upload, then insert the returned image URL into the editor.

## Features

- Upload images from the command palette, paste, or drag-and-drop.
- Use any compatible `multipart/form-data` upload endpoint.
- Extract the final URL from JSON responses with paths such as `url`, `data.link`, or `0.src`.
- Optional resize, compression, and JPEG/PNG/WebP conversion.
- Preserve SVG, animated GIF, ICO, and other unsupported transform targets as original files.
- Upload multiple images while preserving insertion order.
- Auto inline gallery: when enabled, adjacent Markdown or gallery images with no blank line are merged into one row and share the row width.

Example gallery grouping:

```md
![](one.webp)
![](two.webp)
![](three.webp)

![](four.webp)
![](five.webp)
![](six.webp)
```

The blank line creates two gallery rows: three images in the first row and three images in the second row.

## Requirements

- Obsidian 1.8.7 or newer.

## Install

Download `main.js`, `manifest.json`, and `styles.css` from a release, then place them in:

```text
.obsidian/plugins/kelan-image-uploader/
```

Reload Obsidian and enable **kelan-image-uploader** in Community plugins.

## Settings

| Setting | Description |
| --- | --- |
| API endpoint | POST endpoint that receives the image file. |
| File field name | Multipart field name. Default: `file`. |
| Image URL path | Dot path used to read the returned URL. |
| HTTP headers | Optional headers such as `Authorization`. |
| Image transform | Resize, compress, or convert before upload. |
| Auto inline gallery | Merge adjacent Markdown or gallery images with no blank line into one row. |

`Content-Type` is generated automatically for multipart upload and cannot be overridden.

## Mobile

On Obsidian Mobile, run **kelan-image-uploader: Upload images from device** while editing a Markdown note. The command opens the system image picker, then uploads the selected images and inserts the returned URLs at the cursor.

## CloudFlare ImgBed Example

For [MarSeventh/CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed):

| Setting | Value |
| --- | --- |
| API endpoint | `https://your-domain.example/upload?returnFormat=full` |
| File field name | `file` |
| Image URL path | `0.src` |
| Header name | `Authorization` |
| Header value | `Bearer your_imgbed_api_token` |

To force an upload channel, append a query parameter:

```text
&uploadChannel=cfr2
```

## Privacy

The plugin sends images only to the API endpoint you configure. It does not collect telemetry or send files to any built-in third-party service.

API tokens stored in plugin settings are saved in your local vault configuration. Treat them as sensitive data.

## Development

```bash
npm install
npm run build
```

The production build outputs `main.js` in the repository root. Release assets are:

- `main.js`
- `manifest.json`
- `styles.css`

The release tag must match the `version` in `manifest.json`.
