import { FileText, UploadSimple } from "@phosphor-icons/react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import { type DetectedCaptionImportFormat, parseCaptionImportText } from "./captionImport";
import type { CaptionCue } from "./types";

interface BulkCaptionDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	existingCount: number;
	videoDurationMs: number;
	currentTimeMs: number;
	onImport: (cues: CaptionCue[], mode: "replace" | "append") => void;
}

export function BulkCaptionDialog({
	open,
	onOpenChange,
	existingCount,
	videoDurationMs,
	currentTimeMs,
	onImport,
}: BulkCaptionDialogProps) {
	const t = useScopedT("settings");
	const [rawText, setRawText] = useState("");
	const [mode, setMode] = useState<"replace" | "append">(
		existingCount > 0 ? "append" : "replace",
	);
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		if (open) {
			setMode(existingCount > 0 ? "append" : "replace");
		}
	}, [existingCount, open]);

	const parsed = useMemo(
		() =>
			parseCaptionImportText(rawText, {
				videoDurationMs,
				startOffsetMs: mode === "append" ? currentTimeMs : 0,
			}),
		[currentTimeMs, mode, rawText, videoDurationMs],
	);

	const getFormatLabel = (format: DetectedCaptionImportFormat) => {
		switch (format) {
			case "srt-vtt":
				return t("captions.bulk.formatSrtVtt", "SRT / WebVTT");
			case "timestamped-lines":
				return t("captions.bulk.formatTimestamped", "Timestamped");
			case "plain-lines":
			default:
				return t("captions.bulk.formatScript", "Script");
		}
	};

	const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) {
			return;
		}
		const reader = new FileReader();
		reader.onload = (loadEvent) => {
			const result = loadEvent.target?.result;
			if (typeof result === "string") {
				setRawText(result);
			}
		};
		reader.onerror = () => {
			toast.error(t("captions.bulk.fileReadError", "Failed to read subtitle file."));
		};
		reader.readAsText(file);
		event.target.value = "";
	};

	const handleConfirm = () => {
		if (parsed.cues.length === 0) {
			return;
		}
		onImport(parsed.cues, mode);
		toast.success(
			parsed.cues.length === 1
				? t("captions.bulk.importedSingle", "1 caption added")
				: t("captions.bulk.importedCount", "{{count}} captions added", {
						count: parsed.cues.length,
					}),
		);
		setRawText("");
		onOpenChange(false);
	};

	const detectedCountText =
		parsed.cues.length === 1
			? t("captions.bulk.detectedSingle", "1 caption detected ({{format}})", {
					format: getFormatLabel(parsed.format),
				})
			: t("captions.bulk.detectedCount", "{{count}} captions detected ({{format}})", {
					count: parsed.cues.length,
					format: getFormatLabel(parsed.format),
				});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-[520px] border-foreground/10 bg-editor-dialog text-foreground">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-sm font-semibold">
						<FileText className="h-4 w-4 text-[#2563EB]" />
						{t("captions.bulk.title", "Script & Subtitle Import")}
					</DialogTitle>
					<DialogDescription className="text-xs text-muted-foreground">
						{t(
							"captions.bulk.description",
							"Paste one subtitle per line, lines with timestamps (e.g. 0:04 Text), or SRT / VTT content.",
						)}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<input
							ref={fileInputRef}
							type="file"
							accept=".srt,.vtt,.txt"
							onChange={handleFileChange}
							className="hidden"
						/>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => fileInputRef.current?.click()}
							className="h-8 gap-1.5 rounded-lg border-foreground/10 bg-foreground/5 text-xs text-foreground hover:bg-foreground/10"
						>
							<UploadSimple className="h-3.5 w-3.5" />
							{t("captions.bulk.importFile", "Import .srt / .vtt / .txt")}
						</Button>

						{existingCount > 0 ? (
							<div className="inline-flex rounded-lg border border-foreground/10 bg-foreground/[0.04] p-0.5 text-[11px]">
								<button
									type="button"
									onClick={() => setMode("append")}
									className={cn(
										"rounded-md px-2.5 py-1 font-medium transition-colors",
										mode === "append"
											? "bg-[#2563EB] text-white"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									{t("captions.bulk.modeAppend", "Append")}
								</button>
								<button
									type="button"
									onClick={() => setMode("replace")}
									className={cn(
										"rounded-md px-2.5 py-1 font-medium transition-colors",
										mode === "replace"
											? "bg-[#2563EB] text-white"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									{t("captions.bulk.modeReplace", "Replace")}
								</button>
							</div>
						) : null}
					</div>

					<textarea
						value={rawText}
						onChange={(event) => setRawText(event.target.value)}
						rows={9}
						placeholder={t(
							"captions.bulk.placeholder",
							"Example (one line per subtitle):\nWelcome to this demo.\nHere is how the editor works.\n\nOr with timestamps:\n0:00 Welcome to this demo.\n0:03.5 Here is how the editor works.\n\nOr paste an .srt / .vtt file.",
						)}
						className="w-full resize-y rounded-xl border border-foreground/10 bg-background/60 px-3 py-2 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/60 outline-none focus-visible:border-[#2563EB] focus-visible:ring-1 focus-visible:ring-[#2563EB]"
					/>

					<div className="flex items-center justify-between text-[11px] text-muted-foreground">
						<span className="inline-flex items-center rounded-full border border-foreground/10 bg-foreground/[0.04] px-2.5 py-0.5">
							{rawText.trim()
								? detectedCountText
								: t("captions.bulk.emptyStatus", "Paste text or load a file")}
						</span>
					</div>
				</div>

				<DialogFooter className="gap-2 sm:justify-end">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => onOpenChange(false)}
					>
						{t("captions.bulk.cancel", "Cancel")}
					</Button>
					<Button
						type="button"
						size="sm"
						disabled={parsed.cues.length === 0}
						onClick={handleConfirm}
						className="bg-[#2563EB] text-white hover:bg-[#1d4ed8]"
					>
						{t("captions.bulk.apply", "Apply Captions")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
