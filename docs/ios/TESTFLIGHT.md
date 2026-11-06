# TestFlight for formmorpheus

Steps to put a build of the iPad app on TestFlight for internal testing. Needs a paid Apple developer account.

## Before the first upload

1. In App Store Connect (appstoreconnect.apple.com) open Apps and add a new app: platform iOS, the name FormMorpheus, primary language, the bundle identifier `ai.nodemode.formmorpheus` (or the one set in `ios/Config/Local.xcconfig`) and an SKU of your choice. If the bundle identifier is not in the list, register it first under Certificates, Identifiers & Profiles.
2. Make sure `ios/Config/Local.xcconfig` holds your `DEVELOPMENT_TEAM`.
3. Check the version: `MARKETING_VERSION` in `ios/project.yml` is the visible version. Raise `CURRENT_PROJECT_VERSION` (the build number) for every upload, since App Store Connect rejects a repeated number.

## Archive and upload

1. Run `./formmorpheus ios` so the interface and the project are fresh.
2. In Xcode choose the FormMorpheus scheme and the destination Any iOS Device (arm64).
3. Choose Product > Archive. Wait for the Organizer window.
4. Select the archive, choose Distribute App, then App Store Connect, then Upload. Keep automatic signing and the default options.
5. Wait for the email that processing finished (usually under an hour). A "Missing compliance" prompt does not appear because the app declares that it uses no non-exempt encryption.

## Internal testing

1. In App Store Connect open the app, then TestFlight.
2. Under Internal Testing add a group and add testers. Internal testers must be users of the developer account with the App Manager, Developer or Admin role.
3. Select the uploaded build for the group. Internal builds need no beta review.
4. Each tester installs the TestFlight app on their iPad, accepts the invitation and installs the build.
5. Collect feedback from TestFlight (screenshots and crash reports arrive in App Store Connect). Builds expire after 90 days.

## External testing (later)

External groups need a short Beta App Review and the test information (what to test, contact details). Fill in Test Information in TestFlight before adding the first build.
