export function StreamMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 5.5h11a4 4 0 0 1 0 8h-6a3.5 3.5 0 0 0 0 7h8" />
      <path d="m17.5 17 3.5 3.5-3.5 3.5" />
      <path d="M5 22v2a4 4 0 0 0 4 4h14a4 4 0 0 0 4-4v-2" />
    </svg>
  );
}
