import { NextRequest, NextResponse } from "next/server";
import {
  downloadLoomVideo,
  downloadLoomSubtitles,
  cleanupVideo,
} from "@/lib/videoDownloader";
import {
  extractFrame,
  secondsToTimestamp,
  getVideoDuration,
} from "@/lib/frameExtractor";
import {
  parseManualTranscript,
  parseSubtitleFile,
  extractLoomVideoId,
  generateLoomUrlWithTimestamp,
} from "@/lib/transcriptParser";
import { analyzeTranscriptForRevision } from "@/lib/revisionProviders";
import { getDBContext, formatDBContextForPrompt } from "@/lib/dbContext";
import { saveExtractionResult } from "@/lib/resultsDb";
import * as path from "path";
import * as fs from "fs";

export const maxDuration = 800;

// Revision screenshots are captured this many seconds AFTER the moment the
// reviewer spoke. The reviewer usually narrates a beat before the relevant
// on-screen state settles, so the frame one second later better shows what they
// mean (e.g. note spoken at 0:35 → screenshot grabbed at 0:36). The note's own
// timestamp/Loom deep-link stay at the spoken moment.
const SCREENSHOT_OFFSET_SECONDS = 2;

export async function POST(request: NextRequest) {
  let videoPath: string | null = null;
  let subtitlePath: string | null = null;

  // Ensure runtime directories exist (Railway ephemeral filesystem)
  for (const dir of [
    path.join(/*turbopackIgnore: true*/ process.cwd(), "temp"),
    path.join(
      /*turbopackIgnore: true*/ process.cwd(),
      "public",
      "temp",
      "frames",
    ),
  ]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  try {
    const body = await request.json();
    const { loomUrl, manualTranscript } = body;

    if (!loomUrl) {
      return NextResponse.json(
        { error: "Loom URL is required" },
        { status: 400 },
      );
    }

    const videoId = extractLoomVideoId(loomUrl);
    if (!videoId) {
      return NextResponse.json(
        { error: "Invalid Loom URL format" },
        { status: 400 },
      );
    }

    console.log(`[Revision] Processing Loom video: ${videoId}`);

    // Step 0: DB context (for project/client matching)
    console.log("[Revision] Step 0: Loading DB reference data...");
    const dbCtx = await getDBContext();
    const dbContextString = formatDBContextForPrompt(dbCtx);

    // Step 1: Download video
    console.log("[Revision] Step 1: Downloading video...");
    const { videoPath: downloadedVideoPath } = await downloadLoomVideo(loomUrl);
    videoPath = downloadedVideoPath;

    // Step 2: Transcript
    console.log("[Revision] Step 2: Processing transcript...");
    let transcript;

    if (manualTranscript && manualTranscript.trim()) {
      transcript = parseManualTranscript(manualTranscript);
    } else {
      try {
        const subtitleResult = await downloadLoomSubtitles(loomUrl);
        subtitlePath = subtitleResult.path;
        transcript = parseSubtitleFile(subtitlePath, subtitleResult.format);
        console.log(
          `[Revision] Extracted ${transcript.length} transcript entries (format: ${subtitleResult.format})`,
        );
      } catch (error) {
        return NextResponse.json(
          {
            error: `Failed to extract transcript: ${error instanceof Error ? error.message : String(error)}`,
            needsManualTranscript: true,
          },
          { status: 400 },
        );
      }
    }

    if (transcript.length === 0) {
      return NextResponse.json(
        { error: "No valid transcript entries found" },
        { status: 400 },
      );
    }

    // Step 3: AI revision analysis
    console.log("[Revision] Step 3: Running revision AI analysis...");
    const revisionResult = await analyzeTranscriptForRevision(
      transcript,
      dbContextString,
    );

    console.log(
      `[Revision] Found ${revisionResult.global_notes.length} global notes, ${revisionResult.revision_notes.length} timestamped notes`,
    );

    if (
      revisionResult.global_notes.length === 0 &&
      revisionResult.revision_notes.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "No revision notes found in the transcript. The video may not contain editorial feedback.",
        },
        { status: 400 },
      );
    }

    // Step 4: Extract frames for timestamped revision notes
    console.log("[Revision] Step 4: Extracting video frames...");

    if (!videoPath) throw new Error("Video path not set");

    // Get video duration to skip/clamp out-of-range timestamps
    const videoDuration = await getVideoDuration(videoPath);
    if (videoDuration) {
      console.log(`[Revision] Video duration: ${Math.round(videoDuration)}s`);
    }

    async function processWithConcurrencyLimit<T>(
      items: T[],
      limit: number,
      fn: (item: T) => Promise<any>,
    ): Promise<any[]> {
      const results: any[] = [];
      for (let i = 0; i < items.length; i += limit) {
        const batch = items.slice(i, i + limit);
        const batchResults = await Promise.all(batch.map(fn));
        results.push(...batchResults);
      }
      return results;
    }

    const notesWithScreenshots = await processWithConcurrencyLimit(
      revisionResult.revision_notes,
      1,
      async (note) => {
        // ALWAYS base the frame on note.timestamp_seconds (when the reviewer was speaking
        // in the Loom). Do NOT use screenshot_timestamps from AI — those may reference the
        // *reviewed video*'s timestamps (e.g. "59 second mark") which are completely different
        // positions in the Loom. Capture SCREENSHOT_OFFSET_SECONDS after the spoken moment so
        // the frame shows the state the reviewer is pointing at (0:35 spoken → 0:36 frame).
        let timestamps = [note.timestamp_seconds + SCREENSHOT_OFFSET_SECONDS];

        // Clamp timestamps to video duration (prevents ffmpeg failures at end of video)
        if (videoDuration) {
          const clampedMax = Math.max(0, videoDuration - 2);
          const before = timestamps.length;
          timestamps = timestamps
            .map((ts) => Math.floor(Math.min(ts, clampedMax))) // floor to integer — avoids float filenames
            // Deduplicate after clamping
            .filter((ts, idx, arr) => arr.indexOf(ts) === idx);
          if (timestamps.length < before) {
            console.log(
              `[Revision] Clamped ${before - timestamps.length} out-of-range timestamp(s) for note "${note.note.substring(0, 40)}..."`,
            );
          }
        }

        const screenshots = await processWithConcurrencyLimit(
          timestamps,
          1,
          async (ts: number) => {
            try {
              if (ts !== timestamps[0]) {
                await new Promise((r) => setTimeout(r, 500));
              }
              const tsLabel = secondsToTimestamp(ts);
              const framePath = await extractFrame({
                videoPath: videoPath!,
                timestampSeconds: ts,
                timestampLabel: tsLabel,
              });
              const relPath = path.relative(
                path.join(/*turbopackIgnore: true*/ process.cwd(), "public"),
                framePath,
              );
              const imageUrl = "/" + relPath.replace(/\\/g, "/");

              let base64Image = "";
              try {
                const buf = fs.readFileSync(framePath);
                base64Image = `data:image/jpeg;base64,${buf.toString("base64")}`;
                try {
                  fs.unlinkSync(framePath);
                } catch {}
              } catch (e: any) {
                console.error(
                  `[Revision] ❌ Failed to read frame at ${framePath}:`,
                  e.message,
                );
              }

              return {
                timestamp_seconds: ts,
                timestamp_label: tsLabel,
                image_url: imageUrl,
                image_base64: base64Image,
              };
            } catch {
              return null;
            }
          },
        );

        const validScreenshots = screenshots.filter(Boolean);

        return {
          ...note,
          loom_url: generateLoomUrlWithTimestamp(
            videoId,
            note.timestamp_seconds,
          ),
          screenshots: validScreenshots,
        };
      },
    );

    // Format transcript for storage
    const transcriptForStorage = transcript.map((e) => ({
      t: e.timestamp_label,
      s: e.text,
    }));

    const responseData = {
      videoId,
      loomUrl,
      title: revisionResult.title,
      summary: revisionResult.summary,
      global_notes: revisionResult.global_notes,
      revision_notes: notesWithScreenshots,
      transcript: transcriptForStorage,
    };

    let resultId: string | null = null;
    try {
      const r = await saveExtractionResult({
        mode: "revision",
        title: revisionResult.title || null,
        summary: revisionResult.summary || null,
        videoId,
        loomUrl,
        itemCount:
          (revisionResult.global_notes?.length || 0) +
          (notesWithScreenshots?.length || 0),
        payload: responseData,
      });
      resultId = r.id;
    } catch (saveErr: any) {
      console.warn(
        "[process-revision] history save failed:",
        saveErr?.message || saveErr,
      );
    }

    return NextResponse.json({ ...responseData, id: resultId });
  } catch (error: any) {
    console.error("[Revision] Error:", error.message);
    return NextResponse.json(
      {
        error: error.message || "An error occurred while processing the video",
      },
      { status: 500 },
    );
  } finally {
    if (videoPath) {
      try {
        cleanupVideo(videoPath);
      } catch {}
    }
    if (subtitlePath) {
      try {
        fs.unlinkSync(subtitlePath);
      } catch {}
    }
  }
}
