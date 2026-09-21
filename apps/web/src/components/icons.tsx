const ICON = { className: 'ic', viewBox: '0 0 24 24', 'aria-hidden': true } as const

export const DeviceIcon = () => (
  <svg {...ICON}><rect x="3" y="7" width="18" height="11" rx="2" /><path d="M7 11h.01M11 11h.01M15 11h.01M7 14h10" /></svg>
)
export const LightingIcon = () => (
  <svg {...ICON}><path d="M12 3v2M4.9 6.9l1.4 1.4M3 13h2M19 13h2M17.7 8.3l1.4-1.4" /><path d="M8 17a5 5 0 1 1 8 0v2H8z" /><path d="M10 21h4" /></svg>
)
export const KeysIcon = () => (
  <svg {...ICON}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h2M11 10h2M15 10h2M7 14h10" /></svg>
)
export const MacrosIcon = () => (
  <svg {...ICON}><path d="M5 7h14M5 12h9M5 17h11" /><circle cx="19" cy="17" r="2" /></svg>
)
export const SettingsIcon = () => (
  <svg {...ICON}><path d="M4 7h9M18 7h2M4 17h4M13 17h7" /><circle cx="15.5" cy="7" r="2.5" /><circle cx="10.5" cy="17" r="2.5" /></svg>
)
export const PlugIcon = () => (
  <svg {...ICON}><path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0z" /><path d="M12 16v5" /></svg>
)
export const RadioIcon = () => (
  <svg {...ICON}><circle cx="12" cy="13" r="1.5" /><path d="M8.5 9.5a5 5 0 0 0 0 7M15.5 9.5a5 5 0 0 1 0 7M5.6 6.6a9 9 0 0 0 0 12.8M18.4 6.6a9 9 0 0 1 0 12.8" /></svg>
)
