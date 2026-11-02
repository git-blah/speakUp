"use client";

import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { faceSample, type FaceSample } from "./faceAnalysis";

/** Google's hosted model (~4 MB, cached by the browser). Override to self-host. */
const MODEL_URL =
  process.env.NEXT_PUBLIC_FACE_MODEL_URL ||
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
/** Served from public/, copied there from node_modules by scripts/copy-mediapipe-wasm.mjs. */
const WASM_PATH = "/mediapipe/wasm";

let loading: Promise<FaceLandmarker> | null = null;
let lastTimestamp = 0;

/** Load the face landmarker once (lazily, so the ~10 MB runtime only downloads when used). */
export function loadFaceTracker(): Promise<FaceLandmarker> {
  loading ??= (async () => {
    const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const create = (delegate: "GPU" | "CPU") =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
    try {
      return await create("GPU");
    } catch {
      return await create("CPU"); // no WebGL2 / GPU blocked
    }
  })().catch((err) => {
    loading = null; // allow a retry next session
    throw err;
  });
  return loading;
}

/** Detect the face in the current video frame. Returns null if the frame isn't ready. */
export function detectFace(landmarker: FaceLandmarker, video: HTMLVideoElement, t: number): FaceSample | null {
  if (video.readyState < 2 || video.videoWidth === 0) return null;
  // MediaPipe requires strictly increasing timestamps across every call on this landmarker.
  lastTimestamp = Math.max(performance.now(), lastTimestamp + 1);
  try {
    return faceSample(landmarker.detectForVideo(video, lastTimestamp), t);
  } catch {
    return null;
  }
}
