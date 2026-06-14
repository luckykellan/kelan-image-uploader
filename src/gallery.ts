export interface GalleryImage {
	src: string;
	alt: string;
}

export interface GalleryReplacement {
	from: number;
	to: number;
	text: string;
}

const GALLERY_ATTRIBUTE = 'data-kelan-image-uploader="gallery"';
const LEGACY_GALLERY_ATTRIBUTE = 'data-image-upload-pipeline="gallery"';
const GENERATED_IMAGE_TAG = /<img\b(?=[^>]*\b(?:data-kelan-image-uploader|data-image-upload-pipeline)="gallery")[^>]*>/g;

export function createGalleryReplacement(
	content: string,
	currentRange: { from: number; to: number },
	image: GalleryImage,
): GalleryReplacement {
	const previous = findPreviousGallery(content, currentRange.from);
	const images = previous ? [...previous.images, image] : [image];

	return {
		from: previous?.from ?? currentRange.from,
		to: currentRange.to,
		text: renderGallery(images),
	};
}

function findPreviousGallery(content: string, offset: number): { from: number; images: GalleryImage[] } | null {
	let scanEnd = offset;
	const images: GalleryImage[] = [];
	let from = offset;

	while (true) {
		const adjacentEnd = findAdjacentContentEnd(content, scanEnd);
		if (adjacentEnd === null) break;

		const image = findGeneratedImageEndingAt(content, adjacentEnd) ?? findMarkdownImageEndingAt(content, adjacentEnd);
		if (!image) break;

		images.unshift(image.image);
		from = image.from;
		scanEnd = image.from;
	}

	if (images.length === 0) return null;
	return { from, images };
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

function findGeneratedImageEndingAt(
	content: string,
	end: number,
): { from: number; image: GalleryImage } | null {
	const openTagStart = content.lastIndexOf('<img', end - 1);
	if (openTagStart < 0) return null;

	const tag = content.slice(openTagStart, end);
	if (!tag.startsWith('<img') || !tag.endsWith('>') || !hasGeneratedGalleryAttribute(tag)) return null;
	if (!isSingleGeneratedImageTag(tag)) return null;

	const src = getAttribute(tag, 'src');
	if (src === null) return null;

	return {
		from: openTagStart,
		image: {
			src,
			alt: getAttribute(tag, 'alt') ?? '',
		},
	};
}

function findMarkdownImageEndingAt(
	content: string,
	end: number,
): { from: number; image: GalleryImage } | null {
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
		image: {
			src,
			alt: unescapeMarkdown(content.slice(openBracket + 1, openParen - 1)),
		},
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
	return value.includes(GALLERY_ATTRIBUTE) || value.includes(LEGACY_GALLERY_ATTRIBUTE);
}

function renderGallery(images: GalleryImage[]): string {
	const width = `calc(100% / ${images.length})`;
	return images.map((image) => renderGalleryImage(image, width)).join('');
}

function renderGalleryImage(image: GalleryImage, width: string): string {
	return [
		'<img',
		` ${GALLERY_ATTRIBUTE}`,
		` src="${escapeHtmlAttribute(image.src)}"`,
		` alt="${escapeHtmlAttribute(image.alt)}"`,
		` style="width: ${width}; height: auto;"`,
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
