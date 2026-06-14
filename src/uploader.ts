import { requestUrl } from 'obsidian';
import { getUsableHeaders, ImageUploaderSettings } from './settings';
import { PreparedUpload } from './transform';
import { getByPath } from './utils';

const DEFAULT_FILE_FIELD_NAME = 'file';
const MAX_ERROR_BODY_LENGTH = 300;

export async function uploadImage(upload: PreparedUpload, settings: ImageUploaderSettings): Promise<string> {
	const headers = buildHeaders(settings);
	const fieldName = settings.fileFieldName.trim() || DEFAULT_FILE_FIELD_NAME;
	const { body, contentType } = buildMultipartBody(fieldName, upload);

	const response = await requestUrl({
		url: settings.apiEndpoint.trim(),
		method: 'POST',
		headers: {
			...headers,
			'Content-Type': contentType,
		},
		body,
		throw: false,
	});

	if (response.status < 200 || response.status >= 300) {
		throw new Error(formatStatusError(response.status, response.text));
	}

	const data = readJsonResponse(response.json);
	const url = getByPath(data, settings.imageUrlPath.trim());
	if (typeof url !== 'string' || !url.trim()) {
		throw new Error(`Could not extract an image URL using path "${settings.imageUrlPath}".`);
	}

	return url;
}

function buildHeaders(settings: ImageUploaderSettings): Record<string, string> {
	const headers: Record<string, string> = {};
	for (const entry of getUsableHeaders(settings.headers)) {
		headers[entry.key.trim()] = entry.value;
	}
	return headers;
}

function buildMultipartBody(
	fieldName: string,
	upload: PreparedUpload,
): { body: ArrayBuffer; contentType: string } {
	const boundary = createBoundary();
	const encoder = new TextEncoder();
	const header = [
		`--${boundary}`,
		`Content-Disposition: form-data; name="${escapeHeaderValue(fieldName)}"; filename="${escapeHeaderValue(upload.fileName)}"`,
		`Content-Type: ${upload.mimeType || 'application/octet-stream'}`,
		'',
		'',
	].join('\r\n');
	const footer = `\r\n--${boundary}--\r\n`;

	const headerBytes = encoder.encode(header);
	const fileBytes = new Uint8Array(upload.data);
	const footerBytes = encoder.encode(footer);
	const body = new Uint8Array(headerBytes.length + fileBytes.length + footerBytes.length);

	body.set(headerBytes, 0);
	body.set(fileBytes, headerBytes.length);
	body.set(footerBytes, headerBytes.length + fileBytes.length);

	return {
		body: body.buffer,
		contentType: `multipart/form-data; boundary=${boundary}`,
	};
}

function createBoundary(): string {
	const id = activeWindow.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	return `----ObsidianImg${id.replace(/[^a-zA-Z0-9]/g, '')}`;
}

function escapeHeaderValue(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '%22').replace(/[\r\n]/g, '_');
}

function readJsonResponse(value: unknown): unknown {
	if (value === undefined || value === null) {
		throw new Error('Upload response did not contain JSON.');
	}
	return value;
}

function formatStatusError(status: number, text: string): string {
	const trimmed = text.trim();
	if (!trimmed) return `Upload API responded with status ${status}.`;
	const body = trimmed.length > MAX_ERROR_BODY_LENGTH ? `${trimmed.slice(0, MAX_ERROR_BODY_LENGTH)}...` : trimmed;
	return `Upload API responded with status ${status}: ${body}`;
}
