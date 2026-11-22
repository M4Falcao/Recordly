import {
	ArrowLineLeft,
	ArrowLineRight,
	ArrowsMerge,
	FastForward,
	FileText,
	Pause,
	Play,
	Plus,
	Rewind,
	Scissors,
	Trash,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import { BulkCaptionDialog } from "./BulkCaptionDialog";
import { normalizeCaptionWords } from "./captionEditing";
import {
	type CaptionRetimeSpan,
	estimateCaptionDurationMs,
	findNextAvailableCaptionSpan,
	formatCaptionShortTimecode,
	formatCaptionTimecode,
	MIN_MANUAL_CAPTION_DURATION_MS,
	parseCaptionTimecode,
} from "./captionOps";
import type { AddManualCaptionOptions } from "./hooks/useCaptionCommands";
import type { CaptionCue } from "./types";

interface CaptionListPanelProps {
	cues: CaptionCue[];
	selectedCaptionId: string | null;
	currentTimeMs: number;
	videoDurationMs: number;
	isPlaying: boolean;
	onTogglePlayPause?: () => void;
	onSeekBySeconds?: (deltaSeconds: number) => void;
	onSelectCaption: (id: string | null) => void;
	onAddManualCaption: (options?: AddManualCaptionOptions) => CaptionCue | null;
	onImportCaptions: (cues: CaptionCue[], mode: "replace" | "append") => void;
	onClearCaptions: () => void;
	onBeginCaptionEdit: (id: string) => void;
	onCaptionTextEdit: (id: string, text: string) => void;
	onCaptionRetime: (id: string, span: CaptionRetimeSpan) => void;
	onCaptionSplit: (id: string, atMs: number) => void;
	onCaptionMerge: (idA: string, idB: string) => void;
	onCaptionDelete: (id: string) => void;
}

function clampNumber(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

interface InlineCueEditorProps {
	cue: CaptionCue;
	index: number;
	canMerge: boolean;
	hasPrev: boolean;
	hasNext: boolean;
	currentTimeMs: number;
	videoDurationMs: number;
	onTogglePlayPause?: () => void;
	onSeekBySeconds?: (deltaSeconds: number) => void;
	onBeginEdit: (id: string) => void;
	onTextEdit: (id: string, text: string) => void;
	onRetime: (id: string, span: CaptionRetimeSpan) => void;
	onSplit: (id: string, atMs: number) => void;
	onMerge: (id: string) => void;
	onAddNext: () => void;
	onSelectPrev: () => void;
	onSelectNext: () => void;
	onDelete: (id: string) => void;
}

function InlineCueEditor({
	cue,
	index,
	canMerge,
	hasPrev,
	hasNext,
	currentTimeMs,
	videoDurationMs,
	onTogglePlayPause,
	onSeekBySeconds,
	onBeginEdit,
	onTextEdit,
	onRetime,
	onSplit,
	onMerge,
	onAddNext,
	onSelectPrev,
	onSelectNext,
	onDelete,
}: InlineCueEditorProps) {
	const t = useScopedT("settings");
	const [draftText, setDraftText] = useState(cue.text);
	const [startValue, setStartValue] = useState(formatCaptionTimecode(cue.startMs));
	const [endValue, setEndValue] = useState(formatCaptionTimecode(cue.endMs));
	// Escape resets the draft and blurs, but `setDraftText` is batched so the blur-driven
	// `commitText` would still see the stale (edited) draft and save it. This flag lets the
	// cancel path tell the next blur to discard instead of commit.
	const cancelNextCommitRef = useRef(false);
	const lastSubmittedTextRef = useRef(cue.text);

	useEffect(() => {
		setDraftText(cue.text);
		lastSubmittedTextRef.current = cue.text;
		setStartValue(formatCaptionTimecode(cue.startMs));
		setEndValue(formatCaptionTimecode(cue.endMs));
	}, [cue.text, cue.startMs, cue.endMs]);

	const commitText = useCallback(() => {
		if (cancelNextCommitRef.current) {
			cancelNextCommitRef.current = false;
			setDraftText(cue.text);
			return;
		}
		const normalized = draftText.trim();
		if (normalized && normalized !== lastSubmittedTextRef.current) {
			lastSubmittedTextRef.current = normalized;
			onTextEdit(cue.id, normalized);
		} else {
			setDraftText(lastSubmittedTextRef.current);
		}
	}, [cue.id, cue.text, draftText, onTextEdit]);

	const commitTiming = useCallback(() => {
		const parsedStart = parseCaptionTimecode(startValue);
		const parsedEnd = parseCaptionTimecode(endValue);
		if (parsedStart === null || parsedEnd === null || parsedEnd <= parsedStart) {
			setStartValue(formatCaptionTimecode(cue.startMs));
			setEndValue(formatCaptionTimecode(cue.endMs));
			return;
		}
		if (parsedStart !== cue.startMs || parsedEnd !== cue.endMs) {
			onRetime(cue.id, { startMs: parsedStart, endMs: parsedEnd });
		}
	}, [cue.endMs, cue.id, cue.startMs, endValue, onRetime, startValue]);

	const handleSetStartToPlayhead = useCallback(() => {
		const safePlayheadMs = Math.max(0, Math.round(currentTimeMs));
		if (safePlayheadMs < cue.endMs - 100) {
			onRetime(cue.id, { startMs: safePlayheadMs, endMs: cue.endMs });
			return;
		}
		const duration = Math.max(MIN_MANUAL_CAPTION_DURATION_MS, cue.endMs - cue.startMs);
		const maxStart = videoDurationMs > 0 ? Math.max(0, videoDurationMs - 100) : safePlayheadMs;
		const nextStartMs = Math.min(safePlayheadMs, maxStart);
		const nextEndMs =
			videoDurationMs > 0
				? Math.min(videoDurationMs, nextStartMs + duration)
				: nextStartMs + duration;
		if (nextEndMs > nextStartMs) {
			onRetime(cue.id, { startMs: nextStartMs, endMs: nextEndMs });
		}
	}, [cue.endMs, cue.id, cue.startMs, currentTimeMs, onRetime, videoDurationMs]);

	const canSetEndToPlayhead = currentTimeMs > cue.startMs + 100;
	const handleSetEndToPlayhead = useCallback(() => {
		if (!canSetEndToPlayhead) {
			return;
		}
		onRetime(cue.id, { startMs: cue.startMs, endMs: Math.round(currentTimeMs) });
	}, [canSetEndToPlayhead, cue.id, cue.startMs, currentTimeMs, onRetime]);

	const canSplit = normalizeCaptionWords(cue).length >= 2;
	const splitTargetMs =
		currentTimeMs > cue.startMs && currentTimeMs < cue.endMs
			? currentTimeMs
			: Math.round((cue.startMs + cue.endMs) / 2);
	const durationLabel = `${((cue.endMs - cue.startMs) / 1000).toFixed(1)}s`;

	return (
		<div className="flex flex-col gap-2.5 rounded-xl border border-[#2563EB]/60 bg-[#2563EB]/[0.07] p-2.5 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.12)]">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-1.5">
					<span className="rounded bg-[#2563EB]/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#60A5FA]">
						#{index + 1}
					</span>
					<span className="font-mono text-[10px] tabular-nums text-muted-foreground">
						{formatCaptionShortTimecode(cue.startMs)} –{" "}
						{formatCaptionShortTimecode(cue.endMs)}
					</span>
				</div>
				<span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
					{durationLabel}
				</span>
			</div>

			<label className="flex flex-col gap-1">
				<span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
					{t("captions.editor.text", "Text")}
				</span>
				<textarea
					value={draftText}
					rows={2}
					// Freshly-added captions start empty — focus the field so the
					// user can type immediately after adding one.
					autoFocus={cue.text === ""}
					placeholder={t("captions.manual.cuePlaceholder", "Type caption text...")}
					onFocus={() => onBeginEdit(cue.id)}
					onChange={(event) => setDraftText(event.target.value)}
					onBlur={commitText}
					onKeyDown={(event) => {
						if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
							event.preventDefault();
							commitText();
							if (hasNext) {
								onSelectNext();
							} else {
								onAddNext();
							}
							return;
						}
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							event.currentTarget.blur();
							return;
						}
						if (event.key === "Escape") {
							cancelNextCommitRef.current = true;
							setDraftText(lastSubmittedTextRef.current);
							event.currentTarget.blur();
							return;
						}
						if (event.altKey && event.key === "ArrowLeft") {
							event.preventDefault();
							onSeekBySeconds?.(-2);
							return;
						}
						if (event.altKey && event.key === "ArrowRight") {
							event.preventDefault();
							onSeekBySeconds?.(2);
							return;
						}
						if (event.altKey && event.key === "ArrowUp" && hasPrev) {
							event.preventDefault();
							commitText();
							onSelectPrev();
							return;
						}
						if (event.altKey && event.key === "ArrowDown" && hasNext) {
							event.preventDefault();
							commitText();
							onSelectNext();
							return;
						}
						if (
							(event.ctrlKey || event.metaKey) &&
							event.shiftKey &&
							event.code === "Space"
						) {
							event.preventDefault();
							onTogglePlayPause?.();
						}
					}}
					className="min-h-[3.5rem] w-full resize-none rounded-lg border border-foreground/15 bg-background/70 px-2.5 py-1.5 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/50 outline-none focus-visible:border-[#2563EB] focus-visible:ring-1 focus-visible:ring-[#2563EB]"
				/>
			</label>

			<div className="grid grid-cols-2 gap-2">
				<div className="flex flex-col gap-1">
					<span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
						{t("captions.editor.start", "Start")}
					</span>
					<div className="flex items-center gap-1">
						<input
							value={startValue}
							onChange={(event) => setStartValue(event.target.value)}
							onBlur={commitTiming}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.currentTarget.blur();
								}
							}}
							aria-label={t("captions.editor.start", "Start")}
							className="min-w-0 flex-1 rounded-md border border-foreground/10 bg-background/60 px-2 py-1 font-mono text-[11px] tabular-nums text-foreground outline-none focus-visible:border-[#2563EB] focus-visible:ring-1 focus-visible:ring-[#2563EB]"
						/>
						<button
							type="button"
							onClick={handleSetStartToPlayhead}
							title={t("captions.manual.setStartNow", "Set start to playhead")}
							aria-label={t("captions.manual.setStartNow", "Set start to playhead")}
							className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-foreground/10 bg-foreground/5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
						>
							<ArrowLineLeft className="h-3.5 w-3.5" />
						</button>
					</div>
				</div>

				<div className="flex flex-col gap-1">
					<span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
						{t("captions.editor.end", "End")}
					</span>
					<div className="flex items-center gap-1">
						<input
							value={endValue}
							onChange={(event) => setEndValue(event.target.value)}
							onBlur={commitTiming}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.currentTarget.blur();
								}
							}}
							aria-label={t("captions.editor.end", "End")}
							className="min-w-0 flex-1 rounded-md border border-foreground/10 bg-background/60 px-2 py-1 font-mono text-[11px] tabular-nums text-foreground outline-none focus-visible:border-[#2563EB] focus-visible:ring-1 focus-visible:ring-[#2563EB]"
						/>
						<button
							type="button"
							disabled={!canSetEndToPlayhead}
							onClick={handleSetEndToPlayhead}
							title={t("captions.manual.setEndNow", "Set end to playhead")}
							aria-label={t("captions.manual.setEndNow", "Set end to playhead")}
							className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-foreground/10 bg-foreground/5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-35"
						>
							<ArrowLineRight className="h-3.5 w-3.5" />
						</button>
					</div>
				</div>
			</div>

			<div className="grid grid-cols-4 gap-1.5">
				<button
					type="button"
					disabled={!canSplit}
					onClick={() =>
						onSplit(cue.id, clampNumber(splitTargetMs, cue.startMs, cue.endMs))
					}
					title={t("captions.editor.split", "Split")}
					className="flex h-8 items-center justify-center gap-1 rounded-lg border border-foreground/10 bg-foreground/5 px-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-foreground/10 disabled:opacity-40"
				>
					<Scissors className="h-3.5 w-3.5 shrink-0" />
					<span className="truncate">{t("captions.editor.split", "Split")}</span>
				</button>
				<button
					type="button"
					disabled={!canMerge}
					onClick={() => onMerge(cue.id)}
					title={t("captions.editor.merge", "Merge")}
					className="flex h-8 items-center justify-center gap-1 rounded-lg border border-foreground/10 bg-foreground/5 px-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-foreground/10 disabled:opacity-40"
				>
					<ArrowsMerge className="h-3.5 w-3.5 shrink-0" />
					<span className="truncate">{t("captions.editor.merge", "Merge")}</span>
				</button>
				<button
					type="button"
					onClick={onAddNext}
					title={t("captions.manual.addNext", "+ Next")}
					className="flex h-8 items-center justify-center gap-1 rounded-lg border border-foreground/10 bg-foreground/5 px-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-foreground/10"
				>
					<Plus className="h-3.5 w-3.5 shrink-0" />
					<span className="truncate">{t("captions.manual.nextShort", "Next")}</span>
				</button>
				<Button
					type="button"
					variant="destructive"
					size="sm"
					onClick={() => onDelete(cue.id)}
					title={t("captions.editor.delete", "Delete")}
					className="h-8 gap-1 rounded-lg border border-red-500/20 bg-red-500/10 px-1.5 text-[11px] text-red-400 transition-all hover:border-red-500/30 hover:bg-red-500/20"
				>
					<Trash className="h-3 w-3 shrink-0" />
					<span className="truncate">{t("captions.editor.delete", "Delete")}</span>
				</Button>
			</div>
		</div>
	);
}

