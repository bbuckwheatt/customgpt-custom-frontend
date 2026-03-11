"use client";

import { MicIcon, MicOffIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: { readonly transcript: string };
}

interface SpeechRecognitionResultList {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  start(): void;
  stop(): void;
}

function isSpeechRecognitionSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
  );
}

function createSpeechRecognition(): SpeechRecognitionInstance | null {
  if (typeof window === "undefined") {
    return null;
  }
  const SR =
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition;
  if (!SR) {
    return null;
  }
  return new SR() as SpeechRecognitionInstance;
}

function PureVoiceButton({
  onTranscript,
  disabled,
}: {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}) {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setSupported(isSpeechRecognitionSupported());
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = createSpeechRecognition();
    if (!recognition) {
      toast.error("Speech recognition is not supported in this browser.");
      return;
    }

    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    let finalTranscript = "";

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      onTranscript(finalTranscript + interim);
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed") {
        toast.error(
          "Microphone access denied. Please allow microphone permissions."
        );
      } else if (event.error !== "aborted") {
        toast.error(`Speech recognition error: ${event.error}`);
      }
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.start();
    setIsListening(true);
  }, [isListening, onTranscript]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  if (!supported) {
    return null;
  }

  return (
    <Button
      aria-label={isListening ? "Stop recording" : "Start voice input"}
      className={cn(
        "size-8 rounded-full transition-colors duration-200",
        isListening
          ? "bg-red-500 text-white hover:bg-red-600 animate-pulse"
          : "bg-muted text-muted-foreground hover:bg-muted/80"
      )}
      disabled={disabled}
      onClick={toggleListening}
      type="button"
      variant="ghost"
    >
      {isListening ? <MicOffIcon size={14} /> : <MicIcon size={14} />}
    </Button>
  );
}

export const VoiceButton = memo(PureVoiceButton);
