import webpEncoderFactory, { type WebPModule } from '@jsquash/webp/codec/enc/webp_enc.js';
import webpEncoderWasm from '@jsquash/webp/codec/enc/webp_enc.wasm';
import { defaultOptions } from '@jsquash/webp/meta.js';
import { initEmscriptenModule } from '@jsquash/webp/utils.js';
import { ImageTransformSettings, OutputFormat } from './settings';
import { getExtension, getMimeTypeByExtension, replaceExtension } from './utils';

export interface PreparedUpload {
	fileName: string;
	mimeType: string;
	data: ArrayBuffer;
	skippedTransformReason?: string;
}

interface LoadedImage {
	source: CanvasImageSource;
	width: number;
	height: number;
	cleanup(): void;
}

const ENCODABLE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const WEBP_MIME_TYPE = 'image/webp';

const EMBEDDED_WEBP_WASM_URL = 'data:application/octet-stream;base64,';
let webpEncoderModule: Promise<WebPModule> | null = null;

export async function prepareImageForUpload(
	file: File,
	settings: ImageTransformSettings,
): Promise<PreparedUpload> {
	if (!settings.enabled) return readOriginalFile(file);

	const skippedReason = getTransformSkipReason(file, settings.outputFormat);
	if (skippedReason) {
		const original = await readOriginalFile(file);
		return { ...original, skippedTransformReason: skippedReason };
	}

	const image = await loadImage(file);
	try {
		const dimensions = fitWithin(image.width, image.height, settings.maxWidth, settings.maxHeight);
		const canvas = activeDocument.createElement('canvas');
		canvas.width = dimensions.width;
		canvas.height = dimensions.height;

		const context = canvas.getContext('2d');
		if (!context) throw new Error('Could not create a canvas rendering context.');

		const targetMimeType = getTargetMimeType(file, settings.outputFormat);
		if (targetMimeType === 'image/jpeg') {
			context.fillStyle = '#ffffff';
			context.fillRect(0, 0, canvas.width, canvas.height);
		}

		context.drawImage(image.source, 0, 0, canvas.width, canvas.height);

		const output = await canvasToEncodedBlob(canvas, context, targetMimeType, settings.quality);
		if (output.type !== targetMimeType) {
			throw new Error(`This environment cannot encode ${targetMimeType}.`);
		}

		return {
			fileName: getOutputFileName(file.name, settings.outputFormat, targetMimeType),
			mimeType: targetMimeType,
			data: await output.arrayBuffer(),
		};
	} finally {
		image.cleanup();
	}
}

async function readOriginalFile(file: File): Promise<PreparedUpload> {
	return {
		fileName: file.name || getFallbackFileName(file),
		mimeType: getOriginalMimeType(file),
		data: await file.arrayBuffer(),
	};
}

function getTransformSkipReason(file: File, outputFormat: OutputFormat): string | null {
	const mimeType = getOriginalMimeType(file);
	const extension = getExtension(file.name);

	if (mimeType === 'image/svg+xml' || extension === 'svg') {
		return 'SVG files are uploaded without canvas conversion.';
	}
	if (mimeType === 'image/gif' || extension === 'gif') {
		return 'GIF files are uploaded without canvas conversion to preserve animation.';
	}
	if (
		outputFormat === 'original'
		&& (mimeType === 'image/heic' || mimeType === 'image/heif' || extension === 'heic' || extension === 'heif')
	) {
		return 'HEIC and HEIF files are uploaded without original-format canvas conversion.';
	}
	if (mimeType === 'image/x-icon' || mimeType === 'image/vnd.microsoft.icon' || extension === 'ico') {
		return 'ICO files are uploaded without canvas conversion.';
	}
	if (outputFormat === 'original' && !ENCODABLE_MIME_TYPES.has(mimeType)) {
		return `${mimeType} cannot be re-encoded as its original format in this environment.`;
	}

	return null;
}

async function loadImage(file: File): Promise<LoadedImage> {
	if ('createImageBitmap' in activeWindow) {
		try {
			const bitmap = await activeWindow.createImageBitmap(file);
			return {
				source: bitmap,
				width: bitmap.width,
				height: bitmap.height,
				cleanup: () => bitmap.close(),
			};
		} catch {
			return loadImageElement(file);
		}
	}

	return loadImageElement(file);
}

