Key verdict
Your core premise is sound:

Background URLSession transfers can continue while iOS suspends the app, but uploads need to be file-backed; data/stream uploads do not survive app exit. Apple also explicitly warns against starting one task, waking after it finishes, and scheduling the next—because background scheduling delay increases—while recommending a small number of sessions with multiple tasks launched together. That supports multipart far better than sequential TUS PATCH for this mobile use case.

Supabase’s S3-compatible storage supports query-string SigV4 presigning plus CreateMultipartUpload, UploadPart, ListParts, CompleteMultipartUpload, and AbortMultipartUpload.

Your existing web TUS path can remain untouched. S3 multipart is a mobile transport solution, not a reason to change browser uploads.

The major change for 15 GB
A 15 GB upload means about 112–113 parts at 128 MiB, or about 120 parts if “15 GB” means 15 GiB. That does not invalidate multipart—but it does mean you should not blindly enqueue 120 physical temporary files or rely on one set of presigned URLs for the entire unattended upload.

The essential amendment is to treat these as distinct:

Multipart-upload expiry: your stated 24-hour Supabase incomplete-upload cutoff.

Presigned part-URL expiry: the shorter lifetime of each signed UploadPart URL.

Use an authenticated Edge Function endpoint to refresh presigned URLs for only unfinished part numbers belonging to the existing uploadId. Persist absolute expiry server-side and in native SQLite. A URL expiry should lead to refreshing that part’s URL, not restarting the entire upload; an expired/aborted multipart upload should surface a clear terminal “expired—restart upload” state.

Critical implementation points
Use URLSessionUploadTask from a file URL for each part—not a JS byte buffer, base64 payload, or input stream. Apple documents file-backed upload as the path that survives after the app exits.

Do not eagerly copy a 15 GB source into 120 part files. Use a bounded native producer/consumer disk queue: keep 2–3 active part transfers plus a modest ready buffer, and delete each temporary part only after upload state is durably confirmed.

Persist durable task metadata: upload-attempt ID, multipart upload ID, part number, temporary-file generation/path, ETag, URL-expiry information, and status. Do not rely on URLSessionTask.taskIdentifier as your business identity.

Make server-side ListParts authoritative. Reconcile SQLite ∩ URLSession.getAllTasks() ∩ ListParts; then construct CompleteMultipartUpload on the server from the fresh, ordered ListParts ETags.

Treat an ambiguous completion result—timeout, process death after calling complete, or response loss—as unknown. Reconcile the final object/server state; never assume failure and blindly start a new multipart upload.

Keep source master bytes until server-side HeadObject verifies the final object and the database record has transitioned successfully.

Do not treat a multipart ETag as a portable whole-file MD5. Supabase’s documented S3 compatibility excludes Content-MD5 on relevant operations, so use expected byte count, local file fingerprint where practical, part-size checks, server-side ListParts, and final HeadObject validation instead.

iOS caveat
You can accurately promise that uploads survive app switching, locking, normal suspension, and potentially system termination/relaunch when state/session recreation is implemented correctly. Apple says to recreate the same background session identifier during launch so the system can reassociate background tasks, and to retain the handleEventsForBackgroundURLSession completion handler until urlSessionDidFinishEvents.

Do not promise that uploads continue after a user force-quits from the App Switcher. Frame it as:

“If you force-quit IamSports, iOS cancels the active transfer. Reopen the app to reconcile completed parts and resume missing ones, provided the multipart upload has not expired.”

That is the honest and supportable UX contract.

Part-size starting point
Start production testing at 128 MiB, with 2 active transfers and a small pre-enqueued/ready window. A/B test 64 MiB and 256 MiB under actual hostile tournament-gym Wi-Fi conditions:

Part size	15 GB part count	Primary tradeoff
64 MiB	~224	Better retry granularity; more task overhead
128 MiB	~112	Strong default balance
256 MiB	~56	Fewer tasks; higher retry waste and disk pressure
Choose based on completion-time distribution, retries, retransmitted bytes, scheduler delay, battery/thermal impact, and abandonment—not peak throughput alone.

Android
Your Android plan is sound. Android 14+ User-Initiated Data Transfer jobs are specifically intended for long user-started transfers, start immediately, require a visible notification, permit concurrent jobs, and should persist state for interruption/recovery. Android requires RUN_USER_INITIATED_JOBS; its own guidance recommends using a foreground-service-backed WorkManager implementation on older Android versions because there is no Jetpack UIDT abstraction.

One qualification: a user stopping the Android transfer via Task Manager can terminate the process immediately without onStopJob, so persist state independently and provide an explicit cancel control in the ongoing notification.

Security stays intact
Nothing in this design requires reopening the prior storage read leak:

Multipart presigned URLs grant narrowly scoped write capability for one upload part.

No client GetObject, bucket list, public URL, getPublicUrl, or client-side object verification path is needed.

videos.url should remain an object key, written only after server-side completion and verification.

Playback remains exactly as designed: sign-media service-role entitlement check → short-lived view URL.

Redact presigned URLs from logs, analytics, crash reporting, and persisted diagnostic payloads, because query-string presigns are bearer credentials even though they are write-only in this flow.

The Markdown file includes a full state machine, failure-mode table, security checklist, acceptance criteria, telemetry plan, and 15 GB-specific recommendations.