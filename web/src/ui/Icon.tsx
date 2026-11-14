// Icon paths ported from prototypes/app.html (authored strokes, 24 grid).
const IP: Record<string, string> = {
  search:'<circle cx="11" cy="11" r="7.5"/><path d="m20.5 20.5-4.2-4.2"/>',
  ask:'<path d="M20.5 14.5a2 2 0 0 1-2 2h-11l-4 4V5.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/>',
  memory:'<path d="m12 2.5 9.5 4.75L12 12 2.5 7.25z"/><path d="m2.5 16.75 9.5 4.75 9.5-4.75"/><path d="m2.5 12 9.5 4.75L21.5 12"/>',
  conflict:'<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3"/><path d="M12 9v4M12 17h.01"/>',
  question:'<circle cx="12" cy="12" r="9.5"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  archive:'<rect width="19" height="5" x="2.5" y="3.5" rx="1"/><path d="M4.5 8.5V19a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8.5M10 12.5h4"/>',
  sources:'<ellipse cx="12" cy="5.5" rx="8.5" ry="3"/><path d="M3.5 5.5v13c0 1.66 3.8 3 8.5 3s8.5-1.34 8.5-3v-13"/><path d="M3.5 12c0 1.66 3.8 3 8.5 3s8.5-1.34 8.5-3"/>',
  settings:'<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  audit:'<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7.5V12l3.5 2"/>',
  admin:'<path d="M20.5 4.5h-7M9.5 4.5h-6M20.5 12h-9M7.5 12h-4M20.5 19.5h-5M11.5 19.5h-8M13.5 2.5v4M7.5 10v4M15.5 17.5v4"/>',
  down:'<path d="m6 9 6 6 6-6"/>', right:'<path d="m9 18 6-6-6-6"/>', left:'<path d="m15 18-6-6 6-6"/>', updown:'<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>',
  plus:'<path d="M5 12h14M12 5v14"/>', check:'<path d="M20 6 9 17l-5-5"/>', x:'<path d="M18 6 6 18M6 6l12 12"/>',
  doc:'<path d="M14.5 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7.5z"/><path d="M14 2.5v4a1.5 1.5 0 0 0 1.5 1.5h4M15.5 13h-7M15.5 17h-7M10 9H8.5"/>',
  library:'<path d="m16 6 4 14M12 6v14M8 8v12M4 4v16"/>',
  github:'<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7M18 10.5c0 4-4 4.5-9.6 6.6"/>',
  mail:'<rect width="19" height="15" x="2.5" y="4.5" rx="2"/><path d="m21.5 7.5-8.47 5.4a1.9 1.9 0 0 1-2.06 0L2.5 7.5"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon:'<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  monitor:'<rect width="19" height="13" x="2.5" y="3.5" rx="2"/><path d="M8 21h8M12 16.5V21"/>',
  arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>', arrowl:'<path d="M19 12H5M11 18l-6-6 6-6"/>',
  undo:'<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  pin:'<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  edit:'<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>',
  retire:'<rect width="19" height="5" x="2.5" y="3.5" rx="1"/><path d="M4.5 8.5V19a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8.5M10 12.5h4"/>',
  restore:'<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  refresh:'<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  upload:'<path d="M20.5 15v4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  shield:'<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  org:'<path d="M6 21.5V4.5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v17Z"/><path d="M6 12H4a2 2 0 0 0-2 2v5.5a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-2M10 6.5h4M10 10.5h4M10 14.5h4M10 18.5h4"/>',
  folder:'<path d="M20 19.5a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 4.4a2 2 0 0 0-1.67-.9H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/>',
  link:'<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  more:'<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  send:'<path d="m21.5 2.5-7 19-4-8.5-8.5-4z"/><path d="M21.5 2.5 10.5 13"/>',
  lock:'<rect width="17" height="11" x="3.5" y="10.5" rx="2"/><path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5"/>',
  ok:'<circle cx="12" cy="12" r="9.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  info:'<circle cx="12" cy="12" r="9.5"/><path d="M12 16v-4.5M12 8h.01"/>',
  alert:'<circle cx="12" cy="12" r="9.5"/><path d="M12 7.5V13M12 16.5h.01"/>',
  inbox:'<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  filter:'<path d="M3 6h18M7 12h10M10 18h4"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  changed:'<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/>',
  quote:'<path d="M3 21c3 0 7-1 7-8V5H3v7h4c0 4-2 6-4 6zM14 21c3 0 7-1 7-8V5h-7v7h4c0 4-2 6-4 6z"/>',
  wifioff:'<path d="M12 20h.01M8.5 16.43a5 5 0 0 1 7 0M2 8.82a15 15 0 0 1 4.17-2.65M10.66 5c4.01-.36 8.14.9 11.34 3.76M16.85 11.25a10 10 0 0 1 2.22 1.68M5 13a10 10 0 0 1 5.24-2.76M2 2l20 20"/>',
  play:'<path d="M7 4.5v15l12-7.5z"/>',
  key:'<path d="M2.5 18v3a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.17a2 2 0 0 0 1.42-.59l.81-.81a6.5 6.5 0 1 0-4.17-4.17z"/><circle cx="16.5" cy="7.5" r="1"/>',
  tag:'<path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".6"/>',
  webhook:'<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>',
  mic:'<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M19 10.5a7 7 0 0 1-14 0M12 17.5v4"/>',
  note:'<path d="M4 5.5h16M4 10h16M4 14.5h10M4 19h7"/>',
  ticket:'<path d="M2.5 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h15a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2h-15a2 2 0 0 0-2 2Z"/><path d="M13.5 5v2M13.5 17v2M13.5 11v2"/>',
  copy:'<rect width="13" height="13" x="8.5" y="8.5" rx="2"/><path d="M4.5 15.5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2"/>',
  logo:''
}

export type IconName = keyof typeof IP | (string & {})

/** Stroke icon. `className` takes the prototype modifiers: "sm", "lg", plus any utility classes. */
export function Ic({ n, className = '' }: { n: IconName; className?: string }) {
  return (
    <svg className={`i ${className}`} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: IP[n] || '' }} />
  )
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
      <rect x="2" y="2" width="20" height="20" rx="6" fill="hsl(var(--primary))" />
      <path d="M8.5 9.25h7M8.5 12h7M8.5 14.75h4" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

/** Avatar with initials; without a name it renders the system avatar. */
export function Avatar({ name }: { name?: string | null }) {
  if (!name || name === 'system')
    return (
      <span className="avatar sys" aria-hidden="true">
        <Ic n="settings" className="sm" />
      </span>
    )
  return (
    <span className="avatar" aria-hidden="true">
      {name.trim().charAt(0).toUpperCase()}
    </span>
  )
}

export const SRC_ICON: Record<string, IconName> = {
  documents: 'doc',
  document_library: 'library',
  github: 'github',
  mail: 'mail',
  webhook: 'webhook',
  upload: 'upload',
}
