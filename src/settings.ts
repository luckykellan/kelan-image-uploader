import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { t } from './i18n';

export interface HeaderEntry {
	key: string;
	value: string;
}

export type OutputFormat = 'original' | 'jpeg' | 'png' | 'webp';

export interface ImageTransformSettings {
	enabled: boolean;
	outputFormat: OutputFormat;
	quality: number;
	maxWidth?: number;
	maxHeight?: number;
}

export interface ImageUploaderSettings {
	apiEndpoint: string;
	fileFieldName: string;
	imageUrlPath: string;
	headers: HeaderEntry[];
	autoInlineGallery: boolean;
	transform: ImageTransformSettings;
}

export interface SettingsOwner extends Plugin {
	settings: ImageUploaderSettings;
	saveSettings(): Promise<void>;
}

export const DEFAULT_SETTINGS: ImageUploaderSettings = {
	apiEndpoint: '',
	fileFieldName: 'file',
	imageUrlPath: 'url',
	headers: [],
	autoInlineGallery: false,
	transform: {
		enabled: false,
		outputFormat: 'original',
		quality: 0.85,
	},
};

const RESERVED_HEADER_NAMES = new Set(['content-type']);

export function isReservedHeaderName(key: string): boolean {
	return RESERVED_HEADER_NAMES.has(key.trim().toLowerCase());
}

export function normalizeSettings(data: unknown): ImageUploaderSettings {
	const saved = isRecord(data) ? data : {};
	const savedTransform = isRecord(saved.transform) ? saved.transform : {};

	return {
		apiEndpoint: getString(saved.apiEndpoint, DEFAULT_SETTINGS.apiEndpoint),
		fileFieldName: getString(saved.fileFieldName, DEFAULT_SETTINGS.fileFieldName),
		imageUrlPath: getString(saved.imageUrlPath, DEFAULT_SETTINGS.imageUrlPath),
		headers: normalizeHeaders(saved.headers),
		autoInlineGallery: getBoolean(saved.autoInlineGallery, DEFAULT_SETTINGS.autoInlineGallery),
		transform: {
			enabled: getBoolean(savedTransform.enabled, DEFAULT_SETTINGS.transform.enabled),
			outputFormat: getOutputFormat(savedTransform.outputFormat),
			quality: clampQuality(getNumber(savedTransform.quality, DEFAULT_SETTINGS.transform.quality)),
			maxWidth: getOptionalPositiveInteger(savedTransform.maxWidth),
			maxHeight: getOptionalPositiveInteger(savedTransform.maxHeight),
		},
	};
}

export function validateUploadSettings(settings: ImageUploaderSettings): string | null {
	if (!settings.apiEndpoint.trim()) {
		return t('notice.missingEndpoint');
	}
	if (!settings.imageUrlPath.trim()) {
		return t('notice.missingUrlPath');
	}
	return null;
}

export function getUsableHeaders(headers: HeaderEntry[]): HeaderEntry[] {
	return headers.filter((entry) => entry.key.trim() && !isReservedHeaderName(entry.key));
}

export class ImageUploaderSettingTab extends PluginSettingTab {
	private readonly plugin: SettingsOwner;

	constructor(app: App, plugin: SettingsOwner) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName(t('settings.uploadApi.heading')).setHeading();
		this.renderApiEndpointSetting(
			new Setting(containerEl)
				.setName(t('settings.apiEndpoint.name'))
				.setDesc(t('settings.apiEndpoint.desc')),
		);
		this.renderFileFieldNameSetting(
			new Setting(containerEl)
				.setName(t('settings.fileFieldName.name'))
				.setDesc(t('settings.fileFieldName.desc')),
		);
		this.renderImageUrlPathSetting(
			new Setting(containerEl)
				.setName(t('settings.imageUrlPath.name'))
				.setDesc(t('settings.imageUrlPath.desc')),
		);

