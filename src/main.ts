import {
	Editor,
	type MarkdownFileInfo,
	MarkdownView,
	Notice,
	parseLinktext,
	Plugin,
	type TFile,
} from 'obsidian';
import { createGalleryReplacement } from './gallery';
import { t } from './i18n';
import {
	DEFAULT_SETTINGS,
	ImageUploaderSettingTab,
	ImageUploaderSettings,
	normalizeSettings,
	validateUploadSettings,
} from './settings';
import { prepareImageForUpload } from './transform';
import { uploadImage } from './uploader';
import {
	collectImageFiles,
	collectImageFilesFromPicker,
	escapeMarkdownLinkText,
	escapeMarkdownUrl,
	getExtension,
	getMimeTypeByExtension,
	isImageExtension,
} from './utils';

interface UploadPlaceholder {
	id: string;
	markdown: string;
}

interface UploadTask {
	file: File;
	placeholder: UploadPlaceholder;
}

interface OffsetRange {
	from: number;
	to: number;
}

interface NativeAttachmentEmbed extends OffsetRange {
	linktext: string;
}

interface NativeAttachmentReplacement extends OffsetRange {
	file: File;
	placeholder: UploadPlaceholder;
}

interface NativeAttachmentScanResult {
	replacements: NativeAttachmentReplacement[];
	hasUnresolvedImageEmbed: boolean;
}

const UPLOAD_CONCURRENCY = 3;
const CHANGE_SOURCE = 'kelan-uploader';
const PLACEHOLDER_PROTOCOL = 'kelan-uploader';
const NATIVE_ATTACHMENT_EMBED = /!\[\[([^\]\r\n]+)\]\]/g;
const NATIVE_ATTACHMENT_RETRY_DELAYS = [500, 1500] as const;

