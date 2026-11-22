import type { Span } from "dnd-timeline";
import { type Dispatch, type RefObject, type SetStateAction, useCallback } from "react";
import { toast } from "sonner";
import {
	type CaptionEditTarget,
	normalizeCaptionEditText,
	normalizeCaptionWords,
	updateCaptionCuesForEditedTarget,
} from "../captionEditing";
import {
	addCue,
	type CaptionRetimeSpan,
	createCaptionCue,
	deleteCue,
	estimateCaptionDurationMs,
	findNextAvailableCaptionSpan,
	MIN_MANUAL_CAPTION_DURATION_MS,
	mergeCaptionCues,
	mergeCues,
	retimeCue,
	splitCue,
} from "../captionOps";
import type { AutoCaptionSettings, CaptionCue, EditorEffectSection } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";

export interface AddManualCaptionOptions {
	text?: string;
	startMs?: number;
	endMs?: number;
	keepPlaying?: boolean;
	selectAfterAdd?: boolean;
}

type Translator = (
	key: string,
	fallback?: string,
	params?: Record<string, string | number>,
) => string;

interface UseCaptionCommandsParams {
	t?: Translator;
	durationMs: number;
	currentTimeMs: number;
	autoCaptions: CaptionCue[];
	setAutoCaptions: Dispatch<SetStateAction<CaptionCue[]>>;
	setAutoCaptionSettings: Dispatch<SetStateAction<AutoCaptionSettings>>;
	setSelectedCaptionId: Dispatch<SetStateAction<string | null>>;
	setSelectedZoomId: Dispatch<SetStateAction<string | null>>;
	setSelectedClipId: Dispatch<SetStateAction<string | null>>;
	setSelectedAnnotationId: Dispatch<SetStateAction<string | null>>;
	setSelectedAudioId: Dispatch<SetStateAction<string | null>>;
	setActiveEffectSection: Dispatch<SetStateAction<EditorEffectSection>>;
	videoPlaybackRef: RefObject<VideoPlaybackRef>;
	mapSourceTimeToTimelineTime: (timeMs: number) => number;
	mapTimelineTimeToSourceTime: (timeMs: number) => number;
	handleSeek: (time: number, options?: { pause?: boolean }) => void;
}

