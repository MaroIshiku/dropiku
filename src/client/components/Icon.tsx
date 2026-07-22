import type { SVGProps } from "react";

const paths = {
  files: "M4 5a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Z",
  inbox: "M4 4h16v14H4V4Zm0 9h4l2 3h4l2-3h4",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5m4-1v5l3 2",
  upload: "M12 16V4m0 0L7 9m5-5 5 5M4 16v4h16v-4",
  download: "M12 4v12m0 0 5-5m-5 5-5-5M4 20h16",
  share: "M10.5 13.5a4.5 4.5 0 0 0 6.4 0l2-2a4.5 4.5 0 0 0-6.4-6.4l-1.1 1.1M13.5 10.5a4.5 4.5 0 0 0-6.4 0l-2 2a4.5 4.5 0 0 0 6.4 6.4l1.1-1.1",
  link: "M10.5 13.5a4.5 4.5 0 0 0 6.4 0l2-2a4.5 4.5 0 0 0-6.4-6.4l-1.1 1.1M13.5 10.5a4.5 4.5 0 0 0-6.4 0l-2 2a4.5 4.5 0 0 0 6.4 6.4l1.1-1.1",
  pin: "M8 3h8l-1 7 3 3H6l3-3-1-7Zm4 10v8",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  search: "m21 21-4.4-4.4m2.4-5.1a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z",
  settings: "M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Zm0-12 1 2.2 2.4.6 1.9-1.4 1.8 1.8-1.4 1.9.6 2.4 2.2 1-2.2 1-.6 2.4 1.4 1.9-1.8 1.8-1.9-1.4-2.4.6-1 2.2-1-2.2-2.4-.6-1.9 1.4-1.8-1.8 1.4-1.9-.6-2.4-2.2-1 2.2-1 .6-2.4-1.4-1.9 1.8-1.8 1.9 1.4 2.4-.6 1-2.2Z",
  close: "M6 6l12 12M18 6 6 18",
  copy: "M8 8h11v11H8V8Zm-3 8V5h11",
  trash: "M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6",
  check: "m5 12 4 4L19 6",
  alert: "M12 9v4m0 4h.01M10.3 3.8 2.2 18h19.6L13.7 3.8a2 2 0 0 0-3.4 0Z",
  qr: "M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm11 0h2v2h-2v-2Zm3 3h2v3h-3v-2h-2v2h-2v-5h2",
  lock: "M6 10h12v11H6V10Zm3 0V7a3 3 0 0 1 6 0v3",
  arrow: "m9 18 6-6-6-6",
  external: "M14 4h6v6m0-6-9 9M19 13v7H4V5h7",
  refresh: "M20 6v5h-5M4 18v-5h5m10-2a7 7 0 0 0-12-4L4 11m16 2-3 4a7 7 0 0 1-12-4",
  logout: "M10 17l5-5-5-5m5 5H3m10-8h7v16h-7",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-11v6m0-10h.01",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]} /></svg>;
}
