# Android Build

The Android app lives in `apps/mobile` and includes a bare React Native Android Studio project at `apps/mobile/android`. Expo runtime dependencies have been removed.

## Requirements

- Java JDK 17
- Android Studio
- Android SDK Platform 35
- Android SDK Build Tools 35
- Android NDK `27.1.12297006`

The project uses the Gradle wrapper, so a global Gradle install is not required.

## Open In Android Studio

Open this folder in Android Studio:

```text
apps/mobile/android
```

## Build Debug APK

From `apps/mobile/android`:

```bash
.\gradlew.bat assembleDebug
```

Debug APK output:

```text
apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

The debug APK embeds the React Native JavaScript bundle, so it can launch from Android Studio or by direct APK installation without a running Metro server.

For live JavaScript development, run:

```bash
npm run start --workspace apps/mobile
```

## Worker App Features

- Supabase login
- Farm and flock selection
- Large-button daily number logging
- Offline-first AsyncStorage saves
- Manual sync to Supabase
- Recent local records list
- PDF export/share through a native Kotlin module

## Expo Removal

This Android app no longer depends on Expo. PDF export is implemented in native Kotlin under `app/src/main/java/com/flockiq/worker/FlockIqPdfModule.kt`.

## Gradle Warnings

Project-owned Gradle files use modern assignment syntax. Remaining `--warning-mode all` warnings may come from Android Gradle Plugin internals or third-party React Native dependencies in `node_modules`.

## Notes

The Android debug build uses `apps/mobile/src/config.ts` for Supabase and API URLs. For production, replace local API URLs with deployed API URLs and generate a signed release build.
