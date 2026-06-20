export interface GalleryImage {
	src: string;
	alt: string;
}

export interface GalleryReplacement {
	from: number;
	to: number;
	text: string;
}

export interface GalleryOptions {
	imageHeight: number;
}

const GALLERY_ATTRIBUTE = 'data-kelan-uploader="gallery"';
const PREVIOUS_GALLERY_ATTRIBUTE = 'data-kelan-image-uploader="gallery"';
const LEGACY_GALLERY_ATTRIBUTE = 'data-image-upload-pipeline="gallery"';
const GALLERY_CONTAINER_TAG = 'div';
const PREVIOUS_GALLERY_CONTAINER_TAG = 'span';
const GENERATED_IMAGE_TAG =
	/<img\b(?=[^>]*\b(?:data-kelan-uploader|data-kelan-image-uploader|data-image-upload-pipeline)="gallery")[^>]*>/g;
const GENERATED_GALLERY_END_TAG = `</${GALLERY_CONTAINER_TAG}>`;
const PREVIOUS_GENERATED_GALLERY_END_TAG = `</${PREVIOUS_GALLERY_CONTAINER_TAG}>`;

export function createGalleryReplacement(
	content: string,
	currentRange: { from: number; to: number },
	image: GalleryImage,
	options: GalleryOptions,
): GalleryReplacement {
	return createGalleryReplacementForImages(content, currentRange, [image], options);
}

export function createGalleryReplacementForImages(
	content: string,
	currentRange: { from: number; to: number },
	insertedImages: GalleryImage[],
	options: GalleryOptions,
): GalleryReplacement {
	const previous = findPreviousGallery(content, currentRange.from);
	const next = findNextGallery(content, currentRange.to);
	const images = [...(previous?.images ?? []), ...insertedImages, ...(next?.images ?? [])];

	return {
		from: previous?.from ?? currentRange.from,
		to: next?.to ?? currentRange.to,
		text: renderGallery(images, options),
	};
}

interface GalleryMatch {
	from: number;
	to: number;
	images: GalleryImage[];
}

function findPreviousGallery(content: string, offset: number): GalleryMatch | null {
	let scanEnd = offset;
	const images: GalleryImage[] = [];
	let from = offset;
	let to = offset;

	while (true) {
		const adjacentEnd = findAdjacentContentEnd(content, scanEnd);
		if (adjacentEnd === null) break;

		const match =
			findGeneratedGalleryEndingAt(content, adjacentEnd) ??
			findGeneratedImageEndingAt(content, adjacentEnd) ??
			findMarkdownImageEndingAt(content, adjacentEnd);
		if (!match) break;

		images.unshift(...match.images);
		from = match.from;
		scanEnd = match.from;
	}

	if (images.length === 0) return null;
	return { from, to, images };
}

function findNextGallery(content: string, offset: number): GalleryMatch | null {
	let scanStart = offset;
	const images: GalleryImage[] = [];
	let from = offset;
	let to = offset;

	while (true) {
		const adjacentStart = findAdjacentContentStart(content, scanStart);
		if (adjacentStart === null) break;

		const match =
			findGeneratedGalleryStartingAt(content, adjacentStart) ??
			findGeneratedImageStartingAt(content, adjacentStart) ??
			findMarkdownImageStartingAt(content, adjacentStart);
		if (!match) break;

		if (images.length === 0) from = match.from;
		images.push(...match.images);
		to = match.to;
		scanStart = match.to;
	}

	if (images.length === 0) return null;
	return { from, to, images };
}

function findAdjacentContentEnd(content: string, offset: number): number | null {
	let index = offset;
	let newlineCount = 0;

	while (index > 0) {
		const char = content[index - 1];
		if (char === ' ' || char === '\t') {
			index -= 1;
			continue;
		}
		if (char === '\n') {
			newlineCount += 1;
			index -= 1;
			if (index > 0 && content[index - 1] === '\r') index -= 1;
			if (newlineCount >= 2) return null;
			continue;
		}
		if (char === '\r') {
			newlineCount += 1;
			index -= 1;
			if (newlineCount >= 2) return null;
			continue;
		}
		break;
	}

	return index;
}

