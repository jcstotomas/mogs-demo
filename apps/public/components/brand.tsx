export function BrandMark({ small = false }: { small?: boolean }) {
  return <svg className={small ? 'brand-mark small' : 'brand-mark'} viewBox="0 0 36 36" fill="none" aria-hidden="true">
    <rect width="36" height="36" rx="11" fill="currentColor" />
    <path d="M9 25V12h4l5 7 5-7h4v13h-4v-7l-5 7-5-7v7H9Z" fill="var(--color-canvas)" />
  </svg>;
}

export function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg className="arrow-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d={diagonal ? 'M5 15 15 5M5 5h10v10' : 'M3 10h13m-5-5 5 5-5 5'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

export function CalendarArt() {
  return <div className="calendar-art" aria-hidden="true">
    <div className="art-toolbar"><span /><span /><span /></div>
    <div className="art-grid">
      <i className="art-event event-one" /><i className="art-event event-two" /><i className="art-event event-three" />
      <i className="art-event event-four" /><i className="art-event event-five" />
    </div>
    <div className="art-check"><svg viewBox="0 0 24 24" fill="none"><path d="m6 12 4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
  </div>;
}
