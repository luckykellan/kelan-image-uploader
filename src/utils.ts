const IMAGE_EXTENSIONS = new Set([
	'avif',
	'gif',
	'heic',
	'heif',
	'ico',
	'jpeg',
	'jpg',
	'png',
	'svg',
	'webp',
]);

const MIME_BY_EXTENSION = new Map<string, string>([
	['avif', 'image/avif'],
	['gif', 'image/gif'],
	['heic', 'image/heic'],
	['heif', 'image/heif'],
	['ico', 'image/x-icon'],
	['jpeg', 'image/jpeg'],
	['jpg', 'image/jpeg'],
	['png', 'image/png'],
	['svg', 'image/svg+xml'],
	['webp', 'image/webp'],
]);

export function collectImageFiles(dataTransfer: DataTransfer | null | undefined): File[] {
	if (!dataTransfer) return [];

	const itemFiles = collectFilesFromItems(dataTransfer.items).filter(isImageFile);
	if (itemFiles.length > 0) return itemFiles;

	return collectImageFilesFromFileList(dataTransfer.files);
}

export function collectImageFilesFromFileList(fileList: FileList | null | undefined): File[] {
	if (!fileList) return [];
	return collectFilesFromFileList(fileList).filter(isImageFile);
}

export function collectImageFilesFromPicker(fileList: FileList | null | undefined): File[] {
	if (!fileList) return [];

	const files = collectFilesFromFileList(fileList);
	const imageFiles = files.filter(isImageFile);
	return imageFiles.length > 0 ? imageFiles : files;
}

export function isImageFile(file: File): boolean {
	if (file.type.toLowerCase().startsWith('image/')) return true;
	const extension = getExtension(file.name);
	return extension !== null && isImageExtension(extension);
}

export function isImageExtension(extension: string): boolean {
	return IMAGE_EXTENSIONS.has(normalizeExtension(extension));
}

export function getMimeTypeByExtension(extension: string): string {
	return MIME_BY_EXTENSION.get(normalizeExtension(extension)) ?? 'application/octet-stream';
}

export function getExtension(fileName: string): string | null {
	const lastDot = fileName.lastIndexOf('.');
	if (lastDot < 0 || lastDot === fileName.length - 1) return null;
	return normalizeExtension(fileName.slice(lastDot + 1));
}

export function replaceExtension(fileName: string, extension: string): string {
	const cleanedExtension = extension.replace(/^\./, '');
	const fallbackName = `image.${cleanedExtension}`;
	const trimmed = fileName.trim();
	if (!trimmed) return fallbackName;

	const lastSlash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
	const lastDot = trimmed.lastIndexOf('.');
	if (lastDot > lastSlash && lastDot > 0) {
		return `${trimmed.slice(0, lastDot)}.${cleanedExtension}`;
	}
	return `${trimmed}.${cleanedExtension}`;
}

export function escapeMarkdownUrl(url: string): string {
	return url.replace(/\\/g, '\\\\').replace(/\)/g, '\\)');
}

export function escapeMarkdownLinkText(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/\[/g, '\\[')
		.replace(/\]/g, '\\]');
}

export function getByPath(obj: unknown, path: string): unknown {
	const keys = path.split('.').map((key) => key.trim()).filter(Boolean);
	let current = obj;

	for (const key of keys) {
		if (current === null || typeof current !== 'object') return undefined;
		current = (current as Record<string, unknown>)[key];
	}

	return current;
}

function normalizeExtension(extension: string): string {
	return extension.trim().toLowerCase().replace(/^\./, '');
}

function collectFilesFromItems(items: DataTransferItemList): File[] {
	const files: File[] = [];
	for (let index = 0; index < items.length; index += 1) {
		const item = items[index];
		if (!item || item.kind !== 'file') continue;
		const file = item.getAsFile();
		if (file) files.push(file);
	}
	return files;
}

function collectFilesFromFileList(fileList: FileList): File[] {
	const files: File[] = [];
	for (let index = 0; index < fileList.length; index += 1) {
		const file = fileList.item(index);
		if (file) files.push(file);
	}
	return files;
}