function findAdjacentContentStart(content: string, offset: number): number | null {
	let index = offset;
	let newlineCount = 0;

	while (index < content.length) {
		const char = content[index];
		if (char === ' ' || char === '\t') {
			index += 1;
			continue;
		}
		if (char === '\r') {
			newlineCount += 1;
			index += 1;
			if (index < content.length && content[index] === '\n') index += 1;
			if (newlineCount >= 2) return null;
			continue;
		}
		if (char === '\n') {
			newlineCount += 1;
			index += 1;
			if (newlineCount >= 2) return null;
			continue;
		}
		break;
	}

	return index;
}

function findGeneratedGalleryEndingAt(content: string, end: number): GalleryMatch | null {
	return (
		findGeneratedGalleryContainerEndingAt(content, end, GALLERY_CONTAINER_TAG, GENERATED_GALLERY_END_TAG) ??
		findGeneratedGalleryContainerEndingAt(
			content,
			end,
			PREVIOUS_GALLERY_CONTAINER_TAG,
			PREVIOUS_GENERATED_GALLERY_END_TAG,
		)
	);
}

function findGeneratedGalleryContainerEndingAt(
	content: string,
	end: number,
	tagName: string,
	endTag: string,
): GalleryMatch | null {
	if (end < endTag.length) return null;
	if (content.slice(end - endTag.length, end).toLowerCase() !== endTag) return null;

	const openTagStart = content.lastIndexOf(`<${tagName}`, end - endTag.length);
	if (openTagStart < 0) return null;

	const html = content.slice(openTagStart, end);
	const openTagEnd = html.indexOf('>');
	if (openTagEnd < 0) return null;

	const openTag = html.slice(0, openTagEnd + 1);
	if (!hasGeneratedGalleryAttribute(openTag)) return null;

	const body = html.slice(openTagEnd + 1, html.length - endTag.length);
	const images = parseGeneratedImages(body);
	if (images.length === 0) return null;

	return {
		from: openTagStart,
		to: end,
		images,
	};
}

function findGeneratedGalleryStartingAt(content: string, start: number): GalleryMatch | null {
	return (
		findGeneratedGalleryContainerStartingAt(content, start, GALLERY_CONTAINER_TAG, GENERATED_GALLERY_END_TAG) ??
		findGeneratedGalleryContainerStartingAt(
			content,
			start,
			PREVIOUS_GALLERY_CONTAINER_TAG,
			PREVIOUS_GENERATED_GALLERY_END_TAG,
		)
	);
}

function findGeneratedGalleryContainerStartingAt(
	content: string,
	start: number,
	tagName: string,
	endTag: string,
): GalleryMatch | null {
	if (!content.startsWith(`<${tagName}`, start)) return null;

	const openTagEnd = content.indexOf('>', start);
	if (openTagEnd < 0) return null;

	const openTag = content.slice(start, openTagEnd + 1);
	if (!hasGeneratedGalleryAttribute(openTag)) return null;

	const endTagStart = content.indexOf(endTag, openTagEnd + 1);
	if (endTagStart < 0) return null;

	const body = content.slice(openTagEnd + 1, endTagStart);
	const images = parseGeneratedImages(body);
	if (images.length === 0) return null;

	return {
		from: start,
		to: endTagStart + endTag.length,
		images,
	};
}

function findGeneratedImageEndingAt(content: string, end: number): GalleryMatch | null {
	const openTagStart = content.lastIndexOf('<img', end - 1);
	if (openTagStart < 0) return null;

	const tag = content.slice(openTagStart, end);
	if (!tag.startsWith('<img') || !tag.endsWith('>') || !hasGeneratedGalleryAttribute(tag)) return null;
	if (!isSingleGeneratedImageTag(tag)) return null;

	const src = getAttribute(tag, 'src');
	if (src === null) return null;

	return {
		from: openTagStart,
		to: end,
		images: [
			{
				src,
				alt: getAttribute(tag, 'alt') ?? '',
			},
		],
	};
}

