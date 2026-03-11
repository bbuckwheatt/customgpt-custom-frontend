"use client";

import { Volume2Icon, VolumeXIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Action } from "./elements/actions";

function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function PureSpeakButton({ text }: { text: string }) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const handleToggle = useCallback(() => {
    if (!isSpeechSynthesisSupported()) {
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = navigator.language || "en-US";
    utteranceRef.current = utterance;

    utterance.onend = () => {
      setIsSpeaking(false);
      utteranceRef.current = null;
    };

    utterance.onerror = () => {
      setIsSpeaking(false);
      utteranceRef.current = null;
    };

    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
  }, [isSpeaking, text]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (utteranceRef.current) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  if (!isSpeechSynthesisSupported()) {
    return null;
  }

  return (
    <Action
      onClick={handleToggle}
      tooltip={isSpeaking ? "Stop speaking" : "Read aloud"}
    >
      {isSpeaking ? <VolumeXIcon size={14} /> : <Volume2Icon size={14} />}
    </Action>
  );
}

export const SpeakButton = memo(PureSpeakButton);
