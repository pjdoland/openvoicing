// Minimal inline icons (currentColor). Always paired with a text/aria label.
import type { ReactNode } from "react";

const wrap = (children: ReactNode) => (
  <svg
    className="icon"
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const PlayIcon = () => wrap(<polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />);
export const PauseIcon = () => wrap(<><rect x="6" y="5" width="4" height="14" fill="currentColor" stroke="none" /><rect x="14" y="5" width="4" height="14" fill="currentColor" stroke="none" /></>);
export const StopIcon = () => wrap(<rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none" />);
export const RecordIcon = () => wrap(<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />);
export const LoopIcon = () => wrap(<><polyline points="17 2 21 6 17 10" /><path d="M3 12V9a4 4 0 0 1 4-4h14" /><polyline points="7 22 3 18 7 14" /><path d="M21 12v3a4 4 0 0 1-4 4H3" /></>);
export const MetronomeIcon = () => wrap(<><path d="M8 21h8l-2-16h-4L8 21Z" /><line x1="12" y1="13" x2="17" y2="7" /></>);
export const FileIcon = () => wrap(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>);
export const ViewIcon = () => wrap(<><circle cx="12" cy="12" r="3" /><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /></>);
export const ShareIcon = () => wrap(<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" /></>);
export const HelpIcon = () => wrap(<><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12" y2="17" /></>);
export const BookmarkIcon = () => wrap(<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />);
export const ExportIcon = () => wrap(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>);
export const NavigateIcon = () => wrap(<><circle cx="12" cy="12" r="10" /><polygon points="16 8 10 10 8 16 14 14 16 8" fill="currentColor" stroke="none" /></>);
export const TrashIcon = () => wrap(<><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></>);
