import {
	Editor,
	editorInfoField,
	type MarkdownFileInfo,
	MarkdownView,
	Notice,
	parseLinktext,
	Plugin,
	type TFile,
} from 'obsidian';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { createGalleryReplacement, createGalleryReplacementForImages, type GalleryImage } from './gallery';
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

interface UploadedImage {
	placeholder: UploadPlaceholder;
	image: GalleryImage;
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

interface NativeAttachmentQueue {
	editor: Editor;
	sourceFile: TFile;
	ranges: OffsetRange[];
	retryIndex: number;
	processing: boolean;
	timer: number | null;
}

interface UploadRangeResult {
	range: OffsetRange;
	image: GalleryImage | null;
}

const UPLOAD_CONCURRENCY = 3;
const CHANGE_SOURCE = 'kelan-uploader';
const PLACEHOLDER_PROTOCOL = 'kelan-uploader';
const NATIVE_ATTACHMENT_EMBED = /!\[\[([^\]\r\n]+)\]\]/g;
const NATIVE_ATTACHMENT_SCAN_DELAY = 120;
const NATIVE_ATTACHMENT_RETRY_DELAYS = [500, 1500] as const;

export default class ObsidianImageUploaderPlugin extends Plugin {
	settings: ImageUploaderSettings = DEFAULT_SETTINGS;
	private uploadSequence = 0;
	private readonly nativeAttachmentQueues = new WeakMap<Editor, NativeAttachmentQueue>();
	private readonly nativeAttachmentTimers = new Set<number>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new ImageUploaderSettingTab(this.app, this));
		this.registerEditorExtension(EditorView.updateListener.of((update) => this.handleEditorUpdate(update)));
		this.register(() => this.clearNativeAttachmentTimers());

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

	private handleEditorUpdate(update: ViewUpdate): void {
		if (!update.docChanged) return;

		const info = update.state.field(editorInfoField, false);
		const editor = info?.editor;
		const sourceFile = info?.file;
		if (!editor || !sourceFile) return;

		const ranges = getChangedLineRanges(update);
		if (!stateRangesContainNativeImageEmbed(update, ranges)) return;

		this.enqueueNativeAttachmentScan(editor, sourceFile, ranges, 0, NATIVE_ATTACHMENT_SCAN_DELAY);
	}

	private enqueueNativeAttachmentScan(
		editor: Editor,
		sourceFile: TFile,
		ranges: OffsetRange[],
		retryIndex: number,
		delay: number,
	): void {
		if (ranges.length === 0) return;

		let queue = this.nativeAttachmentQueues.get(editor);
		if (!queue) {
			queue = {
				editor,
				sourceFile,
				ranges: [],
				retryIndex,
				processing: false,
				timer: null,
			};
			this.nativeAttachmentQueues.set(editor, queue);
		}

		queue.sourceFile = sourceFile;
		queue.retryIndex = retryIndex;
		queue.ranges = mergeOffsetRanges([...queue.ranges, ...ranges]);
		this.scheduleNativeAttachmentQueue(queue, delay);
	}

	private scheduleNativeAttachmentQueue(queue: NativeAttachmentQueue, delay: number): void {
		if (queue.timer !== null) {
			activeWindow.clearTimeout(queue.timer);
			this.nativeAttachmentTimers.delete(queue.timer);
		}

		const timer = activeWindow.setTimeout(() => {
			queue.timer = null;
			this.nativeAttachmentTimers.delete(timer);
			void this.flushNativeAttachmentQueue(queue);
		}, delay);
		queue.timer = timer;
		this.nativeAttachmentTimers.add(timer);
	}

	private async flushNativeAttachmentQueue(queue: NativeAttachmentQueue): Promise<void> {
		if (queue.processing) return;

		const ranges = queue.ranges;
		if (ranges.length === 0) return;

		queue.ranges = [];
		const retryIndex = queue.retryIndex;
		queue.retryIndex = 0;
		queue.processing = true;

		try {
			await this.processNativeAttachmentEmbeds(queue.editor, queue.sourceFile, ranges, retryIndex);
		} finally {
			queue.processing = false;
			if (queue.ranges.length > 0) {
				this.scheduleNativeAttachmentQueue(queue, 0);
			}
		}
	}

	private async processNativeAttachmentEmbeds(
		editor: Editor,
		sourceFile: TFile,
		scanRanges: OffsetRange[],
		retryIndex: number,
	): Promise<void> {
		const content = editor.getValue();
		const ranges = mergeOffsetRanges(scanRanges.map((range) => expandToLineRange(content, range)));
		if (!rangesContainNativeImageEmbed(content, ranges)) return;

		const validationError = validateUploadSettings(this.settings);
		if (validationError) {
			new Notice(validationError);
			return;
		}

		const scanResult = await this.collectNativeAttachmentReplacements(content, sourceFile, ranges);
		if (scanResult.hasUnresolvedImageEmbed) {
			this.scheduleNativeAttachmentRescan(editor, sourceFile, ranges, retryIndex);
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

		new Notice(t('notice.uploading', {
			count: uploadTasks.length,
			plural: uploadTasks.length === 1 ? '' : 's',
		}));
		void this.processUploads(editor, uploadTasks);
	}

	private async collectNativeAttachmentReplacements(
		content: string,
		sourceFile: TFile,
		scanRanges: OffsetRange[],
	): Promise<NativeAttachmentScanResult> {
		const targets: Array<NativeAttachmentEmbed & { targetFile: TFile }> = [];
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

			targets.push({
				...embed,
				targetFile,
			});
		}

		const replacements = await Promise.all(targets.map(async (target): Promise<NativeAttachmentReplacement | null> => {
			try {
				const file = await this.createFileFromVaultAttachment(target.targetFile);
				return {
					from: target.from,
					to: target.to,
					file,
					placeholder: this.createPlaceholder(file),
				};
			} catch (error) {
				new Notice(t('notice.uploadFailed', { message: getErrorMessage(error) }));
				return null;
			}
		}));

		return {
			replacements: replacements.filter((replacement): replacement is NativeAttachmentReplacement => replacement !== null),
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
		sourceFile: TFile,
		scanRanges: OffsetRange[],
		retryIndex: number,
	): void {
		const delay = NATIVE_ATTACHMENT_RETRY_DELAYS[retryIndex];
		if (delay === undefined) return;

		this.enqueueNativeAttachmentScan(editor, sourceFile, scanRanges, retryIndex + 1, delay);
	}

	private clearNativeAttachmentTimers(): void {
		for (const timer of this.nativeAttachmentTimers) {
			activeWindow.clearTimeout(timer);
		}
		this.nativeAttachmentTimers.clear();
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
		if (this.settings.autoInlineGallery) {
			await this.processGalleryUploads(editor, tasks);
			return;
		}

		await runWithConcurrency(tasks, UPLOAD_CONCURRENCY, async (task) => {
			try {
				const uploaded = await this.uploadTask(task);
				this.replaceUploadedImage(editor, uploaded.placeholder, uploaded.image.src, uploaded.image.alt);
			} catch (error) {
				this.replacePlaceholder(editor, task.placeholder, '');
				new Notice(t('notice.uploadFailed', { message: getErrorMessage(error) }));
			}
		});
	}

	private async processGalleryUploads(editor: Editor, tasks: UploadTask[]): Promise<void> {
		const results = new Array<UploadedImage | null>(tasks.length).fill(null);
		const indexedTasks = tasks.map((task, index) => ({ task, index }));

		await runWithConcurrency(indexedTasks, UPLOAD_CONCURRENCY, async ({ task, index }) => {
			try {
				results[index] = await this.uploadTask(task);
			} catch (error) {
				new Notice(t('notice.uploadFailed', { message: getErrorMessage(error) }));
			}
		});

		this.replaceUploadedGalleryImages(editor, tasks, results);
	}

	private async uploadTask(task: UploadTask): Promise<UploadedImage> {
		const prepared = await prepareImageForUpload(task.file, this.settings.transform);
		if (prepared.skippedTransformReason) {
			new Notice(t('notice.transformSkipped', {
				name: task.file.name || 'image',
				reason: prepared.skippedTransformReason,
			}));
		}

		return {
			placeholder: task.placeholder,
			image: {
				src: await uploadImage(prepared, this.settings),
				alt: prepared.fileName,
			},
		};
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

	private replaceUploadedGalleryImages(
		editor: Editor,
		tasks: UploadTask[],
		results: Array<UploadedImage | null>,
	): void {
		const content = editor.getValue();
		const rangedResults = tasks.flatMap((task, index): UploadRangeResult[] => {
			const range = findPlaceholderRange(content, task.placeholder);
			if (!range) return [];
			return [{
				range,
				image: results[index]?.image ?? null,
			}];
		});
		if (rangedResults.length === 0) return;

		const groups = groupUploadRangeResults(content, rangedResults);
		for (const group of groups.reverse()) {
			const groupFrom = group[0]?.range.from;
			const groupTo = group[group.length - 1]?.range.to;
			if (groupFrom === undefined || groupTo === undefined) continue;

			const images = group.flatMap((entry) => entry.image ? [entry.image] : []);
			const replacement = images.length === 0
				? { from: groupFrom, to: groupTo, text: '' }
				: createGalleryReplacementForImages(
					content,
					{ from: groupFrom, to: groupTo },
					images,
					{ imageHeight: this.settings.autoInlineGalleryHeight },
				);
			const from = editor.offsetToPos(replacement.from);
			const to = editor.offsetToPos(replacement.to);
			editor.replaceRange(replacement.text, from, to, CHANGE_SOURCE);
		}
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

function getChangedLineRanges(update: ViewUpdate): OffsetRange[] {
	const ranges: OffsetRange[] = [];

	update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
		if (fromB === toB) return;

		const doc = update.state.doc;
		const startLine = doc.lineAt(clampOffset(fromB, doc.length));
		const endLine = doc.lineAt(clampOffset(Math.max(fromB, toB - 1), doc.length));
		ranges.push({
			from: startLine.from,
			to: endLine.to,
		});
	}, true);

	return mergeOffsetRanges(ranges);
}

function stateRangesContainNativeImageEmbed(update: ViewUpdate, ranges: OffsetRange[]): boolean {
	return ranges.some((range) => rangeContainsNativeImageEmbed(update.state.sliceDoc(range.from, range.to)));
}

function rangeContainsNativeImageEmbed(value: string): boolean {
	NATIVE_ATTACHMENT_EMBED.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = NATIVE_ATTACHMENT_EMBED.exec(value)) !== null) {
		const linkPath = getWikilinkPath(match[1] ?? '');
		const extension = linkPath ? getExtension(linkPath) : null;
		if (extension !== null && isImageExtension(extension)) return true;
	}
	return false;
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