export default class ObsidianImageUploaderPlugin extends Plugin {
	settings: ImageUploaderSettings = DEFAULT_SETTINGS;
	private uploadSequence = 0;
	private readonly editorContentSnapshots = new WeakMap<Editor, string>();
	private processingNativeAttachmentEmbeds = false;
	private readonly nativeAttachmentRetryTimers = new Set<number>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new ImageUploaderSettingTab(this.app, this));
		this.app.workspace.onLayoutReady(() => this.captureActiveEditorContent());
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.captureActiveEditorContent()));
		this.registerEvent(this.app.workspace.on('file-open', () => this.captureActiveEditorContent()));
		this.register(() => this.clearNativeAttachmentRetryTimers());

		this.addCommand({
			id: 'upload-images-from-device',
			name: t('command.uploadFromDevice.name'),
			icon: 'image-plus',
			editorCallback: (editor) => {
				this.openImagePicker(editor);
			},
		});

		this.registerEvent(
			this.app.workspace.on(
				'editor-paste',
				(evt: ClipboardEvent, editor: Editor, _info: MarkdownView | MarkdownFileInfo) => {
					if (evt.defaultPrevented) return;
					if (!this.handleEditorFiles(editor, collectImageFiles(evt.clipboardData))) return;
					evt.preventDefault();
					evt.stopPropagation();
				},
			),
		);

		this.registerEvent(
			this.app.workspace.on('editor-change', (editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
				this.handleEditorChange(editor, info);
			}),
		);

		this.registerEvent(
			this.app.workspace.on(
				'editor-drop',
				(evt: DragEvent, editor: Editor, _info: MarkdownView | MarkdownFileInfo) => {
					if (evt.defaultPrevented) return;
					if (!this.handleEditorFiles(editor, collectImageFiles(evt.dataTransfer))) return;
					evt.preventDefault();
					evt.stopPropagation();
				},
			),
		);
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private handleEditorFiles(editor: Editor, files: File[]): boolean {
		if (files.length === 0) return false;

		const validationError = validateUploadSettings(this.settings);
		if (validationError) {
			new Notice(validationError);
			return false;
		}

		const tasks = files.map((file) => ({
			file,
			placeholder: this.createPlaceholder(file),
		}));

		editor.replaceSelection(tasks.map((task) => task.placeholder.markdown).join('\n'));
		new Notice(t('notice.uploading', { count: tasks.length, plural: tasks.length === 1 ? '' : 's' }));

		void this.processUploads(editor, tasks);
		return true;
	}

	private handleEditorChange(editor: Editor, info: MarkdownView | MarkdownFileInfo): void {
		const content = editor.getValue();
		const previousContent = this.editorContentSnapshots.get(editor);
		this.editorContentSnapshots.set(editor, content);

		if (this.processingNativeAttachmentEmbeds) return;

		const scanRanges = previousContent === undefined
			? getCursorScanRanges(editor, content)
			: getChangedScanRanges(previousContent, content);
		if (scanRanges.length === 0) return;

		void this.processNativeAttachmentEmbeds(editor, info, scanRanges, 0);
	}

	private async processNativeAttachmentEmbeds(
		editor: Editor,
		info: MarkdownView | MarkdownFileInfo,
		scanRanges: OffsetRange[],
		retryIndex: number,
		sourceFileOverride?: TFile,
	): Promise<void> {
		if (this.processingNativeAttachmentEmbeds) return;

		this.processingNativeAttachmentEmbeds = true;
		try {
			const content = editor.getValue();
			const ranges = scanRanges.map((range) => expandToLineRange(content, range));
			if (!rangesContainNativeImageEmbed(content, ranges)) return;

			const validationError = validateUploadSettings(this.settings);
			if (validationError) {
				new Notice(validationError);
				return;
			}

			const sourceFile = sourceFileOverride ?? info.file ?? this.app.workspace.getActiveFile();
			if (!sourceFile) return;

			const scanResult = await this.collectNativeAttachmentReplacements(content, sourceFile, ranges);
			if (scanResult.hasUnresolvedImageEmbed) {
				this.scheduleNativeAttachmentRescan(editor, info, sourceFile, ranges, retryIndex);
			}
			if (scanResult.replacements.length === 0) return;

			const uploadTasks = scanResult.replacements.map((replacement) => ({
				file: replacement.file,
				placeholder: replacement.placeholder,
			}));

			for (const replacement of [...scanResult.replacements].sort((left, right) => right.from - left.from)) {
				const from = editor.offsetToPos(replacement.from);
				const to = editor.offsetToPos(replacement.to);
				editor.replaceRange(replacement.placeholder.markdown, from, to, CHANGE_SOURCE);
			}

			this.editorContentSnapshots.set(editor, editor.getValue());
			new Notice(t('notice.uploading', {
				count: uploadTasks.length,
				plural: uploadTasks.length === 1 ? '' : 's',
			}));
			void this.processUploads(editor, uploadTasks);
		} finally {
			this.processingNativeAttachmentEmbeds = false;
		}
	}

	private async collectNativeAttachmentReplacements(
		content: string,
		sourceFile: TFile,
		scanRanges: OffsetRange[],
	): Promise<NativeAttachmentScanResult> {
		const replacements: NativeAttachmentReplacement[] = [];
		let hasUnresolvedImageEmbed = false;

		for (const embed of findNativeAttachmentEmbeds(content, scanRanges)) {
			const linkPath = getWikilinkPath(embed.linktext);
			if (!linkPath) continue;

			const extension = getExtension(linkPath);
			if (extension !== null && !isImageExtension(extension)) continue;

			const targetFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourceFile.path);
			if (!targetFile) {
				if (extension !== null && isImageExtension(extension)) hasUnresolvedImageEmbed = true;
				continue;
			}
			if (!isImageExtension(targetFile.extension)) continue;

			try {
				const file = await this.createFileFromVaultAttachment(targetFile);
				replacements.push({
					from: embed.from,
					to: embed.to,
					file,
					placeholder: this.createPlaceholder(file),
				});
			} catch (error) {
				new Notice(t('notice.uploadFailed', { message: getErrorMessage(error) }));
			}
		}

		return {
			replacements,
			hasUnresolvedImageEmbed,
		};
	}

	private async createFileFromVaultAttachment(file: TFile): Promise<File> {
		const data = await this.app.vault.readBinary(file);
		return new File([data], file.name, {
			type: getMimeTypeByExtension(file.extension),
		});
	}

	private scheduleNativeAttachmentRescan(
		editor: Editor,
		info: MarkdownView | MarkdownFileInfo,
		sourceFile: TFile,
		scanRanges: OffsetRange[],
		retryIndex: number,
	): void {
		const delay = NATIVE_ATTACHMENT_RETRY_DELAYS[retryIndex];
		if (delay === undefined) return;

		const timer = activeWindow.setTimeout(() => {
			this.nativeAttachmentRetryTimers.delete(timer);
			void this.processNativeAttachmentEmbeds(editor, info, scanRanges, retryIndex + 1, sourceFile);
		}, delay);
		this.nativeAttachmentRetryTimers.add(timer);
	}

	private captureActiveEditorContent(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		this.editorContentSnapshots.set(view.editor, view.editor.getValue());
	}

	private clearNativeAttachmentRetryTimers(): void {
		for (const timer of this.nativeAttachmentRetryTimers) {
			activeWindow.clearTimeout(timer);
		}
		this.nativeAttachmentRetryTimers.clear();
	}

	private openImagePicker(editor: Editor): void {
		const input = activeDocument.createElement('input');
		input.type = 'file';
		input.accept = 'image/*';
		input.multiple = true;
		input.addClass('kelan-uploader-hidden-file-input');
		let handled = false;

		function handleWindowFocus() {
			activeWindow.setTimeout(handleSelection, 250);
		}

		function cleanup() {
			activeWindow.removeEventListener('focus', handleWindowFocus);
			input.remove();
		}

		const handleSelection = () => {
			if (handled) return;
			if (!input.files || input.files.length === 0) return;

			handled = true;
			const imageFiles = collectImageFilesFromPicker(input.files);
			const selectedFileCount = input.files?.length ?? 0;
			cleanup();

			if (imageFiles.length === 0) {
				if (selectedFileCount > 0) new Notice(t('notice.noImagesSelected'));
				return;
			}

			editor.focus();
			this.handleEditorFiles(editor, imageFiles);
		};

		input.addEventListener('input', handleSelection);
		input.addEventListener('change', handleSelection);
		input.addEventListener('cancel', cleanup, { once: true });
		activeWindow.addEventListener('focus', handleWindowFocus);

		activeDocument.body.appendChild(input);
		input.click();

		activeWindow.setTimeout(handleSelection, 500);
	}

	private async processUploads(editor: Editor, tasks: UploadTask[]): Promise<void> {
		const concurrency = this.settings.autoInlineGallery ? 1 : UPLOAD_CONCURRENCY;

		await runWithConcurrency(tasks, concurrency, async (task) => {
			try {
				const prepared = await prepareImageForUpload(task.file, this.settings.transform);
				if (prepared.skippedTransformReason) {
					new Notice(t('notice.transformSkipped', {
						name: task.file.name || 'image',
						reason: prepared.skippedTransformReason,
					}));
				}

				const url = await uploadImage(prepared, this.settings);
				this.replaceUploadedImage(editor, task.placeholder, url, prepared.fileName);
			} catch (error) {
				this.replacePlaceholder(editor, task.placeholder, '');
				new Notice(t('notice.uploadFailed', { message: getErrorMessage(error) }));
			}
		});
	}

	private createPlaceholder(file: File): UploadPlaceholder {
		this.uploadSequence += 1;
		const id = `${Date.now().toString(36)}-${this.uploadSequence}-${Math.random().toString(36).slice(2)}`;
		const placeholderText = escapeMarkdownLinkText(t('placeholder.uploading'));
		return {
			id,
			markdown: `[${placeholderText}](${PLACEHOLDER_PROTOCOL}://${id})`,
		};
	}

	private replaceUploadedImage(editor: Editor, placeholder: UploadPlaceholder, url: string, alt: string): boolean {
		const content = editor.getValue();
		const range = findPlaceholderRange(content, placeholder);
		if (!range) return false;

		if (!this.settings.autoInlineGallery) {
			const replacement = `![](${escapeMarkdownUrl(url)})`;
			const from = editor.offsetToPos(range.from);
			const to = editor.offsetToPos(range.to);
			editor.replaceRange(replacement, from, to, CHANGE_SOURCE);
			return true;
		}

		const replacement = createGalleryReplacement(
			content,
			range,
			{
				src: url,
				alt,
			},
			{
				imageHeight: this.settings.autoInlineGalleryHeight,
			},
		);
		const from = editor.offsetToPos(replacement.from);
		const to = editor.offsetToPos(replacement.to);
		editor.replaceRange(replacement.text, from, to, CHANGE_SOURCE);
		return true;
	}

	private replacePlaceholder(editor: Editor, placeholder: UploadPlaceholder, replacement: string): boolean {
		const content = editor.getValue();
		const range = findPlaceholderRange(content, placeholder);
		if (!range) return false;

		const from = editor.offsetToPos(range.from);
		const to = editor.offsetToPos(range.to);
		editor.replaceRange(replacement, from, to, CHANGE_SOURCE);
		return true;
	}
}