function loadImageElement(file: File): Promise<LoadedImage> {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(file);
		const image = activeDocument.createElement('img');

		const cleanup = () => URL.revokeObjectURL(url);

		image.onload = () => {
			resolve({
				source: image,
				width: image.naturalWidth,
				height: image.naturalHeight,
				cleanup,
			});
		};
		image.onerror = () => {
			cleanup();
			reject(new Error(`Could not decode ${file.name || 'image'} for conversion.`));
		};

		image.src = url;
	});
}

function fitWithin(
	width: number,
	height: number,
	maxWidth: number | undefined,
	maxHeight: number | undefined,
): { width: number; height: number } {
	let scale = 1;

	if (maxWidth !== undefined && width > maxWidth) {
		scale = Math.min(scale, maxWidth / width);
	}
	if (maxHeight !== undefined && height > maxHeight) {
		scale = Math.min(scale, maxHeight / height);
	}

	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

async function canvasToEncodedBlob(
	canvas: HTMLCanvasElement,
	context: CanvasRenderingContext2D,
	mimeType: string,
	quality: number,
): Promise<Blob> {
	if (mimeType === WEBP_MIME_TYPE) {
		return canvasToWebpBlob(canvas, context, quality);
	}

	return canvasToBlob(canvas, mimeType, quality);
}

async function canvasToWebpBlob(
	canvas: HTMLCanvasElement,
	context: CanvasRenderingContext2D,
	quality: number,
): Promise<Blob> {
	const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
	const encoded = await encodeWebp(imageData, quality);
	return new Blob([toArrayBuffer(encoded)], { type: WEBP_MIME_TYPE });
}

async function encodeWebp(imageData: ImageData, quality: number): Promise<Uint8Array> {
	const module = await initializeWebpEncoder();
	const encoded = module.encode(imageData.data, imageData.width, imageData.height, {
		...defaultOptions,
		quality: toWebpQuality(quality),
	});
	if (!encoded) throw new Error(`Could not encode image as ${WEBP_MIME_TYPE}.`);
	return encoded;
}

async function initializeWebpEncoder(): Promise<WebPModule> {
	let module = webpEncoderModule;
	if (!module) {
		module = createWebpEncoderModule();
		webpEncoderModule = module;
	}
	return module;
}

async function createWebpEncoderModule(): Promise<WebPModule> {
	const module = await WebAssembly.compile(toArrayBuffer(webpEncoderWasm));
	return initEmscriptenModule<WebPModule>(webpEncoderFactory, module, {
		locateFile: () => EMBEDDED_WEBP_WASM_URL,
	});
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}

function toWebpQuality(quality: number): number {
	return Math.round(quality * 100);
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (!blob) {
					reject(new Error(`Could not encode image as ${mimeType}.`));
					return;
				}
				resolve(blob);
			},
			mimeType,
			quality,
		);
	});
}

function getTargetMimeType(file: File, outputFormat: OutputFormat): string {
	if (outputFormat === 'jpeg') return 'image/jpeg';
	if (outputFormat === 'png') return 'image/png';
	if (outputFormat === 'webp') return WEBP_MIME_TYPE;
	return getOriginalMimeType(file);
}

function getOriginalMimeType(file: File): string {
	const normalizedType = file.type.trim().toLowerCase();
	if (normalizedType === 'image/jpg') return 'image/jpeg';
	if (normalizedType.startsWith('image/')) return normalizedType;

	const extension = getExtension(file.name);
	if (extension) return getMimeTypeByExtension(extension);

	return 'application/octet-stream';
}

function getOutputFileName(fileName: string, outputFormat: OutputFormat, mimeType: string): string {
	if (outputFormat === 'original') {
		return fileName || getFallbackFileNameFromMime(mimeType);
	}

	return replaceExtension(fileName, getExtensionForMime(mimeType));
}

function getFallbackFileName(file: File): string {
	return getFallbackFileNameFromMime(getOriginalMimeType(file));
}

function getFallbackFileNameFromMime(mimeType: string): string {
	return `image.${getExtensionForMime(mimeType)}`;
}

function getExtensionForMime(mimeType: string): string {
	if (mimeType === 'image/jpeg') return 'jpg';
	if (mimeType === 'image/png') return 'png';
	if (mimeType === WEBP_MIME_TYPE) return 'webp';
	if (mimeType === 'image/gif') return 'gif';
	if (mimeType === 'image/heic') return 'heic';
	if (mimeType === 'image/heif') return 'heif';
	if (mimeType === 'image/svg+xml') return 'svg';
	if (mimeType === 'image/avif') return 'avif';
	if (mimeType === 'image/x-icon' || mimeType === 'image/vnd.microsoft.icon') return 'ico';
	return 'bin';
}
