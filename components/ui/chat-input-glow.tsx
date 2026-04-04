export function ChatInputGlow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -inset-x-6 -inset-y-5"
    >
      {/* Amber layer — starts visible, fades out at 50% */}
      <div
        className="absolute inset-0 animate-glow-amber"
        style={{
          background:
            "radial-gradient(ellipse 90% 85% at 50% 50%, hsl(38 92% 50% / var(--glow-opacity)), transparent 68%)",
          filter: "blur(18px)",
        }}
      />
      {/* Yellow layer — starts invisible, fades in at 50% */}
      <div
        className="absolute inset-0 animate-glow-yellow"
        style={{
          background:
            "radial-gradient(ellipse 90% 85% at 50% 50%, hsl(54 98% 65% / var(--glow-opacity)), transparent 68%)",
          filter: "blur(18px)",
        }}
      />
    </div>
  );
}
