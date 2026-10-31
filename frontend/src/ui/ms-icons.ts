/** The five Movie settings tab glyphs: inline, currentColor, 22 px. */
const wrap = (body: string): string => `<span class="icon" style="width:22px;height:22px" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg></span>`;

export const MS_TAB_ICONS: Record<'Project' | 'Stage' | 'Timeline' | 'Share' | 'Prefs', string> = {
  Project: wrap('<rect x="3.5" y="9" width="17" height="11" rx="2"/><path d="M3.5 9l2.6-4.6 14 2.4-.9 2.2"/><path d="M8 4.8l2.3 3.9M13.3 5.7l2.3 3.9"/>'),
  Stage: wrap('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M3.5 15h17"/>'),
  Timeline: wrap('<rect x="4" y="5" width="11" height="3.2" rx="1.4"/><rect x="8" y="10.4" width="12" height="3.2" rx="1.4"/><rect x="4" y="15.8" width="8" height="3.2" rx="1.4"/>'),
  Share: wrap('<path d="M12 15V4M8.2 7.6L12 3.8l3.8 3.8"/><path d="M7 11H6a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2h-1"/>'),
  Prefs: wrap('<path d="M4 8h9M17 8h3M4 16h3M11 16h9"/><circle cx="15" cy="8" r="2.2"/><circle cx="9" cy="16" r="2.2"/>'),
};