		new Setting(containerEl).setName(t('settings.transform.heading')).setHeading();
		this.renderTransformEnabledSetting(
			new Setting(containerEl)
				.setName(t('settings.transformEnabled.name'))
				.setDesc(t('settings.transformEnabled.desc')),
		);
		this.renderOutputFormatSetting(
			new Setting(containerEl)
				.setName(t('settings.outputFormat.name'))
				.setDesc(t('settings.outputFormat.desc')),
		);
		this.renderQualitySetting(
			new Setting(containerEl)
				.setName(t('settings.quality.name'))
				.setDesc(t('settings.quality.desc')),
		);
		this.renderMaxWidthSetting(
			new Setting(containerEl)
				.setName(t('settings.maxWidth.name'))
				.setDesc(t('settings.maxWidth.desc')),
		);
		this.renderMaxHeightSetting(
			new Setting(containerEl)
				.setName(t('settings.maxHeight.name'))
				.setDesc(t('settings.maxHeight.desc')),
		);

		new Setting(containerEl).setName(t('settings.insertion.heading')).setHeading();
		this.renderAutoInlineGallerySetting(
			new Setting(containerEl)
				.setName(t('settings.autoInlineGallery.name'))
				.setDesc(t('settings.autoInlineGallery.desc')),
		);

