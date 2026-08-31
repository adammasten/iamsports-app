amSports Background Upload Architecture Review — Updated for 15 GB Falcon Files

Yes. A routine ~15 GB Falcon file changes the engineering target, but it does not make me abandon the S3-multipart + background URLSession design. In fact, it makes the case for multipart stronger.

My updated verdict is: keep the architecture, but change several assumptions before you sign it off. The two things I would elevate to red-alert status are the 24-hour Supabase multipart lifetime and iPhone local-disk usage while staging background upload parts.

1. For 15 GB, the architecture is still the right one

Supabase explicitly supports S3 multipart uploads for large objects, and its current Storage docs put paid-plan file limits far above 15 GB. Multipart uploads are automatically aborted after 24 hours.

A 15 GB file changes your task counts substantially:

Part size

~Parts for 15 GB

64 MiB

~240

128 MiB

~120

256 MiB

~60

512 MiB

~30

I would not panic about 120 background tasks. Apple specifically recommends starting many tasks while foregrounded rather than waking repeatedly to schedule one new task at a time, and it warns about designs involving thousands of tasks, not dozens or low hundreds.

I would keep 128 MiB as the initial baseline, test 256 MiB aggressively, and probably settle somewhere in that range. On flaky Wi-Fi, 512 MiB starts giving you an unpleasant retry penalty when a part dies at 95%.

2. The 24-hour limit just became a real product constraint

This matters much more at 15 GB.

Ignoring overhead, uploading 15 GB takes approximately:

1 Mbps: 33.3 hours

2 Mbps: 16.7 hours

5 Mbps: 6.7 hours

10 Mbps: 3.3 hours

20 Mbps: 1.7 hours

So if a tournament gym gives someone an effective upload rate around 1 Mbps, your perfect native implementation still loses. Supabase will abort the multipart upload at 24 hours.

I'd therefore add a preflight network estimate. Not as a blocker, but something like:

“15.1 GB • estimated upload 7–9 hours at current speed.”

If the estimate starts approaching perhaps 18 hours, warn the coach that the current connection may not finish inside the server's upload window.

That should absolutely be part of Phase 0b testing now.

3. Potentially bigger iOS problem: disk space

Apple says that when a background URLSession uploads from a file, iOS copies that file to a temporary location and uploads from the copy. Background uploads must be file-based; streams/data don't survive the app exiting.

Your current design also says:

Native slices the source into file-backed parts.

With a 15 GB master, naïvely implemented you could temporarily have:

15 GB original + ~15 GB of your part files + potentially ~15 GB of URLSession's temporary copies.

That is potentially ~45 GB of local disk footprint.

I would put this near the top of the engineering investigation. It may be completely manageable once you understand exactly when Apple's temporary copy occurs and when your staging file can safely be removed, but do not ship under the assumption that 15 GB only consumes 15 GB of local storage.

This is probably the biggest new issue created by the Falcon files.

4. Presigned URLs are still good, but the expiration policy needs tightening

Supabase supports AWS Signature V4 query-string presigning. Generic SigV4 allows an expiration as long as seven days, but that doesn't buy you anything here because Supabase destroys the multipart upload after 24 hours.

I would make the multipart creation timestamp the master clock.

Presign the part URLs for roughly the life of that multipart upload. If a URL fails because it expired, the server can presign a fresh URL for the same uploadId + partNumber as long as the multipart upload itself still exists.

Re-uploading the same S3 part number replaces the previous version, which makes retries nicely idempotent.

One important nuance: treat ETags as opaque values, not hashes. Do not assume multipart ETags are MD5s.

5. Slightly change the ListParts philosophy

Your server reconciliation idea is good, particularly after crashes or force-quits.

Supabase implements ListParts, UploadPart, CompleteMultipartUpload, and the rest of the multipart lifecycle.

But AWS documentation recommends that applications retain the ETag returned from every successful UploadPart rather than using ListParts alone to construct the final completion request.

So I'd make it:

native persisted ETags = normal completion source

server ListParts = reconciliation/recovery/verification source

And before CompleteMultipartUpload:

expected part count == persisted/recovered part count == ListParts part count

plus verify the expected size of every part, especially the final part.

At 15 GB and 128/256 MiB parts you're nowhere near the 1,000-part ListParts pagination boundary, but I'd implement pagination correctly anyway.

6. Background URLSession: mostly yes

Your configuration is basically right.

A background session transfers using a separate system process and can continue when the app is suspended or terminated by iOS.

A few refinements:

waitsForConnectivity=true is effectively redundant for a background session. Apple says background sessions always wait for connectivity.

Keep one stable background session rather than creating sessions per video. Apple recommends a small number of background sessions.

I'd start with 3 simultaneous parts. Apple's default maximum connections per host is six, but the OS can use fewer than the value you request anyway.

Make sure your task metadata includes something like:

localUploadId | multipartUploadId | partNumber | byteStart | byteLength

Persist it before calling resume().

7. Important wording change around force-quit

Your brief currently asks for uploads that “survive force-quit.”

I'd change that language.

Apple explicitly says that if the user kills the app from the multitasking screen, iOS cancels the background transfers and does not automatically relaunch the app.

So you can promise:

App switch: continues

Screen lock: continues

iOS suspends app: continues

iOS terminates app normally: background transfer can continue

User swipes IamSports away: stops, then resumes/reconciles when IamSports is reopened

That's the actual physics of the platform.

8. There is one simpler Expo experiment worth running before committing fully to the native module

Expo SDK 54's legacy expo-file-system already exposes a background iOS upload session, including binary-body uploads, and says the native upload continues when the app moves into the background.

So I would run a quick spike:

presigned UploadPart URL + 128 MiB file + Expo FileSystem background binary PUT

and test lock/app-switch.

However, I would not immediately replace your custom native module with it. Expo's abstraction does not give you the same durable, explicit control over native task restoration, identifiers, getAllTasks(), app relaunch handling, and ETag reconciliation that you're designing.

For an ordinary 500 MB photo/video uploader, Expo's wrapper might be enough.

For routine 15 GB uploads that are core to the product, I like owning that native state machine.

9. Android still looks correct

Your Android plan lines up well with Google's current recommendation.

For long, user-started uploads on Android 14+, Google recommends User-Initiated Data Transfer jobs. For older versions, Google's compatibility guidance falls back to a WorkManager foreground implementation.

So no objection there.

And Android should actually be easier than iOS in one respect: you can implement a native request body that reads a specific byte range directly from the source file, so you may not need the same pile of physical 128/256 MiB staging files.

What I would change in the brief now

Don't call this a 2–5 GB upload system anymore.

I would set the engineering requirement to:

Typical uploads: 2–15 GB. Falcon game footage will routinely be approximately 10–15 GB. Architecture and lifecycle testing must support at least 20 GB without changing video quality.

And Phase 0b should use a real ~15 GB Falcon file, not a synthetic 3 GB test.

My go/no-go tests would now specifically include:

15 GB upload

screen lock

app switch

Wi-Fi loss

Wi-Fi → cellular

several hours backgrounded

system termination

explicit force-quit / relaunch

low disk space

1–2 Mbps throttled upload

If that passes, you've got something much closer to a production-grade sports-film uploader rather than a demo wearing a hard hat.

Bottom line

The architecture is still the one I'd pursue.

The 15 GB revelation does not send me back to TUS. It makes me focus intensely on the 24-hour deadline and iOS disk staging.