function getChangedScanRanges(previousContent: string, content: string): OffsetRange[] {
	const changedRange = getChangedRange(previousContent, content);
	if (!changedRange) return [];

	const scanRange = expandToLineRange(content, changedRange);
	return rangesContainNativeImageEmbed(content, [scanRange]) ? [scanRange] : [];
}

function getChangedRange(previousContent: string, content: string): OffsetRange | null {
	if (previousContent === content) return null;

	let prefixLength = 0;
	const minLength = Math.min(previousContent.length, content.length);
	while (
		prefixLength < minLength &&
		previousContent[prefixLength] === content[prefixLength]
	) {
		prefixLength += 1;
	}

	let previousSuffixStart = previousContent.length;
	let contentSuffixStart = content.length;
	while (
		previousSuffixStart > prefixLength &&
		contentSuffixStart > prefixLength &&
		previousContent[previousSuffixStart - 1] === content[contentSuffixStart - 1]
	) {
		previousSuffixStart -= 1;
		contentSuffixStart -= 1;
	}

	if (contentSuffixStart <= prefixLength) return null;
	return {
		from: prefixLength,
		to: contentSuffixStart,
	};
}

function getCursorScanRanges(editor: Editor, content: string): OffsetRange[] {
	const cursorOffset = editor.posToOffset(editor.getCursor());
	if (cursorOffset < 0) return [];

	const scanRange = expandToLineRange(content, {
		from: Math.min(cursorOffset, content.length),
		to: Math.min(cursorOffset, content.length),
	});
	return rangesContainNativeImageEmbed(content, [scanRange]) ? [scanRange] : [];
}