export function useCaptionCommands({
	t,
	durationMs,
	currentTimeMs,
	autoCaptions,
	setAutoCaptions,
	setAutoCaptionSettings,
	setSelectedCaptionId,
	setSelectedZoomId,
	setSelectedClipId,
	setSelectedAnnotationId,
	setSelectedAudioId,
	setActiveEffectSection,
	videoPlaybackRef,
	mapSourceTimeToTimelineTime,
	mapTimelineTimeToSourceTime,
	handleSeek,
}: UseCaptionCommandsParams) {
	const getCuePreviewSeekTimeSec = useCallback(
		(cue: { startMs: number; endMs: number }) => {
			const previewSourceMs =
				cue.startMs + Math.min(180, Math.floor((cue.endMs - cue.startMs) / 2));
			return mapSourceTimeToTimelineTime(previewSourceMs) / 1000;
		},
		[mapSourceTimeToTimelineTime],
	);

	const handleSelectCaption = useCallback(
		(id: string | null) => {
			setSelectedCaptionId(id);
			if (!id) {
				setActiveEffectSection((section) => (section === "caption" ? "captions" : section));
				return;
			}
			setActiveEffectSection("captions");
			setSelectedZoomId(null);
			setSelectedClipId(null);
			setSelectedAnnotationId(null);
			setSelectedAudioId(null);
			const cue = autoCaptions.find((value) => value.id === id);
			if (cue) {
				handleSeek(getCuePreviewSeekTimeSec(cue), { pause: true });
			}
		},
		[
			autoCaptions,
			getCuePreviewSeekTimeSec,
			handleSeek,
			setActiveEffectSection,
			setSelectedAnnotationId,
			setSelectedAudioId,
			setSelectedCaptionId,
			setSelectedClipId,
			setSelectedZoomId,
		],
	);

	const handleBeginCaptionEdit = useCallback(
		(id: string) => {
			videoPlaybackRef.current?.cancelCaptionEdit();
			setSelectedCaptionId(id);
		},
		[setSelectedCaptionId, videoPlaybackRef],
	);

	const handleCaptionTextEdit = useCallback(
		(id: string, text: string) => {
			setAutoCaptions((captions) => {
				const cue = captions.find((value) => value.id === id);
				if (!cue) return captions;

				const words = normalizeCaptionWords(cue);
				if (words.length === 0) {
					const normalized = normalizeCaptionEditText(text);
					return captions.map((value) =>
						value.id === id ? { ...value, text: normalized } : value,
					);
				}

				const target: CaptionEditTarget = {
					id: cue.id,
					startMs: cue.startMs,
					endMs: cue.endMs,
					text: cue.text,
					words: words.map((word, index) => ({
						cueId: cue.id,
						cueWordIndex: index,
						startMs: word.startMs,
						endMs: word.endMs,
						text: word.text,
						leadingSpace: Boolean(word.leadingSpace),
					})),
				};
				return updateCaptionCuesForEditedTarget(captions, target, text);
			});
		},
		[setAutoCaptions],
	);

	const cancelEdit = useCallback(
		() => videoPlaybackRef.current?.cancelCaptionEdit(),
		[videoPlaybackRef],
	);
	const handleCaptionRetime = useCallback(
		(id: string, span: CaptionRetimeSpan) => {
			cancelEdit();
			setAutoCaptions((captions) => retimeCue(captions, id, span));
		},
		[cancelEdit, setAutoCaptions],
	);
	const handleCaptionSplit = useCallback(
		(id: string, atMs: number) => {
			cancelEdit();
			setAutoCaptions((captions) => splitCue(captions, id, atMs));
		},
		[cancelEdit, setAutoCaptions],
	);
	const handleCaptionMerge = useCallback(
		(idA: string, idB: string) => {
			cancelEdit();
			setAutoCaptions((captions) => mergeCues(captions, idA, idB));
		},
		[cancelEdit, setAutoCaptions],
	);
	const handleCaptionDelete = useCallback(
		(id: string) => {
			cancelEdit();
			setSelectedCaptionId((current) => (current === id ? null : current));
			setAutoCaptions((captions) => deleteCue(captions, id));
		},
		[cancelEdit, setAutoCaptions, setSelectedCaptionId],
	);

	const handleCaptionAdded = useCallback(
		(span: Span) => {
			cancelEdit();
			const newCue = createCaptionCue({
				startMs: mapTimelineTimeToSourceTime(span.start),
				endMs: mapTimelineTimeToSourceTime(span.end),
			});
			setAutoCaptions((captions) => addCue(captions, newCue));
			setAutoCaptionSettings((current) =>
				current.enabled ? current : { ...current, enabled: true },
			);
			setSelectedCaptionId(newCue.id);
			setActiveEffectSection("captions");
			setSelectedZoomId(null);
			setSelectedClipId(null);
			setSelectedAnnotationId(null);
			setSelectedAudioId(null);
			handleSeek(getCuePreviewSeekTimeSec(newCue), { pause: true });
		},
		[
			cancelEdit,
			getCuePreviewSeekTimeSec,
			handleSeek,
			mapTimelineTimeToSourceTime,
			setActiveEffectSection,
			setAutoCaptionSettings,
			setAutoCaptions,
			setSelectedAnnotationId,
			setSelectedAudioId,
			setSelectedCaptionId,
			setSelectedClipId,
			setSelectedZoomId,
		],
	);

	const handleAddManualCaption = useCallback(
		(options?: AddManualCaptionOptions): CaptionCue | null => {
			cancelEdit();
			const maxDurationMs = Math.max(0, Math.round(durationMs));
			if (maxDurationMs <= 0) {
				return null;
			}

			const text = normalizeCaptionEditText(options?.text ?? "");
			const estimatedDurationMs = estimateCaptionDurationMs(text);
			const preferredStartMs = options?.startMs ?? currentTimeMs;

			let span: CaptionRetimeSpan | null = null;
			if (
				options?.startMs !== undefined &&
				options?.endMs !== undefined &&
				options.endMs > options.startMs
			) {
				const startMs = Math.max(
					0,
					Math.min(Math.round(options.startMs), maxDurationMs - 1),
				);
				const overlapsExisting = autoCaptions.some(
					(cue) => startMs >= cue.startMs && startMs < cue.endMs,
				);
				const nextCueStartMs = autoCaptions
					.filter((cue) => cue.startMs > startMs)
					.reduce((min, cue) => Math.min(min, cue.startMs), maxDurationMs);
				const endMs = Math.min(Math.round(options.endMs), maxDurationMs, nextCueStartMs);
				if (!overlapsExisting && endMs - startMs >= MIN_MANUAL_CAPTION_DURATION_MS) {
					span = { startMs, endMs };
				}
			}

			if (!span) {
				span = findNextAvailableCaptionSpan(autoCaptions, preferredStartMs, {
					durationMs: estimatedDurationMs,
					maxDurationMs,
				});
			}

			if (!span) {
				toast.error(
					t?.(
						"settings.captions.noSpaceLeft",
						"No space left for a new caption after this time.",
					) ?? "No space left for a new caption after this time.",
				);
				return null;
			}

			const newCue = createCaptionCue({
				startMs: span.startMs,
				endMs: span.endMs,
				text,
			});
			setAutoCaptions((captions) => addCue(captions, newCue));
			setAutoCaptionSettings((current) =>
				current.enabled ? current : { ...current, enabled: true },
			);
			setActiveEffectSection("captions");
			setSelectedZoomId(null);
			setSelectedClipId(null);
			setSelectedAnnotationId(null);
			setSelectedAudioId(null);
			if (options?.selectAfterAdd !== false) {
				setSelectedCaptionId(newCue.id);
			}
			if (!options?.keepPlaying) {
				handleSeek(getCuePreviewSeekTimeSec(newCue), { pause: true });
			}
			return newCue;
		},
		[
			autoCaptions,
			cancelEdit,
			currentTimeMs,
			durationMs,
			getCuePreviewSeekTimeSec,
			handleSeek,
			setActiveEffectSection,
			setAutoCaptionSettings,
			setAutoCaptions,
			setSelectedAnnotationId,
			setSelectedAudioId,
			setSelectedCaptionId,
			setSelectedClipId,
			setSelectedZoomId,
			t,
		],
	);

	const handleImportCaptions = useCallback(
		(cues: CaptionCue[], mode: "replace" | "append") => {
			cancelEdit();
			if (cues.length === 0) {
				return;
			}
			setAutoCaptions((existing) => mergeCaptionCues(existing, cues, mode));
			setAutoCaptionSettings((current) =>
				current.enabled ? current : { ...current, enabled: true },
			);
			setActiveEffectSection("captions");
			setSelectedZoomId(null);
			setSelectedClipId(null);
			setSelectedAnnotationId(null);
			setSelectedAudioId(null);
			setSelectedCaptionId(cues[0].id);
			handleSeek(getCuePreviewSeekTimeSec(cues[0]), { pause: true });
		},
		[
			cancelEdit,
			getCuePreviewSeekTimeSec,
			handleSeek,
			setActiveEffectSection,
			setAutoCaptionSettings,
			setAutoCaptions,
			setSelectedAnnotationId,
			setSelectedAudioId,
			setSelectedCaptionId,
			setSelectedClipId,
			setSelectedZoomId,
		],
	);

	const handleClearAutoCaptions = useCallback(() => {
		setAutoCaptions([]);
		setSelectedCaptionId(null);
		setAutoCaptionSettings((current) => ({ ...current, enabled: false }));
	}, [setAutoCaptionSettings, setAutoCaptions, setSelectedCaptionId]);

	return {
		handleSelectCaption,
		handleBeginCaptionEdit,
		handleCaptionTextEdit,
		handleCaptionRetime,
		handleCaptionSplit,
		handleCaptionMerge,
		handleCaptionDelete,
		handleCaptionAdded,
		handleAddManualCaption,
		handleImportCaptions,
		handleClearAutoCaptions,
	};
}
