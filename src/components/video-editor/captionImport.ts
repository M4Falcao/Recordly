import { normalizeCaptionEditText } from "./captionEditing";
import { createCaptionCue, estimateCaptionDurationMs } from "./captionOps";
import type { CaptionCue } from "./types";

export type DetectedCaptionImportFormat = "srt-vtt" | "timestamped-lines" | "plain-lines";

export interface ParsedCaptionImportResult {
	format: DetectedCaptionImportFormat;
	cues: CaptionCue[];
}

const SRT_VTT_TIMING_LINE_REGEX =
	/(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

const TIMESTAMPED_LINE_REGEX =
	/^\[?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?\]?(?:\s*[-–]\s*\[?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?\]?)?\s+(.+)$/;

const HEADER_BLOCK_PREFIX_REGEX = /^(?:WEBVTT|NOTE|STYLE|REGION)\b/i;

function parseMatchedTimestampMs(
	hoursStr: string | undefined,
	minutesStr: string,
	secondsStr: string,
	millisStr: string | undefined,
): number | null {
	const hours = hoursStr ? Number.parseInt(hoursStr, 10) : 0;
	const minutes = Number.parseInt(minutesStr, 10);
	const seconds = Number.parseInt(secondsStr, 10);
	if (hoursStr && minutes >= 60) {
		return null;
	}
	if (seconds >= 60) {
		return null;
	}
	const millis = millisStr ? Number.parseInt(millisStr.padEnd(3, "0"), 10) : 0;
	return ((hours * 60 + minutes) * 60 + seconds) * 1_000 + millis;
}

function stripSimpleCaptionMarkup(text: string): string {
	return text.replace(/<[^>]+>/g, "");
}

function parseSrtOrVttBlocks(rawNormalized: string, videoDurationMs: number): CaptionCue[] {
	const blocks = rawNormalized.split(/\n\s*\n+/);
	const cues: CaptionCue[] = [];

	for (const block of blocks) {
		const lines = block
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
		if (lines.length === 0) {
			continue;
		}

		const timingLineIndex = lines.findIndex((line) => SRT_VTT_TIMING_LINE_REGEX.test(line));
		if (timingLineIndex < 0) {
			if (HEADER_BLOCK_PREFIX_REGEX.test(lines[0])) {
				continue;
			}
			continue;
		}

		const timingMatch = lines[timingLineIndex].match(SRT_VTT_TIMING_LINE_REGEX);
		if (!timingMatch) {
			continue;
		}

		const parsedStartMs = parseMatchedTimestampMs(
			timingMatch[1],
			timingMatch[2],
			timingMatch[3],
			timingMatch[4],
		);
		const parsedEndMs = parseMatchedTimestampMs(
			timingMatch[5],
			timingMatch[6],
			timingMatch[7],
			timingMatch[8],
		);
		if (parsedStartMs === null || parsedEndMs === null) {
			continue;
		}

		const rawContent = lines.slice(timingLineIndex + 1).join(" ");
		const cleanText = normalizeCaptionEditText(stripSimpleCaptionMarkup(rawContent));
		if (!cleanText) {
			continue;
		}

		const startMs = Math.max(0, parsedStartMs);
		const endMs = videoDurationMs > 0 ? Math.min(parsedEndMs, videoDurationMs) : parsedEndMs;
		if ((videoDurationMs > 0 && startMs >= videoDurationMs) || endMs <= startMs) {
			continue;
		}

		cues.push(createCaptionCue({ startMs, endMs, text: cleanText }));
	}

	return cues.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
}

function parseTimestampedLines(
	nonEmptyLines: string[],
	videoDurationMs: number,
): CaptionCue[] | null {
	const entries: Array<{ startMs: number; explicitEndMs: number | null; text: string }> = [];

	for (const line of nonEmptyLines) {
		const match = line.match(TIMESTAMPED_LINE_REGEX);
		if (!match) {
			continue;
		}

		const startMs = parseMatchedTimestampMs(match[1], match[2], match[3], match[4]);
		if (startMs === null) {
			continue;
		}

		let explicitEndMs: number | null = null;
		if (match[6] !== undefined && match[7] !== undefined) {
			explicitEndMs = parseMatchedTimestampMs(match[5], match[6], match[7], match[8]);
		}

		const cleanText = normalizeCaptionEditText(match[9]);
		if (!cleanText) {
			continue;
		}

		entries.push({ startMs, explicitEndMs, text: cleanText });
	}

	if (entries.length === 0 || entries.length < nonEmptyLines.length / 2) {
		return null;
	}

	entries.sort((left, right) => left.startMs - right.startMs);

	const cues: CaptionCue[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		const nextEntry = entries[index + 1];
		const rawEndMs =
			entry.explicitEndMs !== null
				? entry.explicitEndMs
				: nextEntry && nextEntry.startMs > entry.startMs
					? nextEntry.startMs
					: entry.startMs + estimateCaptionDurationMs(entry.text);

		const startMs = Math.max(0, entry.startMs);
		const endMs = videoDurationMs > 0 ? Math.min(rawEndMs, videoDurationMs) : rawEndMs;
		if ((videoDurationMs > 0 && startMs >= videoDurationMs) || endMs <= startMs) {
			continue;
		}

		cues.push(createCaptionCue({ startMs, endMs, text: entry.text }));
	}

	return cues;
}

function buildPlainLineCues(
	lines: string[],
	videoDurationMs: number,
	startOffsetMs: number,
): CaptionCue[] {
	if (lines.length === 0) {
		return [];
	}

	const idealDurations = lines.map((line) => estimateCaptionDurationMs(line));
	let cursor = Math.max(0, Math.round(startOffsetMs));

	if (videoDurationMs <= 0) {
		return lines.map((text, index) => {
			const startMs = cursor;
			const endMs = startMs + idealDurations[index];
			cursor = endMs;
			return createCaptionCue({ startMs, endMs, text });
		});
	}

	let availableMs = Math.max(0, videoDurationMs - cursor);
	if (
		availableMs < lines.length * 300 &&
		(videoDurationMs >= lines.length * 300 || availableMs === 0)
	) {
		cursor = 0;
		availableMs = videoDurationMs;
	}

	const totalIdeal = idealDurations.reduce((sum, duration) => sum + duration, 0);
	const needsScaling = totalIdeal > availableMs && availableMs > 0;
	const scale = needsScaling ? availableMs / totalIdeal : 1;
	const minPerCue = Math.min(300, Math.max(50, Math.floor(availableMs / lines.length)));

	const cues: CaptionCue[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		if (cursor >= videoDurationMs) {
			break;
		}
		const remainingCount = lines.length - 1 - index;
		let durationMs = idealDurations[index];
		if (needsScaling) {
			if (index === lines.length - 1) {
				durationMs = Math.max(1, videoDurationMs - cursor);
			} else {
				const maxAllowed = Math.max(
					1,
					videoDurationMs - cursor - remainingCount * minPerCue,
				);
				const scaled = Math.round(idealDurations[index] * scale);
				durationMs = Math.min(maxAllowed, Math.max(minPerCue, scaled));
			}
		}

		const startMs = cursor;
		const endMs = Math.min(videoDurationMs, startMs + Math.max(1, durationMs));
		if (endMs <= startMs) {
			break;
		}
		cues.push(createCaptionCue({ startMs, endMs, text: lines[index] }));
		cursor = endMs;
	}

	return cues;
}

/**
 * Parse pasted script lines, timestamped lines, or SRT/WebVTT text into caption cues.
 */
export function parseCaptionImportText(
	rawText: string,
	options: {
		videoDurationMs: number;
		startOffsetMs?: number;
	},
): ParsedCaptionImportResult {
	const normalizedNewlines = rawText.replace(/^\uFEFF/, "").replace(/\r\n?|\n/g, "\n");
	if (!normalizedNewlines.trim()) {
		return { format: "plain-lines", cues: [] };
	}

	const videoDurationMs = Math.max(0, Math.round(options.videoDurationMs));
	const startOffsetMs = Math.max(0, Math.round(options.startOffsetMs ?? 0));

	if (SRT_VTT_TIMING_LINE_REGEX.test(normalizedNewlines)) {
		return {
			format: "srt-vtt",
			cues: parseSrtOrVttBlocks(normalizedNewlines, videoDurationMs),
		};
	}

	const nonEmptyLines = normalizedNewlines
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	const timestampedCues = parseTimestampedLines(nonEmptyLines, videoDurationMs);
	if (timestampedCues) {
		return {
			format: "timestamped-lines",
			cues: timestampedCues,
		};
	}

	const plainLines = nonEmptyLines.map(normalizeCaptionEditText).filter(Boolean);
	return {
		format: "plain-lines",
		cues: buildPlainLineCues(plainLines, videoDurationMs, startOffsetMs),
	};
}