function expandToLineRange(content: string, range: OffsetRange): OffsetRange {
	const from = clampOffset(range.from, content.length);
	const to = clampOffset(range.to, content.length);
	const lineStart = content.lastIndexOf('\n', Math.max(0, from - 1)) + 1;
	const nextLineBreak = content.indexOf('\n', to);
	return {
		from: lineStart,
		to: nextLineBreak < 0 ? content.length : nextLineBreak,
	};
}

function rangesContainNativeImageEmbed(content: string, ranges: OffsetRange[]): boolean {
	return findNativeAttachmentEmbeds(content, ranges).some((embed) => {
		const linkPath = getWikilinkPath(embed.linktext);
		const extension = linkPath ? getExtension(linkPath) : null;
		return extension !== null && isImageExtension(extension);
	});
}

function findNativeAttachmentEmbeds(content: string, ranges: OffsetRange[]): NativeAttachmentEmbed[] {
	const embeds: NativeAttachmentEmbed[] = [];
	const seen = new Set<string>();

	for (const range of ranges) {
		const from = clampOffset(range.from, content.length);
		const to = clampOffset(range.to, content.length);
		if (to <= from) continue;

		NATIVE_ATTACHMENT_EMBED.lastIndex = 0;
		const slice = content.slice(from, to);
		let match: RegExpExecArray | null;
		while ((match = NATIVE_ATTACHMENT_EMBED.exec(slice)) !== null) {
			const embedFrom = from + match.index;
			const embedTo = embedFrom + match[0].length;
			const key = `${embedFrom}:${embedTo}`;
			if (seen.has(key)) continue;

			seen.add(key);
			embeds.push({
				from: embedFrom,
				to: embedTo,
				linktext: match[1] ?? '',
			});
		}
	}

	return embeds.sort((left, right) => left.from - right.from);
}

function getWikilinkPath(linktext: string): string | null {
	const destination = getWikilinkDestination(linktext);
	if (!destination) return null;

	const parsed = parseLinktext(destination);
	const path = parsed.path.trim();
	return path || null;
}

function getWikilinkDestination(linktext: string): string {
	for (let index = 0; index < linktext.length; index += 1) {
		if (linktext[index] === '|' && !isEscaped(linktext, index)) {
			return linktext.slice(0, index).trim();
		}
	}
	return linktext.trim();
}

function isEscaped(value: string, index: number): boolean {
	let slashCount = 0;
	for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
		slashCount += 1;
	}
	return slashCount % 2 === 1;
}

function clampOffset(offset: number, length: number): number {
	return Math.min(Math.max(offset, 0), length);
}

async function runWithConcurrency<T>(
	items: T[],
	concurrency: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	let nextIndex = 0;
	const workerCount = Math.min(concurrency, items.length);

	await Promise.all(
		Array.from({ length: workerCount }, async () => {
			while (nextIndex < items.length) {
				const currentIndex = nextIndex;
				nextIndex += 1;
				const item = items[currentIndex];
				if (item === undefined) return;
				await worker(item);
			}
		}),
	);
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function findPlaceholderRange(content: string, placeholder: UploadPlaceholder): { from: number; to: number } | null {
	const exactOffset = content.indexOf(placeholder.markdown);
	if (exactOffset >= 0) {
		return {
			from: exactOffset,
			to: exactOffset + placeholder.markdown.length,
		};
	}

	const targetUrl = `${PLACEHOLDER_PROTOCOL}://${placeholder.id}`;
	const urlOffset = content.indexOf(targetUrl);
	if (urlOffset < 0) return null;

	const linkStart = content.lastIndexOf('[', urlOffset);
	const linkEnd = content.indexOf(')', urlOffset + targetUrl.length);
	if (linkStart < 0 || linkEnd < 0) return null;

	return {
		from: linkStart,
		to: linkEnd + 1,
	};
}