function findGeneratedImageStartingAt(content: string, start: number): GalleryMatch | null {
	if (!content.startsWith('<img', start)) return null;

	const tagEnd = content.indexOf('>', start);
	if (tagEnd < 0) return null;

	const tag = content.slice(start, tagEnd + 1);
	if (!hasGeneratedGalleryAttribute(tag)) return null;
	if (!isSingleGeneratedImageTag(tag)) return null;

	const src = getAttribute(tag, 'src');
	if (src === null) return null;

	return {
		from: start,
		to: tagEnd + 1,
		images: [
			{
				src,
				alt: getAttribute(tag, 'alt') ?? '',
			},
		],
	};
}

function findMarkdownImageEndingAt(content: string, end: number): GalleryMatch | null {
	if (end <= 0 || content[end - 1] !== ')') return null;

	const openParen = findMatchingOpenParen(content, end - 1);
	if (openParen === null || openParen < 3 || content[openParen - 1] !== ']') return null;

	const openBracket = findMatchingOpenBracket(content, openParen - 1);
	if (openBracket === null || openBracket === 0 || content[openBracket - 1] !== '!') return null;

	const from = openBracket - 1;
	const markdown = content.slice(from, end);
	if (markdown.includes('\n') || markdown.includes('\r')) return null;

	const src = parseMarkdownDestination(content.slice(openParen + 1, end - 1));
	if (src === null) return null;

	return {
		from,
		to: end,
		images: [
			{
				src,
				alt: unescapeMarkdown(content.slice(openBracket + 1, openParen - 1)),
			},
		],
	};
}

function findMarkdownImageStartingAt(content: string, start: number): GalleryMatch | null {
	if (content[start] !== '!' || content[start + 1] !== '[') return null;

	const closeBracket = findMatchingCloseBracket(content, start + 1);
	if (closeBracket === null || content[closeBracket + 1] !== '(') return null;

	const openParen = closeBracket + 1;
	const closeParen = findMatchingCloseParen(content, openParen);
	if (closeParen === null) return null;

	const src = parseMarkdownDestination(content.slice(openParen + 1, closeParen));
	if (src === null) return null;

	return {
		from: start,
		to: closeParen + 1,
		images: [
			{
				src,
				alt: unescapeMarkdown(content.slice(start + 2, closeBracket)),
			},
		],
	};
}

function findMatchingOpenParen(content: string, closeParen: number): number | null {
	let depth = 0;

	for (let index = closeParen; index >= 0; index -= 1) {
		const char = content[index];
		if (char === '\n' || char === '\r') return null;
		if (isEscaped(content, index)) continue;
		if (char === ')') {
			depth += 1;
			continue;
		}
		if (char === '(') {
			depth -= 1;
			if (depth === 0) return index;
		}
	}

	return null;
}

function findMatchingCloseParen(content: string, openParen: number): number | null {
	let depth = 0;

	for (let index = openParen; index < content.length; index += 1) {
		const char = content[index];
		if (char === '\n' || char === '\r') return null;
		if (isEscaped(content, index)) continue;
		if (char === '(') {
			depth += 1;
			continue;
		}
		if (char === ')') {
			depth -= 1;
			if (depth === 0) return index;
		}
	}

	return null;
}

function findMatchingOpenBracket(content: string, closeBracket: number): number | null {
	let depth = 0;

	for (let index = closeBracket; index >= 0; index -= 1) {
		const char = content[index];
		if (char === '\n' || char === '\r') return null;
		if (isEscaped(content, index)) continue;
		if (char === ']') {
			depth += 1;
			continue;
		}
		if (char === '[') {
			depth -= 1;
			if (depth === 0) return index;
		}
	}

	return null;
}

