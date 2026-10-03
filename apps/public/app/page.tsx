import { Arrow, BrandMark } from '../components/brand';
import SiteHeader from '../components/site-header';

const days = [
  { day: 'Mon', date: '05', events: [{ title: 'Weekly sync', time: '9:00 – 9:30', people: 'Product team', tone: 'sage' }, { title: 'Focus time', time: '11:00 – 12:30', people: 'Just you', tone: 'cream' }] },
  { day: 'Tue', date: '06', events: [{ title: 'Design review', time: '10:00 – 11:00', people: 'Alex + Jamie', tone: 'lilac' }] },
  { day: 'Wed', date: '07', events: [{ title: 'Coffee & catch-up', time: '9:30 – 10:00', people: 'You + Sam', tone: 'peach' }, { title: 'Planning ahead', time: '2:00 – 3:00', people: 'Product team', tone: 'sage' }] },
  { day: 'Thu', date: '08', events: [{ title: 'A little breathing room', time: 'Your open afternoon', people: '', tone: 'open' }] },
  { day: 'Fri', date: '09', events: [{ title: 'Show & tell', time: '11:00 – 12:00', people: 'Everyone', tone: 'lilac' }] },
];

function WorkspacePreview() {
  return <section className="workspace-wrap" aria-label="Sample team schedule">
    <div className="workspace">
      <aside className="workspace-sidebar" aria-hidden="true">
        <div className="workspace-brand"><BrandMark small />Studio North <span>⌄</span></div>
        <div className="workspace-menu"><span className="selected">▦ <span>My schedule</span></span><span>◷ <span>Team availability</span></span><span>▤ <span>Bookings</span></span></div>
        <p className="sidebar-label">Your team</p>
        <div className="team-person"><i className="avatar sage">AL</i>Alex Lee</div>
        <div className="team-person"><i className="avatar peach">JR</i>Jamie Rivera</div>
        <div className="team-person"><i className="avatar lilac">SK</i>Sam Kim</div>
        <div className="workspace-note"><span className="status-dot" />A little more in sync.</div>
      </aside>
      <div className="workspace-main">
        <div className="workspace-topline"><span>My schedule</span><span className="sample-label">Sample workspace</span></div>
        <div className="workspace-heading"><div><p>A fresh week, a clear view.</p><h2>October 5 – 9</h2></div><span className="week-label">October 2026</span></div>
        <div className="week-grid">
          {days.map(({ day, date, events }) => <div className="day-column" key={day}>
            <div className={`day-heading ${day === 'Mon' ? 'today' : ''}`}><span>{day}</span><strong>{date}</strong></div>
            <div className="day-events">{events.map(event => <div className={`calendar-event ${event.tone}`} key={event.title}><span>{event.time}</span><h3>{event.title}</h3>{event.people && <p>{event.people}</p>}</div>)}</div>
          </div>)}
        </div>
        <div className="workspace-bottom"><span className="status-dot" />A shared view. A calmer week.</div>
      </div>
    </div>
  </section>;
}

export default function Home() {
  return <>
    <a className="skip-link" href="#content">Skip to content</a>
    <SiteHeader />
    <main id="content" className="home" tabIndex={-1}>
      <section className="home-hero">
        <p className="hero-note"><span className="status-dot" />Good work starts with a little space.</p>
        <h1>The week ahead,<br /><span>beautifully in sync.</span></h1>
        <p className="home-lede">A calmer place for your team’s schedules.<br className="desktop-break" /> Bring the day together. Make room for what matters.</p>
        <div className="hero-actions"><a className="button button-primary" href="/site/launch">Explore MOGS <Arrow /></a><a className="button button-secondary" href="/site/pricing">View pricing <Arrow diagonal /></a></div>
        <p className="demo-note">Fictional company. A working launch-correction demo.</p>
      </section>
      <WorkspacePreview />
      <section className="home-story" aria-labelledby="story-title">
        <div className="story-intro"><p className="eyebrow">A little less coordination.</p><h2 id="story-title">A little more<br />room to do good work.</h2></div>
        <div className="story-points"><div><span className="point-number">01</span><h3>See the week together</h3><p>A shared perspective on the people, plans, and time that make up your day.</p></div><div><span className="point-number">02</span><h3>Find your rhythm</h3><p>Make space for working together, catching up, and getting your head down.</p></div><div><span className="point-number">03</span><h3>Keep everyone in the loop</h3><p>Explore the launch guide and the messages that help your team get started.</p></div></div>
      </section>
      <section className="home-destinations" aria-label="Explore MOGS">
        <a className="destination destination-green" href="/site/pricing"><span>Meet your next plan</span><h2>A good fit for<br />your kind of team.</h2><span className="destination-cta">Explore pricing <Arrow /></span></a>
        <a className="destination" href="/assets/email/onboarding"><span>From our inbox to yours</span><h2>A thoughtful<br />first hello.</h2><span className="destination-cta">Preview the welcome email <Arrow /></span></a>
      </section>
    </main>
    <footer className="home-footer"><a className="brand" href="/"><BrandMark small />MOGS</a><p>Fictional team scheduling company.<br />Built for the launch-correction demo.</p><a href="/site/launch">Meet MOGS <Arrow diagonal /></a></footer>
  </>;
}
