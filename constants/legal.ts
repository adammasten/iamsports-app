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
export const TERMS_URL = 'https://iamsports.com/terms'; // live on the .com (Vercel)
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

export const PRIVACY_EFFECTIVE = 'August 26, 2026';

// Privacy Policy — shown in app/privacy.tsx, linked from the landing footer + the
// Account screen. Same content as the public /privacy page. NOT LEGAL ADVICE; have
// a lawyer review before public launch (esp. the minors + AI-training sections).
export const PRIVACY: TermsSection[] = [
  {
    heading: 'The short version',
    body: `You are an adult (a coach, parent, or guardian). You upload sports video and tag moments in it. We store that video securely and show it only to the people you share it with. We may use tagged video to improve and train the AI features that power the app. You can delete your content and your account at any time.`,
  },
  {
    heading: '1. Who can use IamSports',
    body: `IamSports is intended for adults aged 18 or older — coaches, parents, and guardians. Accounts must be created and controlled by an adult. IamSports is not directed to children, and children may not create accounts or use the service directly.`,
  },
  {
    heading: '2. Video of minors, and your responsibility',
    body: `Because IamSports is a youth-sports product, the video you upload will often depict minors. When you upload video, you represent that you are an adult with authority to record, upload, and share that footage; that you have the right and any necessary consent to upload video depicting the minors shown in it; and that you will only share it with people who have a legitimate reason to see it. By default your uploads are private to you until you choose to share them.`,
  },
  {
    heading: '3. Information we collect',
    body: `Account information (your name and email, to create and secure your account); content you upload (video files, tags, clips, highlights, team and player information, notes, and comments); and basic usage information needed to operate the app and fix problems. We do not sell your personal information.`,
  },
  {
    heading: '4. How we use your information',
    body: `To provide the core service — storing, organizing, playing back, and sharing your video and tags; to secure your account and enforce who can access what; to operate and improve the app, diagnose problems, and build new features; and to communicate with you about your account and the service.`,
  },
  {
    heading: '5. AI features and training',
    body: `A core part of IamSports is helping coaches and parents tag and analyze film. The moments you tag — for example, marking a made shot, a steal, or an assist — may be used to develop, train, and improve the artificial-intelligence features that power the app, including automated tagging and analysis. Future versions of the app will offer clearer per-account controls over whether your content contributes to AI training.`,
  },
  {
    heading: '6. How we share information',
    body: `We share your content only as you direct — with the people and teams you choose inside the app. We also use trusted service providers (for example, cloud hosting and video processing) that process data on our behalf and may not use it for their own purposes. We may disclose information if required by law.`,
  },
  {
    heading: '7. Text message (SMS) alerts',
    body: `If you choose to receive text alerts, IamSports collects your mobile phone number to send you your team's schedule and logistics messages — for example, when a game or practice is added, moved, or canceled, plus occasional reminders (such as a snack sign-up). You opt in inside the app: you enter your number and actively check a consent box, and we then send a one-time code to verify the number. Only verified, opted-in numbers ever receive texts, and we collect consent only from the person who owns the number.

Message frequency varies (roughly 2–6 messages per family per month). Message and data rates may apply. Reply STOP to any message to unsubscribe, or HELP for help.

We do not sell, rent, or share your mobile phone number or your SMS opt-in information with third parties or affiliates for their own marketing or promotional purposes. Your mobile opt-in data and consent are never shared with any third party. We share your number only with the messaging provider that delivers these texts on our behalf, and solely to send the messages you asked for. You can turn off text alerts at any time by replying STOP or by removing your number in the app.`,
  },
  {
    heading: '8. How we protect your information',
    body: `Your uploaded video is stored privately and is accessible only to your account and the people you share it with. We use access controls at the database level so users cannot see content that does not belong to them or that has not been shared with them. No system is perfectly secure, but protecting your family's video is a priority we take seriously.`,
  },
  {
    heading: '9. Your choices and your rights',
    body: `You can delete videos, clips, and other content you've created at any time. You can delete your account, which removes your associated data. You can contact us with questions about the data we hold about you.`,
  },
  {
    heading: '10. Data retention',
    body: `We keep your content for as long as your account is active or as needed to provide the service. When you delete content or your account, we remove the associated data, subject to reasonable backup and legal-retention periods.`,
  },
  {
    heading: '11. Changes to this policy',
    body: `We'll update this policy as IamSports grows, especially as we move from limited pre-launch to general availability. When we make material changes, we'll take reasonable steps to let you know.`,
  },
  {
    heading: '12. Contact',
    body: `Questions about this policy or your data: ${SUPPORT_EMAIL}.`,
  },
];
