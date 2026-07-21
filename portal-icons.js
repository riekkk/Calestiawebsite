/* ==========================================================================
   Calestia Travel & Tours — Portal icon set
   ==========================================================================
   Small shared set of lucide-style (stroke, 24x24, currentColor) icon paths,
   used by client-portal.js / staff-shared.js / employee-portal.js /
   admin-portal.js so the same icon looks identical everywhere instead of
   being redefined per file. Call PSIcon('key', 18) to get an <svg> string.
   ========================================================================== */
window.PS_ICON_PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  'file-text': '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6M9 9h1"/>',
  'folder-open': '<path d="M6 14 3.6 5.2A1.5 1.5 0 0 1 5 3.2h4.6a2 2 0 0 1 1.6.8l1.2 1.6a2 2 0 0 0 1.6.8H19a2 2 0 0 1 2 2v.6"/><path d="M2.5 9h17.7a2 2 0 0 1 1.9 2.6l-1.8 6a2 2 0 0 1-1.9 1.4H4.5a2 2 0 0 1-2-1.7Z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  star: '<path d="M11.5 2.6a.55.55 0 0 1 1 0l2.6 5.3 5.8.9c.5.07.7.7.35 1.06l-4.2 4.1 1 5.8a.55.55 0 0 1-.8.58l-5.2-2.7-5.2 2.7a.55.55 0 0 1-.8-.58l1-5.8-4.2-4.1a.55.55 0 0 1 .35-1.06l5.8-.9Z"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/>',
  upload: '<path d="M12 20V8"/><path d="m7 13 5-5 5 5"/><path d="M4 20h16"/>',
  'message-square': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  'sticky-note': '<path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11.2a2 2 0 0 0 1.4-.6l3.8-3.8a2 2 0 0 0 .6-1.4V5a2 2 0 0 0-2-2Z"/><path d="M15 21v-5a1 1 0 0 1 1-1h5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.32.44.55 1.51.55Z"/>',
  shield: '<path d="M12 2 4 5v6c0 5.5 3.4 9.7 8 11 4.6-1.3 8-5.5 8-11V5Z"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3"/><path d="M9 12h6M9 16h6M9 8h1"/>',
  'bar-chart': '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/>',
  'user-plus': '<path d="M14 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="7.5" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  'check-circle': '<circle cx="12" cy="12" r="10"/><path d="m8.5 12.5 2.5 2.5 5-5"/>',
  'x-circle': '<circle cx="12" cy="12" r="10"/><path d="m9 9 6 6M15 9l-6 6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  'alert-triangle': '<path d="M10.3 3.9 1.8 18a1.7 1.7 0 0 0 1.5 2.6h17.4a1.7 1.7 0 0 0 1.5-2.6L13.7 3.9a1.7 1.7 0 0 0-3 0Z"/><path d="M12 9v4M12 17h.01"/>',
  'alert-circle': '<circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 8.9 6.2a3 3 0 0 0 3.4 0L22 7"/>',
  phone: '<path d="M14.05 4a5 5 0 0 1 4 4M14.05 1a8 8 0 0 1 7 6.95M20.9 17.4v2.3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.6 2 2 0 0 1 2-2.2h2.3a2 2 0 0 1 2 1.7c.13.9.36 1.8.7 2.7a2 2 0 0 1-.45 2.1L6.1 9.9a16 16 0 0 0 6 6l1.6-1.5a2 2 0 0 1 2.1-.4c.85.33 1.75.56 2.7.7a2 2 0 0 1 1.7 2Z"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.3 6.4L3 16M3 12a9 9 0 0 1 15.3-6.4L21 8"/><path d="M3 21v-5h5M16 3h5v5"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  'user-check': '<path d="M14 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="7.5" cy="7" r="4"/><path d="m16 11 2 2 4-4"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.5"/>',
  'map-pin': '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  lock: '<rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'arrow-left': '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5Z"/>',
  'more-horizontal': '<circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/>',
  'trending-up': '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  'credit-card': '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>'
};

/**
 * Returns an inline <svg> string for the given icon key. size in px.
 * extraAttrs: optional string of extra attributes (e.g. 'class="foo"').
 */
window.PSIcon = function (key, size, extraAttrs) {
  var d = window.PS_ICON_PATHS[key] || '';
  size = size || 18;
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' + (extraAttrs || '') + '>' + d + '</svg>';
};
