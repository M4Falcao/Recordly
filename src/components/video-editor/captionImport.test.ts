import { describe, expect, it } from "vitest";
import { parseCaptionImportText } from "./captionImport";

describe("parseCaptionImportText", () => {
	it("returns empty cues for blank input", () => {
		expect(parseCaptionImportText("  \n\t \n ", { videoDurationMs: 10_000 })).toEqual({
			format: "plain-lines",
			cues: [],
		});
	});

	it("parses SRT blocks with BOM, comma decimals, multi-line text, and duration clamping", () => {
		const srt = `\uFEFF1
00:00:01,250 --> 00:00:03,500
First line
second line

2
00:00:08,000 --> 00:00:12,000
Clamped end

3
00:00:15,000 --> 00:00:17,000
After video ends
`;
		const result = parseCaptionImportText(srt, { videoDurationMs: 10_000 });
		expect(result.format).toBe("srt-vtt");
		expect(result.cues).toHaveLength(2);
		expect(result.cues[0]).toMatchObject({
			startMs: 1_250,
			endMs: 3_500,
			text: "First line second line",
		});
		expect(result.cues[0].words).toBeUndefined();
		expect(result.cues[1]).toMatchObject({
			startMs: 8_000,
			endMs: 10_000,
			text: "Clamped end",
		});
	});

	it("parses WebVTT with headers, NOTE blocks, cue settings, and inline tags", () => {
		const vtt = `WEBVTT

NOTE This is a comment block

00:01.000 --> 00:03.200 align:center position:50%
<i>Hello</i> <b>world</b>

00:04.000 --> 00:06.500
Second subtitle
`;
		const result = parseCaptionImportText(vtt, { videoDurationMs: 20_000 });
		expect(result.format).toBe("srt-vtt");
		expect(result.cues.map((cue) => [cue.startMs, cue.endMs, cue.text])).toEqual([
			[1_000, 3_200, "Hello world"],
			[4_000, 6_500, "Second subtitle"],
		]);
	});

	it("parses timestamped lines with implicit and explicit end times", () => {
		const input = `0:00 Intro
0:04.5 Next line
[0:10 - 0:13] Explicit range`;
		const result = parseCaptionImportText(input, { videoDurationMs: 20_000 });
		expect(result.format).toBe("timestamped-lines");
		expect(result.cues.map((cue) => [cue.startMs, cue.endMs, cue.text])).toEqual([
			[0, 4_500, "Intro"],
			[4_500, 10_000, "Next line"],
			[10_000, 13_000, "Explicit range"],
		]);
	});

	it("distributes plain lines sequentially and scales proportionally when exceeding duration", () => {
		const fit = parseCaptionImportText("Hello\nWorld", {
			videoDurationMs: 20_000,
			startOffsetMs: 2_000,
		});
		expect(fit.format).toBe("plain-lines");
		expect(fit.cues.map((cue) => [cue.startMs, cue.endMs, cue.text])).toEqual([
			[2_000, 3_500, "Hello"],
			[3_500, 5_000, "World"],
		]);

		const compressed = parseCaptionImportText("Line one\nLine two\nLine three\nLine four", {
			videoDurationMs: 2_000,
		});
		expect(compressed.format).toBe("plain-lines");
		expect(compressed.cues).toHaveLength(4);
		expect(compressed.cues[0].startMs).toBe(0);
		expect(compressed.cues[3].endMs).toBe(2_000);
		for (let index = 1; index < compressed.cues.length; index += 1) {
			expect(compressed.cues[index].startMs).toBeGreaterThanOrEqual(
				compressed.cues[index - 1].endMs,
			);
			expect(compressed.cues[index].endMs).toBeGreaterThan(compressed.cues[index].startMs);
		}

		const fallbackFromEnd = parseCaptionImportText("First\nSecond", {
			videoDurationMs: 10_000,
			startOffsetMs: 9_800,
		});
		expect(fallbackFromEnd.cues.map((cue) => cue.startMs)).toEqual([0, 1_500]);
	});
});