		new Setting(containerEl).setName(t('settings.headers.heading')).setHeading();
		this.plugin.settings.headers.forEach((entry, index) => {
			this.renderHeaderSetting(
				new Setting(containerEl).setName(t('settings.header.name', { index: index + 1 })),
				entry,
				index,
			);
		});
		new Setting(containerEl)
			.setDesc(t('settings.headers.desc'))
			.addButton((button) =>
				button
					.setButtonText(t('settings.addHeader.button'))
					.setCta()
					.onClick(() => {
						void this.addHeader();
					}),
			);
	}

	private renderApiEndpointSetting(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder('https://example.com/api/upload')
				.setValue(this.plugin.settings.apiEndpoint)
				.onChange(async (value) => {
					this.plugin.settings.apiEndpoint = value;
					await this.plugin.saveSettings();
				}),
		);
	}

	private renderFileFieldNameSetting(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder('file')
				.setValue(this.plugin.settings.fileFieldName)
				.onChange(async (value) => {
					this.plugin.settings.fileFieldName = value;
					await this.plugin.saveSettings();
				}),
		);
	}

	private renderImageUrlPathSetting(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder('url')
				.setValue(this.plugin.settings.imageUrlPath)
				.onChange(async (value) => {
					this.plugin.settings.imageUrlPath = value;
					await this.plugin.saveSettings();
				}),
		);
	}

	private renderTransformEnabledSetting(setting: Setting): void {
		setting.addToggle((toggle) =>
			toggle
				.setValue(this.plugin.settings.transform.enabled)
				.onChange(async (value) => {
					this.plugin.settings.transform.enabled = value;
					await this.plugin.saveSettings();
				}),
		);
	}

	private renderOutputFormatSetting(setting: Setting): void {
		setting.addDropdown((dropdown) =>
			dropdown
				.addOption('original', t('settings.outputFormat.original'))
				.addOption('jpeg', t('settings.outputFormat.jpeg'))
				.addOption('png', t('settings.outputFormat.png'))
				.addOption('webp', t('settings.outputFormat.webp'))
				.setValue(this.plugin.settings.transform.outputFormat)
				.onChange(async (value) => {
					this.plugin.settings.transform.outputFormat = value as OutputFormat;
					await this.plugin.saveSettings();
				}),
		);
	}

	private renderQualitySetting(setting: Setting): void {
		setting.addSlider((slider) =>
			slider
				.setLimits(0.1, 1, 0.01)
				.setValue(this.plugin.settings.transform.quality)
				.onChange(async (value) => {
					this.plugin.settings.transform.quality = clampQuality(value);
					await this.plugin.saveSettings();
				}),
		);
	}

	private renderMaxWidthSetting(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder(t('settings.noLimit.placeholder'))
				.setValue(formatOptionalInteger(this.plugin.settings.transform.maxWidth))
				.onChange(async (value) => {
					const parsed = parseOptionalIntegerInput(value);
					if (parsed === null) return;
					this.plugin.settings.transform.maxWidth = parsed;
					await this.plugin.saveSettings();
				}),
		);
	}

	private renderMaxHeightSetting(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder(t('settings.noLimit.placeholder'))
				.setValue(formatOptionalInteger(this.plugin.settings.transform.maxHeight))
				.onChange(async (value) => {
					const parsed = parseOptionalIntegerInput(value);
					if (parsed === null) return;
					this.plugin.settings.transform.maxHeight = parsed;
					await this.plugin.saveSettings();
				}),
		);
	}

	private renderAutoInlineGallerySetting(setting: Setting): void {
		setting.addToggle((toggle) =>
			toggle
				.setValue(this.plugin.settings.autoInlineGallery)
				.onChange(async (value) => {
					this.plugin.settings.autoInlineGallery = value;
					await this.plugin.saveSettings();
				}),
		);
	}

	private renderHeaderSetting(setting: Setting, entry: HeaderEntry, index: number): void {
		setting.controlEl.addClass('kelan-image-uploader-header-row');
		setting.addText((text) =>
			text
				.setPlaceholder(t('settings.headerName.placeholder'))
				.setValue(entry.key)
				.onChange(async (value) => {
					await this.updateHeaderName(index, value);
				}),
		);
		setting.addText((text) =>
			text
				.setPlaceholder(t('settings.headerValue.placeholder'))
				.setValue(entry.value)
				.onChange(async (value) => {
					const current = this.plugin.settings.headers[index];
					if (!current) return;
					current.value = value;
					await this.plugin.saveSettings();
				}),
		);
		setting.addExtraButton((button) =>
			button
				.setIcon('trash')
				.setTooltip(t('settings.removeHeader.tooltip'))
				.onClick(() => {
					void this.removeHeader(index);
				}),
		);
	}

	private async updateHeaderName(index: number, value: string): Promise<void> {
		const current = this.plugin.settings.headers[index];
		if (!current) return;
		if (isReservedHeaderName(value)) {
			new Notice(t('notice.contentTypeReserved'));
			current.key = '';
			await this.plugin.saveSettings();
			this.display();
			return;
		}
		current.key = value;
		await this.plugin.saveSettings();
	}

	private async addHeader(): Promise<void> {
		this.plugin.settings.headers.push({ key: '', value: '' });
		await this.plugin.saveSettings();
		this.display();
	}

	private async removeHeader(index: number): Promise<void> {
		this.plugin.settings.headers.splice(index, 1);
		await this.plugin.saveSettings();
		this.display();
	}
}

function normalizeHeaders(value: unknown): HeaderEntry[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter(isRecord)
		.map((entry) => ({
			key: getString(entry.key, ''),
			value: getString(entry.value, ''),
		}));
}

function getOutputFormat(value: unknown): OutputFormat {
	if (value === 'jpeg' || value === 'png' || value === 'webp') return value;
	return 'original';
}

function getOptionalPositiveInteger(value: unknown): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
	const integer = Math.floor(value);
	return integer > 0 ? integer : undefined;
}

function parseOptionalIntegerInput(value: string): number | undefined | null {
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	if (!/^\d+$/.test(trimmed)) return null;
	const parsed = Number.parseInt(trimmed, 10);
	return parsed > 0 ? parsed : null;
}

function formatOptionalInteger(value: number | undefined): string {
	return value === undefined ? '' : String(value);
}

function clampQuality(value: number): number {
	return Math.min(1, Math.max(0.1, value));
}

function getString(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
}

function getNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
