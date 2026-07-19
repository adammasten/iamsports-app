# IamSports — Safety & Moderation Runbook

Operational process for handling reports and child-safety obligations. This is
what App Store Guideline 1.2 and US law (18 U.S.C. § 2258A, as amended by the
2024 REPORT Act) expect from a UGC app — a **reactive** process. There is **no
legal duty to proactively scan or monitor** content; obligations trigger on
*actual knowledge*.

> ⚠️ Not legal advice. Have a lawyer review this and the Terms before public
> launch, especially the child-safety and minors-consent pieces.

---

## A. Daily moderation (the 24-hour commitment)

Apple expects reported content removed and offending users ejected **within 24
hours**. Practically: check the report queue at least once a day.

**1. Review pending reports** (Supabase → SQL Editor) — child-safety first:

```sql
select id, reason, note, content_type, content_id, created_at, reporter_user_id
from content_reports
where status = 'pending'
order by (reason = 'child_safety') desc, created_at desc;
```

**2. Look at the reported content.** Find the underlying row by `content_type` +
`content_id` (a `reel` → `highlight_reels`, a `game` → `games`, etc.).

**3. If it violates the Terms — take it down** (hides it from every feed
instantly, because all feeds filter `visible = true`):

```sql
update shares set visible = false
where content_type = 'reel' and content_id = '<the id>';

update content_reports set status = 'actioned', reviewed_at = now()
where content_type = 'reel' and content_id = '<the id>' and status = 'pending';
```

**4. If it's fine, dismiss it:**

```sql
update content_reports set status = 'dismissed', reviewed_at = now() where id = '<report id>';
```

**5. Repeat offenders / abusive users** — remove their account (delete the
`auth.users` row via the Supabase dashboard, or the delete-account flow), which
cascades their memberships and anonymises their shared content.

---

## B. Child safety — apparent CSAE / CSAM

If you become **aware** (a report, or you see it) of apparent child sexual abuse
or exploitation, or CSAM:

1. **Do not download, copy, forward, or share it.** Do not investigate beyond
   confirming what was reported.
2. **Hide it from users immediately** — `shares.visible = false` (step A3). But
   **do NOT delete the underlying content or the report row** yet: you must
   **preserve the report data for at least one year** (REPORT Act). Preserve the
   storage object and the DB rows.
3. **Report to NCMEC's CyberTipline** as soon as reasonably possible:
   **report.cybertip.org**. As an app hosting user video you're a covered
   provider — you may need to register as an Electronic Service Provider (ESP)
   with NCMEC (esp.ncmec.org) to file. Do this *before* you need it.
4. **Retain** the CyberTipline report and associated data **≥ 1 year**.
5. **Terminate** the offending account.
6. **Cooperate** with any law-enforcement follow-up. You may also contact law
   enforcement directly.

The REPORT Act (in force since 2024) covers not just CSAM but also **child sex
trafficking and enticement/coercion of a minor** — same process.

---

## C. Published contact (required)

Guideline 1.2 requires published, reachable contact info. It's shown in-app on
the **Account → Help & safety** screen and in the Terms, and must also be in the
App Store listing. Current address: `SUPPORT_EMAIL` in `constants/legal.ts` —
**replace the placeholder with a real, monitored inbox before submitting.**

---

## D. Pre-submission checklist (moderation-related)

- [ ] Real `SUPPORT_EMAIL` set + inbox monitored.
- [ ] Terms hosted at a public URL (`TERMS_URL`) + linked in the listing.
- [ ] `migration_moderation_report_block.sql` applied (reports + blocks).
- [ ] `migration_terms_acceptance.sql` applied (acceptance gate works).
- [ ] Registered with NCMEC ESP (esp.ncmec.org) so a CyberTipline report is
      possible on day one.
- [ ] You've tested: report → hidden + acknowledged; block → content gone;
      takedown SQL → content disappears from all feeds.
