export default function Home() {
  return <>
    <a className="skip-link" href="#content">Skip to content</a>
    <main className="content-shell home" id="content">
      <p className="eyebrow">Fictional company · controlled public demo</p>
      <h1>MOGS</h1>
      <p className="lede">Team scheduling content and repository-backed email previews.</p>
      <nav aria-label="Public content" className="home-links">
        <a href="/site/pricing">Canonical pricing</a>
        <a href="/site/launch">Launch guide</a>
        <a href="/assets/email/onboarding">Onboarding email preview</a>
        <a href="/assets/email/eligible">Legacy email preview</a>
      </nav>
    </main>
  </>;
}