export default function CaptionListPanel({
	cues,
	selectedCaptionId,
	currentTimeMs,
	videoDurationMs,
	isPlaying,
	onTogglePlayPause,
	onSeekBySeconds,
	onSelectCaption,
	onAddManualCaption,
	onImportCaptions,
	onClearCaptions,
	onBeginCaptionEdit,
	onCaptionTextEdit,
	onCaptionRetime,
	onCaptionSplit,
	onCaptionMerge,
	onCaptionDelete,
}: CaptionListPanelProps) {
	const t = useScopedT("settings");
	const [quickDraft, setQuickDraft] = useState("");
	const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
	const quickInputRef = useRef<HTMLTextAreaElement | null>(null);
	const liveStartMsRef = useRef<number | null>(null);
	const cueRefsRef = useRef<Map<string, HTMLDivElement>>(new Map());

	const sortedCues = useMemo(
		() =>
			[...cues].sort(
				(left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
			),
		[cues],
	);

	useEffect(() => {
		if (!selectedCaptionId) {
			return;
		}
		const element = cueRefsRef.current.get(selectedCaptionId);
		element?.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}, [selectedCaptionId]);

	const targetPreviewSpan = useMemo(() => {
		if (videoDurationMs <= 0) {
			return null;
		}
		const preferredStart = liveStartMsRef.current ?? currentTimeMs;
		return findNextAvailableCaptionSpan(sortedCues, preferredStart, {
			durationMs: estimateCaptionDurationMs(quickDraft),
			maxDurationMs: videoDurationMs,
		});
	}, [currentTimeMs, quickDraft, sortedCues, videoDurationMs]);

	const handleSubmitQuickDraft = useCallback(() => {
		const trimmed = quickDraft.trim();
		if (!trimmed) {
			return;
		}

		const liveStartMs = liveStartMsRef.current;
		const created =
			liveStartMs !== null && currentTimeMs - liveStartMs >= 600
				? onAddManualCaption({
						text: trimmed,
						startMs: liveStartMs,
						endMs: currentTimeMs,
						keepPlaying: isPlaying,
						selectAfterAdd: false,
					})
				: onAddManualCaption({
						text: trimmed,
						startMs: liveStartMs ?? currentTimeMs,
						keepPlaying: isPlaying,
						selectAfterAdd: false,
					});

		if (created) {
			setQuickDraft("");
			liveStartMsRef.current = null;
			quickInputRef.current?.focus();
		}
	}, [currentTimeMs, isPlaying, onAddManualCaption, quickDraft]);

	const cueCountLabel =
		sortedCues.length === 1
			? t("captions.manual.countSingle", "1 caption")
			: t("captions.manual.countPlural", "{{count}} captions", { count: sortedCues.length });

	return (
		<div className="flex flex-col gap-3">
			{/* Compact Transport + Quick Add Bar */}
			<div className="flex items-center justify-between gap-2 rounded-xl border border-foreground/10 bg-foreground/[0.03] px-2 py-1.5">
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={() => onSeekBySeconds?.(-2)}
						disabled={!onSeekBySeconds}
						title={t("captions.manual.seekBack", "Back 2s (Alt+←)")}
						aria-label={t("captions.manual.seekBack", "Back 2s (Alt+←)")}
						className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-40"
					>
						<Rewind className="h-3.5 w-3.5" weight="fill" />
					</button>
					<button
						type="button"
						onClick={() => onTogglePlayPause?.()}
						disabled={!onTogglePlayPause}
						title={t("captions.manual.playPause", "Play / Pause")}
						aria-label={t("captions.manual.playPause", "Play / Pause")}
						className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground/10 text-foreground transition-colors hover:bg-foreground/20 disabled:opacity-40"
					>
						{isPlaying ? (
							<Pause className="h-3.5 w-3.5" weight="fill" />
						) : (
							<Play className="h-3.5 w-3.5" weight="fill" />
						)}
					</button>
					<button
						type="button"
						onClick={() => onSeekBySeconds?.(2)}
						disabled={!onSeekBySeconds}
						title={t("captions.manual.seekForward", "Forward 2s (Alt+→)")}
						aria-label={t("captions.manual.seekForward", "Forward 2s (Alt+→)")}
						className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-40"
					>
						<FastForward className="h-3.5 w-3.5" weight="fill" />
					</button>
					<span className="ml-1 font-mono text-[11px] font-medium tabular-nums text-foreground/80">
						{formatCaptionShortTimecode(currentTimeMs)}
					</span>
				</div>

				<Button
					type="button"
					size="sm"
					disabled={videoDurationMs <= 0}
					onClick={() =>
						onAddManualCaption({
							startMs: currentTimeMs,
							keepPlaying: false,
							selectAfterAdd: true,
						})
					}
					className="h-7 gap-1 rounded-lg bg-[#2563EB] px-2.5 text-[11px] font-semibold text-white hover:bg-[#2563EB]/90"
				>
					<Plus className="h-3.5 w-3.5" />
					{t("captions.manual.addHere", "Add")}
				</Button>
			</div>

			{/* Quick-Write Composer */}
			<div className="flex flex-col gap-1.5 rounded-xl border border-foreground/10 bg-foreground/[0.03] p-2.5">
				<div className="flex items-center justify-between gap-2">
					<span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
						{t("captions.manual.quickWriteTitle", "Quick write")}
					</span>
					{videoDurationMs > 0 ? (
						<span className="font-mono text-[10px] tabular-nums text-muted-foreground">
							{targetPreviewSpan
								? `${formatCaptionShortTimecode(targetPreviewSpan.startMs)} → ${formatCaptionShortTimecode(targetPreviewSpan.endMs)}`
								: t("captions.manual.noSpaceShort", "No space left")}
						</span>
					) : null}
				</div>

				<textarea
					ref={quickInputRef}
					value={quickDraft}
					rows={2}
					onChange={(event) => {
						const nextValue = event.target.value;
						if (
							nextValue.trim().length > 0 &&
							liveStartMsRef.current === null &&
							isPlaying
						) {
							liveStartMsRef.current = currentTimeMs;
						} else if (nextValue.trim().length === 0) {
							liveStartMsRef.current = null;
						}
						setQuickDraft(nextValue);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							handleSubmitQuickDraft();
							return;
						}
						if (event.altKey && event.key === "ArrowLeft") {
							event.preventDefault();
							onSeekBySeconds?.(-2);
							return;
						}
						if (event.altKey && event.key === "ArrowRight") {
							event.preventDefault();
							onSeekBySeconds?.(2);
							return;
						}
						if (
							(event.ctrlKey || event.metaKey) &&
							event.shiftKey &&
							event.code === "Space"
						) {
							event.preventDefault();
							onTogglePlayPause?.();
						}
					}}
					placeholder={t(
						"captions.manual.quickWritePlaceholder",
						"Type a caption and press Enter...",
					)}
					className="min-h-[3.25rem] w-full resize-none rounded-lg border border-foreground/10 bg-background/60 px-2.5 py-1.5 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/60 outline-none focus-visible:border-[#2563EB] focus-visible:ring-1 focus-visible:ring-[#2563EB]"
				/>

				<div className="flex items-center justify-between gap-2">
					<span className="text-[10px] text-muted-foreground/80">
						{t(
							"captions.manual.quickWriteHint",
							"Enter inserts · Alt+←/→ seeks · Ctrl+Shift+Space plays",
						)}
					</span>
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={!quickDraft.trim() || videoDurationMs <= 0}
						onClick={handleSubmitQuickDraft}
						className="h-6 shrink-0 rounded-md border-foreground/10 bg-foreground/5 px-2 text-[10px] font-medium text-foreground hover:bg-foreground/10"
					>
						{t("captions.manual.insert", "Insert")}
					</Button>
				</div>
			</div>

			{/* Cue List Header & Bulk Tools */}
			<div className="flex items-center justify-between gap-2 px-0.5">
				<span className="text-[11px] font-medium text-muted-foreground">
					{cueCountLabel}
				</span>
				<div className="flex items-center gap-1.5">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => setBulkDialogOpen(true)}
						className="h-7 gap-1 rounded-lg border-foreground/10 bg-foreground/5 px-2 text-[11px] text-foreground hover:bg-foreground/10"
					>
						<FileText className="h-3.5 w-3.5" />
						{t("captions.manual.scriptOrSrt", "Script / SRT")}
					</Button>
					{sortedCues.length > 0 ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={onClearCaptions}
							title={t("captions.clearFull", "Clear Captions")}
							className="h-7 gap-1 rounded-lg px-2 text-[11px] text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
						>
							<Trash className="h-3.5 w-3.5" />
							{t("captions.manual.clearShort", "Clear")}
						</Button>
					) : null}
				</div>
			</div>

			{/* Scrollable Cue List */}
			{sortedCues.length === 0 ? (
				<div className="rounded-xl border border-dashed border-foreground/10 bg-foreground/[0.02] px-3 py-5 text-center">
					<p className="text-xs font-medium text-foreground/80">
						{t("captions.manual.emptyTitle", "No captions yet")}
					</p>
					<p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
						{t(
							"captions.manual.emptyDescription",
							"Type above and press Enter, press S on the timeline, or paste a script / SRT file.",
						)}
					</p>
				</div>
			) : (
				<div className="flex flex-col gap-1.5 pb-2">
					{sortedCues.map((cue, index) => {
						const isSelected = cue.id === selectedCaptionId;
						const isActiveAtPlayhead =
							currentTimeMs >= cue.startMs && currentTimeMs <= cue.endMs;
						const canMerge = index < sortedCues.length - 1;

						return (
							<div
								key={cue.id}
								ref={(node) => {
									if (node) {
										cueRefsRef.current.set(cue.id, node);
									} else {
										cueRefsRef.current.delete(cue.id);
									}
								}}
							>
								{isSelected ? (
									<InlineCueEditor
										cue={cue}
										index={index}
										canMerge={canMerge}
										hasPrev={index > 0}
										hasNext={index < sortedCues.length - 1}
										currentTimeMs={currentTimeMs}
										videoDurationMs={videoDurationMs}
										onTogglePlayPause={onTogglePlayPause}
										onSeekBySeconds={onSeekBySeconds}
										onBeginEdit={onBeginCaptionEdit}
										onTextEdit={onCaptionTextEdit}
										onRetime={onCaptionRetime}
										onSplit={onCaptionSplit}
										onMerge={(id) => {
											if (canMerge) {
												onCaptionMerge(id, sortedCues[index + 1].id);
											}
										}}
										onAddNext={() =>
											onAddManualCaption({
												startMs: cue.endMs,
												selectAfterAdd: true,
											})
										}
										onSelectPrev={() =>
											onSelectCaption(sortedCues[index - 1].id)
										}
										onSelectNext={() =>
											onSelectCaption(sortedCues[index + 1].id)
										}
										onDelete={onCaptionDelete}
									/>
								) : (
									<button
										type="button"
										onClick={() => onSelectCaption(cue.id)}
										className={cn(
											"flex w-full flex-col gap-1 rounded-xl border px-2.5 py-2 text-left transition-colors",
											isActiveAtPlayhead
												? "border-[#2563EB]/45 bg-[#2563EB]/[0.08]"
												: "border-foreground/10 bg-foreground/[0.03] hover:border-foreground/20 hover:bg-foreground/[0.06]",
										)}
									>
										<div className="flex w-full items-center justify-between gap-2">
											<span className="font-mono text-[10px] font-semibold text-muted-foreground">
												#{index + 1}
											</span>
											<span className="font-mono text-[10px] tabular-nums text-muted-foreground">
												{formatCaptionShortTimecode(cue.startMs)} –{" "}
												{formatCaptionShortTimecode(cue.endMs)}
											</span>
										</div>
										<p
											className={cn(
												"line-clamp-2 text-xs leading-snug",
												cue.text.trim()
													? "text-foreground"
													: "italic text-muted-foreground",
											)}
										>
											{cue.text.trim() ||
												t("captions.manual.emptyCue", "Empty caption...")}
										</p>
									</button>
								)}
							</div>
						);
					})}
				</div>
			)}

			<BulkCaptionDialog
				open={bulkDialogOpen}
				onOpenChange={setBulkDialogOpen}
				existingCount={sortedCues.length}
				videoDurationMs={videoDurationMs}
				currentTimeMs={currentTimeMs}
				onImport={onImportCaptions}
			/>
		</div>
	);
}
