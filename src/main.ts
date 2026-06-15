import {
	Editor,
	MarkdownFileInfo,
	MarkdownView,
	Notice,
	Plugin,
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
	collectImageFilesFromFileList,
	escapeMarkdownLinkText,
	escapeMarkdownUrl,
} from './utils';

interface UploadPlaceholder {
	id: string;
	markdown: string;
}

interface UploadTask {
	file: File;
	placeholder: UploadPlaceholder;
}

const UPLOAD_CONCURRENCY = 3;
const CHANGE_SOURCE = 'kelan-uploader';
const PLACEHOLDER_PROTOCOL = 'kelan-uploader';

export default class ObsidianImageUploaderPlugin extends Plugin {
	settings: ImageUploaderSettings = DEFAULT_SETTINGS;
	private uploadSequence = 0;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new ImageUploaderSettingTab(this.app, this));

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

	private openImagePicker(editor: Editor): void {
		const input = activeDocument.createElement('input');
		input.type = 'file';
		input.accept = 'image/*';
		input.multiple = true;
		input.addClass('kelan-uploader-hidden-file-input');

		const cleanup = () => {
			input.remove();
		};

		input.addEventListener('change', () => {
			const imageFiles = collectImageFilesFromFileList(input.files);
			const selectedFileCount = input.files?.length ?? 0;
			cleanup();

			if (imageFiles.length === 0) {
				if (selectedFileCount > 0) new Notice(t('notice.noImagesSelected'));
				return;
			}

			this.handleEditorFiles(editor, imageFiles);
		});
		input.addEventListener('cancel', cleanup, { once: true });

		activeDocument.body.appendChild(input);
		input.click();
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

		const replacement = createGalleryReplacement(content, range, {
			src: url,
			alt,
		});
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
