# App Store metadata (draft)

A draft for App Store Connect. The name is the owner's (2026-11-02); the rest is a draft to edit freely.

## Name and subtitle

- Name: FormMorpheus (the owner's choice; it is also the name under the icon on the Home Screen and the app's folder in Files)
- Subtitle: Frame by frame animation studio (30 characters at most)

## Description

FormMorpheus is an animation studio built around a Stage over a Timeline. Draw frame by frame with Apple Pencil, or perform your motion live and let the Timeline keep it.

Draw and paint with brushes that respond to pressure and tilt, and with Apple Pencil Pro squeeze, double tap, barrel roll and hover. Use onion skin to see the frames around the one you are drawing. Arrange drawings, video and sound on tracks, set keyframes, and play it all back on the Stage.

Your movies are files you own. They live in the Files app, open in place, and share through the system share sheet. Export as video (H.264, HEVC, HEVC with transparency, ProRes), GIF, PNG frames and audio.

Works on your device. No account, no ads, no tracking.

## Keywords (100 characters at most, comma separated)

animation,draw,sketch,flipbook,onion skin,timeline,keyframe,pencil,cartoon,motion,paint,frame by frame

## Category

Primary: Graphics & Design. Secondary: Entertainment.

## Age rating

Answer No to every content question (no violence, no mature themes, no gambling, no unrestricted web access, no user generated content shared inside the app). Expected rating: 4+.

## Privacy answers (App Privacy section)

- Data collection: No, we do not collect data from this app. Nothing is sent off the device and there is no analytics or advertising code.
- Tracking: No.
- Privacy manifest: included (`ios/App/PrivacyInfo.xcprivacy`) with no collected data types, no tracking domains, and the required-reason entries for file timestamps, user defaults, disk space and system boot time.
- Encryption: the app uses no non-exempt encryption (`ITSAppUsesNonExemptEncryption` is false).
- Permissions asked: microphone (only when you record sound into a movie), photo library add-only (only when you save an export there).
- Privacy policy URL: required by App Store Connect; use a page that states the app collects no data.

## Review notes

The app needs no sign-in and has no demo account. To try it: open the app, create a new movie, draw on the Stage, press play, then use File > Export to make a video. Apple Pencil is optional; a finger works for drawing. Files are stored on the device in the Files app under On My iPad > FormMorpheus. On Home, the person can instead keep the movie library in the app's iCloud Drive folder (iCloud Drive > FormMorpheus), which the system syncs; the app itself makes no network requests. A Diagnostics page under Help > About formmorpheus > Diagnostics writes one local report file the person can share; it is never sent anywhere by the app.

## Support and marketing

- Support URL and marketing URL: owner to supply.
- Copyright: owner to supply.
- What's New (first version): First release for iPad.

## Screenshots

iPad Pro 13 in (M4 or M5) is the required size class: 2064 x 2752 portrait or 2752 x 2064 landscape. Capture from the device.
