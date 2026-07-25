// Legal / safety constants and the in-app Terms (EULA). Single source of truth
// for the Terms screen, the acceptance gate, and the published contact info.
//
// ⚠️ SET A REAL SUPPORT INBOX before submitting — Apple Guideline 1.2 requires
// PUBLISHED, reachable contact info. Swap the placeholder below for a mailbox
// you actually monitor, and host the same Terms text at a public URL (also
// required) — put that URL in TERMS_URL.
//
// ⚠️ NOT LEGAL ADVICE. This is a solid starting draft covering Apple's UGC
// requirements; have a lawyer review it, especially the minors/consent section,
// before public launch.

export const SUPPORT_EMAIL = 'adam.admin@iamsports.com'; // real, monitored inbox (confirmed 2026-07-24)
export const TERMS_URL = 'https://iamsports.app/terms'; // TODO: host the Terms here
export const TERMS_EFFECTIVE = 'July 18, 2026';

// Bump when the Terms change materially — the gate re-prompts everyone whose
// accepted_terms_version is below this.
export const TERMS_VERSION = 1;

export type TermsSection = { heading: string; body: string };

export const TERMS: TermsSection[] = [
  {
    heading: '1. Agreement',
    body: `By creating an account or using IamSports ("the app"), you agree to these Terms. If you do not agree, do not use the app. We may update these Terms; continued use after an update means you accept the change.`,
  },
  {
    heading: '2. Who can use IamSports',
    body: `IamSports is for adults — coaches and parents/guardians who manage and share youth sports film. You must be at least 18. Accounts are for adults; the app is not directed to children, and children do not create accounts.`,
  },
  {
    heading: '3. Your content and the rights you give us',
    body: `You keep ownership of the videos, clips, reels, and other content you upload. You grant IamSports a limited license to store, process, and display that content so the app can work (hosting, tagging, rendering highlight reels, and showing it to the people you share it with).

You are responsible for the content you upload. You represent that you have the right to upload it and that you have obtained any consents required to record and share it — including, where the footage shows minors, the consent of their parent or legal guardian.`,
  },
  {
    heading: '4. Zero tolerance for objectionable content and abuse',
    body: `There is zero tolerance for objectionable content and abusive users. You may not upload, share, or post content that is unlawful, sexually explicit, harassing, hateful, threatening, or otherwise objectionable, and you may not harass, bully, threaten, or abuse other users. Accounts that do so may be removed without notice.`,
  },
  {
    heading: '5. Child safety',
    body: `IamSports strictly prohibits child sexual abuse and exploitation (CSAE) of any kind, including any child sexual abuse material (CSAM). We remove such material when we become aware of it and report apparent CSAE to the National Center for Missing & Exploited Children (NCMEC) and/or law enforcement as required by law.`,
  },
  {
    heading: '6. Reporting, blocking, and moderation',
    body: `You can report content and block other users from inside the app. We review reports and act on them promptly — typically within 24 hours — which may include removing content and suspending or terminating the responsible account. Reporting and blocking are available on shared content throughout the app.`,
  },
  {
    heading: '7. Suspension and termination',
    body: `We may suspend or terminate your access, and remove content, if you violate these Terms or if we reasonably believe it is necessary to protect users or comply with the law.`,
  },
  {
    heading: '8. The app is provided "as is"',
    body: `IamSports is provided "as is," without warranties of any kind. We do not guarantee the app will be uninterrupted or error-free. To the fullest extent permitted by law, IamSports is not liable for indirect, incidental, or consequential damages arising from your use of the app.`,
  },
  {
    heading: '9. Contact',
    body: `Questions, concerns, or reports of objectionable content or behavior: ${SUPPORT_EMAIL}.`,
  },
];
