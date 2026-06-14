import { getLanguage } from 'obsidian';

type Locale = 'en' | 'zh';

type TranslationKey =
	| 'command.uploadFromDevice.name'
	| 'settings.uploadApi.heading'
	| 'settings.apiEndpoint.name'
	| 'settings.apiEndpoint.desc'
	| 'settings.fileFieldName.name'
	| 'settings.fileFieldName.desc'
	| 'settings.imageUrlPath.name'
	| 'settings.imageUrlPath.desc'
	| 'settings.transform.heading'
	| 'settings.transformEnabled.name'
	| 'settings.transformEnabled.desc'
	| 'settings.outputFormat.name'
	| 'settings.outputFormat.desc'
	| 'settings.outputFormat.original'
	| 'settings.outputFormat.jpeg'
	| 'settings.outputFormat.png'
	| 'settings.outputFormat.webp'
	| 'settings.quality.name'
	| 'settings.quality.desc'
	| 'settings.maxWidth.name'
	| 'settings.maxWidth.desc'
	| 'settings.maxHeight.name'
	| 'settings.maxHeight.desc'
	| 'settings.noLimit.placeholder'
	| 'settings.insertion.heading'
	| 'settings.autoInlineGallery.name'
	| 'settings.autoInlineGallery.desc'
	| 'settings.headers.heading'
	| 'settings.header.name'
	| 'settings.headerName.placeholder'
	| 'settings.headerValue.placeholder'
	| 'settings.removeHeader.tooltip'
	| 'settings.headers.desc'
	| 'settings.addHeader.button'
	| 'notice.contentTypeReserved'
	| 'notice.missingEndpoint'
	| 'notice.missingUrlPath'
	| 'notice.noImagesSelected'
	| 'notice.uploading'
	| 'notice.transformSkipped'
	| 'notice.uploadFailed'
	| 'placeholder.uploading';

