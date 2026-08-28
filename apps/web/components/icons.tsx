/**
 * The handful of glyphs that carry meaning rather than decoration.
 *
 * These were emoji. Emoji render from whatever font the device happens to
 * ship — they change size, colour and shape between platforms, and they cannot
 * be tinted by a theme token, which is exactly what the sound and leave
 * controls need to do now that the palette moves.
 *
 * Single stroke width, single 24-unit box, colour inherited via currentColor.
 */

type IconProps = { size?: number };

function Svg({ size = 20, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function SoundOnIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </Svg>
  );
}

export function SoundOffIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="m16 9 5 6" />
      <path d="m21 9-5 6" />
    </Svg>
  );
}

export function LeaveIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h8" />
      <path d="m17 8 4 4-4 4" />
      <path d="M21 12H10" />
    </Svg>
  );
}
