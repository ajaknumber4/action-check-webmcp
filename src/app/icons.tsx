import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & {
  readonly title?: string;
};

export function CheckIcon({ title, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden={title ? undefined : true} {...props}>
      {title ? <title>{title}</title> : null}
      <path d="m5.5 12.5 4 4 9-10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CrossIcon({ title, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden={title ? undefined : true} {...props}>
      {title ? <title>{title}</title> : null}
      <path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function HourglassIcon({ title, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden={title ? undefined : true} {...props}>
      {title ? <title>{title}</title> : null}
      <path d="M7 3h10M7 21h10M8 3v3.2c0 2 1.3 3.8 4 5.8-2.7 2-4 3.8-4 5.8V21m8-18v3.2c0 2-1.3 3.8-4 5.8 2.7 2 4 3.8 4 5.8V21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlayIcon({ title, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden={title ? undefined : true} {...props}>
      {title ? <title>{title}</title> : null}
      <path d="M8 5.5 18 12 8 18.5Z" fill="currentColor" />
    </svg>
  );
}

export function DownloadIcon({ title, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden={title ? undefined : true} {...props}>
      {title ? <title>{title}</title> : null}
      <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 16v4h14v-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