function groupUploadRangeResults(content: string, results: UploadRangeResult[]): UploadRangeResult[][] {
	const sorted = [...results].sort((left, right) => left.range.from - right.range.from);
	const groups: UploadRangeResult[][] = [];

	for (const result of sorted) {
		const previousGroup = groups[groups.length - 1];
		const previousResult = previousGroup?.[previousGroup.length - 1];
		if (
			previousGroup &&
			previousResult &&
			isMergeablePlaceholderGap(content.slice(previousResult.range.to, result.range.from))
		) {
			previousGroup.push(result);
			continue;
		}
		groups.push([result]);
	}

	return groups;
}

function isMergeablePlaceholderGap(value: string): boolean {
	if (value.trim()) return false;
	return countLineBreaks(value) < 2;
}

function countLineBreaks(value: string): number {
	let count = 0;
	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
		if (char === '\r') {
			count += 1;
			if (value[index + 1] === '\n') index += 1;
			continue;
		}
		if (char === '\n') count += 1;
	}
	return count;
}

function mergeOffsetRanges(ranges: OffsetRange[]): OffsetRange[] {
	const sorted = [...ranges].sort((left, right) => left.from - right.from || left.to - right.to);
	const merged: OffsetRange[] = [];

	for (const range of sorted) {
		const previous = merged[merged.length - 1];
		if (!previous || range.from > previous.to) {
			merged.push({ ...range });
			continue;
		}
		previous.to = Math.max(previous.to, range.to);
	}

	return merged;
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
