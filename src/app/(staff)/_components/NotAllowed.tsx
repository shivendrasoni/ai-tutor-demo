import styles from '../staff.module.css';

export default function NotAllowed() {
  return (
    <>
      <h1 className={styles.title}>Not allowed</h1>
      <p className={styles.lead}>Your account does not have access to this page.</p>
    </>
  );
}
