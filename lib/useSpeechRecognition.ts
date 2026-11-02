"use client";

import { useCallback, useRef } from "react";
import { wordsFromText, type Transcript } from "./transcript";

// Minimal typings for the Web Speech API (not in every TS DOM lib, and prefixed in Chrome/Safari).
interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechRecognitionSupported(): boolean {
  return getCtor() !== null;
}

const FATAL_ERRORS = new Set(["not-allowed", "service-not-allowed", "network", "language-not-supported"]);
const MAX_RESTARTS = 30;

/**
 * Live transcription in the browser while a take is recorded. Free and needs no setup, but has no
 * word timings and, in Chrome, sends audio to Google's speech service.
 */
export function useSpeechRecognition() {
  const recRef = useRef<Recognition | null>(null);
  const finalRef = useRef<string[]>([]);
  const interimRef = useRef("");
  const startedAtRef = useRef(0);
  const firstAtRef = useRef<number | undefined>(undefined);
  const activeRef = useRef(false);

  const flushInterim = () => {
    const t = interimRef.current.trim();
    if (t) finalRef.current.push(t);
    interimRef.current = "";
  };

  const start = useCallback((lang: string): boolean => {
    const Ctor = getCtor();
    if (!Ctor) return false;
    finalRef.current = [];
    interimRef.current = "";
    firstAtRef.current = undefined;
    startedAtRef.current = Date.now();
    activeRef.current = true;
    let restarts = 0;

    const launch = () => {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = lang;
      rec.onresult = (e) => {
        if (firstAtRef.current === undefined) {
          firstAtRef.current = (Date.now() - startedAtRef.current) / 1000;
        }
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalRef.current.push(r[0].transcript.trim());
          else interim += r[0].transcript;
        }
        interimRef.current = interim;
      };
      rec.onerror = (e) => {
        if (FATAL_ERRORS.has(e.error)) activeRef.current = false;
      };
      // Chrome ends "continuous" sessions after silence; keep restarting until we're stopped.
      rec.onend = () => {
        flushInterim();
        if (activeRef.current && restarts++ < MAX_RESTARTS) {
          try {
            launch();
          } catch {
            activeRef.current = false;
          }
        }
      };
      rec.start();
      recRef.current = rec;
    };

    try {
      launch();
      return true;
    } catch {
      activeRef.current = false;
      return false;
    }
  }, []);

  /** Stop listening and return what was heard (null if recognition never started). */
  const stop = useCallback((): Promise<Transcript | null> => {
    const rec = recRef.current;
    recRef.current = null;
    activeRef.current = false;
    if (!rec) return Promise.resolve(null);

    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        flushInterim();
        const text = finalRef.current.join(" ").replace(/\s+/g, " ").trim();
        resolve({ source: "browser", text, words: wordsFromText(text), timed: false, firstWordAt: firstAtRef.current });
      };
      // Final results arrive just before onend; don't wait forever if it never fires.
      const timeout = setTimeout(finish, 1500);
      rec.onend = () => {
        clearTimeout(timeout);
        finish();
      };
      try {
        rec.stop();
      } catch {
        clearTimeout(timeout);
        finish();
      }
    });
  }, []);

  return { start, stop };
}