function findMatchingCloseBracket(content: string, openBracket: number): number | null {
	let depth = 0;

	for (let index = openBracket; index < content.length; index += 1) {
		const char = content[index];
		if (char === '\n' || char === '\r') return null;
		if (isEscaped(content, index)) continue;
		if (char === '[') {
			depth += 1;
			continue;
		}
		if (char === ']') {
			depth -= 1;
			if (depth === 0) return index;
		}
	}

	return null;
}

function parseMarkdownDestination(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) return null;

	if (trimmed.startsWith('<')) {
		const closeAngle = trimmed.indexOf('>');
		if (closeAngle <= 1) return null;
		return unescapeMarkdown(trimmed.slice(1, closeAngle));
	}

	const boundary = findMarkdownDestinationBoundary(trimmed);
	const destination = trimmed.slice(0, boundary);
	if (!destination) return null;
	return unescapeMarkdown(destination);
}

function findMarkdownDestinationBoundary(value: string): number {
	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
		if (!isEscaped(value, index) && (char === ' ' || char === '\t')) return index;
	}
	return value.length;
}

function unescapeMarkdown(value: string): string {
	return value.replace(/\\([\\()[\]])/g, '$1');
}

function isEscaped(value: string, index: number): boolean {
	let slashCount = 0;
	for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
		slashCount += 1;
	}
	return slashCount % 2 === 1;
}

function isSingleGeneratedImageTag(value: string): boolean {
	GENERATED_IMAGE_TAG.lastIndex = 0;
	const match = GENERATED_IMAGE_TAG.exec(value);
	return match !== null && match.index === 0 && match[0].length === value.length;
}

function hasGeneratedGalleryAttribute(value: string): boolean {
	return (
		value.includes(GALLERY_ATTRIBUTE) ||
		value.includes(PREVIOUS_GALLERY_ATTRIBUTE) ||
		value.includes(LEGACY_GALLERY_ATTRIBUTE)
	);
}

function parseGeneratedImages(value: string): GalleryImage[] {
	const images: GalleryImage[] = [];
	let cursor = 0;

	GENERATED_IMAGE_TAG.lastIndex = 0;
	while (true) {
		const match = GENERATED_IMAGE_TAG.exec(value);
		if (!match) break;
		if (value.slice(cursor, match.index).trim()) return [];

		const tag = match[0];
		const src = getAttribute(tag, 'src');
		if (src === null) return [];

		images.push({
			src,
			alt: getAttribute(tag, 'alt') ?? '',
		});
		cursor = match.index + tag.length;
	}

	if (value.slice(cursor).trim()) return [];
	return images;
}

function renderGallery(images: GalleryImage[], options: GalleryOptions): string {
	const imageHeight = Math.max(1, Math.floor(options.imageHeight));

	return [
		`<${GALLERY_CONTAINER_TAG}`,
		` ${GALLERY_ATTRIBUTE}`,
		' data-kelan-gallery-layout="wrap"',
		` style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 0; width: 100%; max-width: 100%; overflow: hidden; --kelan-gallery-image-height: ${imageHeight}px;"`,
		'>',
		images.map((image) => renderGalleryImage(image, imageHeight)).join(''),
		GENERATED_GALLERY_END_TAG,
	].join('');
}

function renderGalleryImage(image: GalleryImage, imageHeight: number): string {
	return [
		'<img',
		` ${GALLERY_ATTRIBUTE}`,
		` src="${escapeHtmlAttribute(image.src)}"`,
		` alt="${escapeHtmlAttribute(image.alt)}"`,
		` style="display: block; flex: 0 0 auto; height: ${imageHeight}px; width: auto; max-width: none; object-fit: contain;"`,
		'>',
	].join('');
}

function getAttribute(tag: string, name: string): string | null {
	const pattern = new RegExp(`\\s${escapeRegExp(name)}="([^"]*)"`);
	const match = pattern.exec(tag);
	if (!match) return null;
	return unescapeHtmlAttribute(match[1] ?? '');
}

function escapeHtmlAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function unescapeHtmlAttribute(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
