import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconFrame({
  children,
  ...props
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      viewBox="0 0 24 24"
      {...props}
    >
      {children}
    </svg>
  );
}

const strokeProps = {
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 1.8,
};

export function FeedIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M4 5.5h16M4 12h16M4 18.5h10" {...strokeProps} />
    </IconFrame>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" {...strokeProps} />
      <path d="m15.5 15.5 5 5" {...strokeProps} />
    </IconFrame>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M4 4h7l9 9-7 7-9-9V4Z" {...strokeProps} />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
    </IconFrame>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" {...strokeProps} />
      <path d="M8 3v4M16 3v4M3.5 10h17" {...strokeProps} />
    </IconFrame>
  );
}

export function ProfileIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="8" r="4" {...strokeProps} />
      <path d="M4.5 20c.8-4 3.3-6 7.5-6s6.7 2 7.5 6" {...strokeProps} />
    </IconFrame>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="M4 7h16M9 3.5h6l1 3.5M6.5 7l.8 13h9.4l.8-13M10 11v5M14 11v5"
        {...strokeProps}
      />
    </IconFrame>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="12" r="3" {...strokeProps} />
      <path
        d="M19 14.5l1.2 1.4-2.3 2.3-1.4-1.2a7 7 0 0 1-2 .8L14.2 20h-4.4l-.3-2.2a7 7 0 0 1-2-.8l-1.4 1.2-2.3-2.3L5 14.5a7 7 0 0 1-.8-2L2 12.2V8.8l2.2-.3a7 7 0 0 1 .8-2L3.8 5.1l2.3-2.3L7.5 4a7 7 0 0 1 2-.8L9.8 1h4.4l.3 2.2a7 7 0 0 1 2 .8l1.4-1.2 2.3 2.3L19 6.5a7 7 0 0 1 .8 2l2.2.3v3.4l-2.2.3a7 7 0 0 1-.8 2Z"
        {...strokeProps}
      />
    </IconFrame>
  );
}

export function InsightsIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"
        {...strokeProps}
      />
      <circle cx="12" cy="12" r="3.5" {...strokeProps} />
    </IconFrame>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M4 5.5h16v11H9l-5 4v-15Z" {...strokeProps} />
      <path d="M8 10h8M8 13h5" {...strokeProps} />
    </IconFrame>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="12" r="9.5" {...strokeProps} />
      <path d="M12 8v8M8 12h8" {...strokeProps} />
    </IconFrame>
  );
}

export function CameraIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="M4.5 7.5h3l1.5-2h6l1.5 2h3a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2Z"
        {...strokeProps}
      />
      <circle cx="12" cy="13.5" r="3.5" {...strokeProps} />
    </IconFrame>
  );
}

export function MicrophoneIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="9" y="3" width="6" height="12" rx="3" {...strokeProps} />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" {...strokeProps} />
    </IconFrame>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m3 11 18-8-8 18-2-8-8-2Z" {...strokeProps} />
      <path d="m11 13 5-5" {...strokeProps} />
    </IconFrame>
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" {...strokeProps} />
      <circle cx="8.5" cy="9" r="1.5" {...strokeProps} />
      <path d="m4 17 5-5 3.5 3.5 2.5-2.5 5 5" {...strokeProps} />
    </IconFrame>
  );
}

export function VideoIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="3" y="6" width="13" height="12" rx="2.5" {...strokeProps} />
      <path d="m16 10 5-3v10l-5-3" {...strokeProps} />
    </IconFrame>
  );
}

export function LocationIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="M12 22s7-6.2 7-13a7 7 0 1 0-14 0c0 6.8 7 13 7 13Z"
        {...strokeProps}
      />
      <circle cx="12" cy="9" r="2.5" {...strokeProps} />
    </IconFrame>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="5" y="10" width="14" height="11" rx="2.5" {...strokeProps} />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" {...strokeProps} />
    </IconFrame>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="12" r="9" {...strokeProps} />
      <path d="M12 7v5l3 2" {...strokeProps} />
    </IconFrame>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m9 5 7 7-7 7" {...strokeProps} />
    </IconFrame>
  );
}