const translations: Record<Locale, Record<TranslationKey, string>> = {
	en: {
		'command.uploadFromDevice.name': 'Upload images from device',
		'settings.uploadApi.heading': 'Upload API',
		'settings.apiEndpoint.name': 'API endpoint',
		'settings.apiEndpoint.desc': 'POST endpoint that receives the image as multipart/form-data.',
		'settings.fileFieldName.name': 'File field name',
		'settings.fileFieldName.desc': 'Multipart form field name for the image file.',
		'settings.imageUrlPath.name': 'Image URL path',
		'settings.imageUrlPath.desc': 'Dot path to the returned image URL, for example url, data.link, or 0.src.',
		'settings.transform.heading': 'Image transform',
		'settings.transformEnabled.name': 'Enable transform',
		'settings.transformEnabled.desc': 'Resize, compress, or convert static images before upload.',
		'settings.outputFormat.name': 'Output format',
		'settings.outputFormat.desc': 'SVG, animated GIF, and ICO keep their original files.',
		'settings.outputFormat.original': 'Original',
		'settings.outputFormat.jpeg': 'JPEG',
		'settings.outputFormat.png': 'PNG',
		'settings.outputFormat.webp': 'WebP',
		'settings.quality.name': 'Quality',
		'settings.quality.desc': 'Used by JPEG and WebP output.',
		'settings.maxWidth.name': 'Maximum width',
		'settings.maxWidth.desc': 'Leave empty to keep the original width.',
		'settings.maxHeight.name': 'Maximum height',
		'settings.maxHeight.desc': 'Leave empty to keep the original height.',
		'settings.noLimit.placeholder': 'No limit',
		'settings.insertion.heading': 'Insertion',
		'settings.autoInlineGallery.name': 'Auto inline gallery',
		'settings.autoInlineGallery.desc': 'Insert uploaded images as inline HTML and merge adjacent Markdown or gallery images with no blank line so they share the row width.',
		'settings.headers.heading': 'HTTP headers',
		'settings.header.name': 'Header {{index}}',
		'settings.headerName.placeholder': 'Header name',
		'settings.headerValue.placeholder': 'Value',
		'settings.removeHeader.tooltip': 'Remove header',
		'settings.headers.desc': 'Content-Type is generated automatically and cannot be overridden.',
		'settings.addHeader.button': 'Add header',
		'notice.contentTypeReserved': 'Content-Type is generated automatically for multipart uploads.',
		'notice.missingEndpoint': 'Configure the upload API endpoint before uploading images.',
		'notice.missingUrlPath': 'Configure the JSON URL path before uploading images.',
		'notice.noImagesSelected': 'No supported image files were selected.',
		'notice.uploading': 'Uploading {{count}} image{{plural}}...',
		'notice.transformSkipped': 'Transform skipped for {{name}}: {{reason}}',
		'notice.uploadFailed': 'Image upload failed: {{message}}',
		'placeholder.uploading': 'Uploading...',
	},
	zh: {
		'command.uploadFromDevice.name': '从设备选择图片上传',
		'settings.uploadApi.heading': '上传接口',
		'settings.apiEndpoint.name': 'API 地址',
		'settings.apiEndpoint.desc': '接收 multipart/form-data 图片文件的 POST 接口。',
		'settings.fileFieldName.name': '文件字段名',
		'settings.fileFieldName.desc': 'multipart 表单中图片文件对应的字段名。',
		'settings.imageUrlPath.name': '图片 URL 路径',
		'settings.imageUrlPath.desc': '从返回 JSON 中提取图片 URL 的点路径，例如 url、data.link 或 0.src。',
		'settings.transform.heading': '图片处理',
		'settings.transformEnabled.name': '启用图片处理',
		'settings.transformEnabled.desc': '上传前对静态图片进行缩放、压缩或格式转换。',
		'settings.outputFormat.name': '输出格式',
		'settings.outputFormat.desc': 'SVG、动图 GIF 和 ICO 会保留原文件上传。',
		'settings.outputFormat.original': '原格式',
		'settings.outputFormat.jpeg': 'JPEG',
		'settings.outputFormat.png': 'PNG',
		'settings.outputFormat.webp': 'WebP',
		'settings.quality.name': '质量',
		'settings.quality.desc': '用于 JPEG 和 WebP 输出。',
		'settings.maxWidth.name': '最大宽度',
		'settings.maxWidth.desc': '留空表示保持原始宽度。',
		'settings.maxHeight.name': '最大高度',
		'settings.maxHeight.desc': '留空表示保持原始高度。',
		'settings.noLimit.placeholder': '不限制',
		'settings.insertion.heading': '插入方式',
		'settings.autoInlineGallery.name': '自动同排图片',
		'settings.autoInlineGallery.desc': '将上传图片插入为内联 HTML，并在相邻 Markdown 或同排图片之间没有空行时自动合并同排、平分宽度。',
		'settings.headers.heading': 'HTTP 请求头',
		'settings.header.name': '请求头 {{index}}',
		'settings.headerName.placeholder': '请求头名称',
		'settings.headerValue.placeholder': '值',
		'settings.removeHeader.tooltip': '删除请求头',
		'settings.headers.desc': 'Content-Type 会自动生成，不能手动覆盖。',
		'settings.addHeader.button': '添加请求头',
		'notice.contentTypeReserved': 'Content-Type 会为 multipart 上传自动生成。',
		'notice.missingEndpoint': '上传图片前请先配置上传 API 地址。',
		'notice.missingUrlPath': '上传图片前请先配置返回 JSON 中的 URL 路径。',
		'notice.noImagesSelected': '没有选择受支持的图片文件。',
		'notice.uploading': '正在上传 {{count}} 张图片...',
		'notice.transformSkipped': '{{name}} 跳过图片处理：{{reason}}',
		'notice.uploadFailed': '图片上传失败：{{message}}',
		'placeholder.uploading': '正在上传...',
	},
};

export function t(key: TranslationKey, params: Record<string, string | number> = {}): string {
	let text = translations[getLocale()][key];
	for (const [name, value] of Object.entries(params)) {
		text = text.replaceAll(`{{${name}}}`, String(value));
	}
	return text;
}

function getLocale(): Locale {
	return getLanguage().toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
