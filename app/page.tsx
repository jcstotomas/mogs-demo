import styles from '@/components/campaign-console.module.css';

export const dynamic = 'force-dynamic';

export default function Home() {
  const multichannelEnabled = process.env.MOGS_MULTICHANNEL_ENABLED === '1';
  return <div className={styles.shell}><main className={styles.main}>
    <div className={styles.intro}><p className={styles.eyebrow}>MOGS · Fictional company · Local review tool</p><h1>Keep the launch in step.</h1>
      <p>Check a Starter price change against the original sources. Review corrections, preserve valid exceptions, and follow the website change through a pull request and deployed verification.</p></div>
    <section className={styles.launch} aria-labelledby="review-title"><div><h2 id="review-title">Launch correction review</h2><p className={styles.detail}>The website and paired email templates use complete correction groups. Human approval authorizes inclusion in a pull request; a separate GitHub merge publishes the change.</p>
      {multichannelEnabled ? <p className={styles.detail}>The designed campaign adds email, sales deck, and creative source previews with an agent request and located findings.</p> : null}</div>
      <div className={styles.actions}>{multichannelEnabled ? <a className={styles.primary} href="/console/campaign">Open campaign review</a> : null}<a className={multichannelEnabled ? styles.secondary : styles.primary} href="/console/remote">Open website launch review</a></div></section>
    <p className={styles.detail}><a href="/site/pricing">Local canonical pricing</a> · <a href="/site/launch">Local launch guide</a> · <a href="/console">Local v1 history</a></p>
  </main></div>;
}
