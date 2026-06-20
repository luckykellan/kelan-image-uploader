# Kelan Image Uploader

[中文文档](README.zh-CN.md)

An Obsidian plugin for uploading selected, pasted, dropped, or Obsidian-native attached images to a configurable `multipart/form-data` API. It can resize, compress, or convert images before upload, then insert the returned image URL into the editor.

## Features

- Upload images from the command palette, paste, drag-and-drop, or Obsidian-native attachments.
- Use any compatible `multipart/form-data` upload endpoint.
- Extract the final URL from JSON responses with paths such as `url`, `data.link`, or `0.src`.
- Optional resize, compression, and JPEG/PNG/WebP conversion.
- Preserve SVG, animated GIF, ICO, and other unsupported transform targets as original files.
- Upload multiple images while preserving insertion order.
- Auto inline gallery: when enabled, adjacent Markdown or gallery images with no blank line are merged into a fixed-height wrapping gallery.

Example gallery grouping:

```md
![](one.webp)
![](two.webp)
![](three.webp)

![](four.webp)
![](five.webp)
![](six.webp)
```

The blank line creates two gallery groups. Images keep the configured gallery height, preserve their aspect ratio, and wrap when the current row is full. Adding another image to an existing group re-renders the whole group with the current height setting.

## Requirements

- Obsidian 1.8.7 or newer.

## Install

Download `main.js`, `manifest.json`, and `styles.css` from a release, then place them in:

```text
.obsidian/plugins/kelan-uploader/
```

Reload Obsidian and enable **Kelan Image Uploader** in Community plugins.

## Settings

| Setting | Description |
| --- | --- |
| API endpoint | POST endpoint that receives the image file. |
| File field name | Multipart field name. Default: `file`. |
| Image URL path | Dot path used to read the returned URL. |
| HTTP headers | Optional headers such as `Authorization`. |
| Image transform | Resize, compress, or convert before upload. |
| Auto inline gallery | Merge adjacent Markdown or gallery images with no blank line into a fixed-height wrapping gallery. |
| Gallery image height | Height used by auto inline gallery images. Width follows each image's aspect ratio. |

`Content-Type` is generated automatically for multipart upload and cannot be overridden.

## Mobile

On Obsidian Mobile, run **Kelan Image Uploader: Upload images from device** while editing a Markdown note, or use Obsidian's native link/attachment button and choose images from the photo library. The plugin uploads the images and inserts the returned URLs at the cursor; local `![[...]]` image embeds inserted by the native attachment flow are replaced automatically.

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
