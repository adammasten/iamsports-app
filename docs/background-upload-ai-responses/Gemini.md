Your core architecture—abandoning TUS for Presigned-S3-Multipart over a background URLSession—is 100% the correct pivot for iOS background uploads. TUS is fundamentally incompatible with iOS backgrounding because iOS aggressively limits the execution time needed to orchestrate sequential chunks.

However, the leap from a 5 GB max to a 15 GB file introduces a catastrophic failure mode in your current plan. Here is the pressure-test of your architecture, centered around that massive new constraint.

1. The 15 GB Elephant: The Disk Space Bomb
Your current flow states: "Native slices the source into file-backed parts, enqueues all part PUTs on the background session while foregrounded."

The missing failure mode: iOS background URLSession uploads strictly require a file:// URL payload (you cannot stream from memory or read byte ranges from a source file on the fly in the background). If you slice a 15 GB file into 120 x 128 MiB physical files upfront to enqueue them all, you just consumed an additional 15 GB of device storage.
Users on 64 GB or 128 GB iPhones will instantly hit out-of-storage errors, and the OS will kill the app or the upload will fail.

The Fix: A Rolling Slice Window
Do not slice the whole file upfront. Instead, manage a sliding window of active parts:

Slice only the first 3 parts (consuming ~384 MB total), enqueue them, and save their references in SQLite.

When a part finishes, iOS wakes your app in the background via urlSession(_:task:didCompleteWithError:).

In that brief background execution window, delete the temporary file for the finished part, slice the next part from the original 15 GB file, and enqueue it.

Why this avoids the rate-limit trap: iOS penalizes apps that wake up to schedule rapid-fire tasks (which is why 6 MB TUS chunks fail—they finish in seconds). A 128 MiB part on flaky gym wifi will take minutes to upload. Waking up every few minutes to schedule a single task keeps you well under the background execution watchdog limits.

2. Supabase S3-Compat & Presign Specifics
Expiry vs. 24h Window: When generating presigned URLs in your Edge Function, give them an expiry of 24 hours. Supabase uses AWS S3 compatible APIs under the hood, and service-role generated URLs can easily live that long. If a user pauses or disconnects for 25 hours, the URL will throw a 403 Forbidden. Your native module must catch the 403, consider it a non-fatal error, and request a fresh presigned URL for that specific part from the Edge Function upon relaunch.

ListParts is King: Your plan to use ListParts as the authoritative source of truth is bulletproof. Do not rely solely on locally captured ETags. Local SQLite gets out of sync with reality (e.g., app crashes after the background session completes a task but before your delegate fires). On app launch, always reconcile: ListParts from Server ∩ getAllTasks() from URLSession. If the server has the part, it's done.

Part-size sweet spot: For 15 GB, stick to 128 MiB (giving you ~120 parts).

Going to 256 MiB increases the penalty of a dropped connection on bad wifi (you lose a lot of upload time).

Going below 64 MiB increases the part count and background wake-ups, risking OS throttling.

3. Background URLSession Pitfalls
Concurrency Caps: Do not blast the network. Set httpMaximumConnectionsPerHost = 2 (or 3 max) on your URLSessionConfiguration. Gym wifi is notorious for aggressive bandwidth throttling per connection; 2 concurrent streams will saturate the pipe better than 1, but 5 will just cause timeouts across the board.

handleEventsForBackgroundURLSession: This is the most notorious iOS trap. When iOS launches your app in the background to handle completed tasks, you must store the completionHandler provided by the AppDelegate, process the URLSession events, and then explicitly call that handler on the main thread so iOS knows you are done. Failure to call it will result in the OS suspending your app and eventually punishing it by delaying future background tasks.

Force-Quit Reality: You are correct that a user force-quiting via the App Switcher cancels background sessions. Your plan to rely on native SQLite to remember the upload plan and resume upon the next manual app launch is the exact right UX here.

4. Is there a simpler path? (Libraries, etc.)
No. For 15 GB files with strict "no quality trade-off" constraints and robust background survival, there is no off-the-shelf React Native library that handles this perfectly.

expo-file-system handles simple background uploads but cannot orchestrate complex multipart S3 logic or chunking.

Older libraries like react-native-background-upload are unmaintained and will buckle under 15 GB file handling.
Building a focused, single-purpose Native Module in Swift/Kotlin is the necessary tax for a product whose core value proposition is massive video uploads.

5. Android Sanity Check
Your plan for Android is spot on: Android 14 User-Initiated Data Transfer Jobs (with WorkManager / Foreground Service fallback).

Bonus for Android: Android is much more flexible than iOS. Because you will run a Foreground Service (which shows a persistent notification), you have essentially unbounded execution time as long as the service is running.

You don't even need to write temporary physical slices to disk on Android. You can read a byte range directly from the original Uri using an InputStream and pipe it straight into the HTTP request body. This completely bypasses the disk space issue you face on iOS.

Summary Verdict
Your architecture is exceptionally well-thought-out and natively respects your strict product boundaries (no storage leaks, no quality loss, web stays intact).

The only necessary pivot: Do not slice 15 GB of files upfront on iOS. Implement the rolling slice window to protect device storage.

If you want me to review the mobile upload loop or the Edge Function skeleton to spot-check for edge cases, feel free to drop the code.