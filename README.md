# MuseTrainer

Source code of https://musetrainer.github.io.

## Status

Unmaintained. Fork this to fix bugs or add new features.


## Local web development

This repository contains the web app and the iOS wrapper. If you only want to run the browser version locally, you do not need the global Ionic CLI.

Recommended environment:

- Node.js 18 LTS
- npm 8 or 9
- Chrome or another Chromium browser for MIDI support

Install dependencies:

```sh
npm install --legacy-peer-deps
```

If your install fails because `@ionic-native/core` or `webmidi` are missing, install them explicitly:

```sh
npm install @ionic-native/core@5.36.0 webmidi@^2.5.1 --legacy-peer-deps
```

Start the web app:

```sh
npm start
```

Then open `http://localhost:4200/` in Chrome.

Notes:

- Safari does not currently provide the same MIDI support expected by this project.
- The app uses Angular for local web development, so `npm start` is the normal entry point.
- The dependency tree is old enough that newer npm versions may require `--legacy-peer-deps`.

## iOS development

Use the Ionic/Capacitor flow only if you want to run the wrapped iOS app.

Install the Ionic CLI:

```sh
npm i -g @ionic/cli
```

Sync and run the iOS project:

```sh
ionic capacitor copy ios
ionic capacitor update ios
ionic capacitor run ios -l --external
```

To make piano sounds work on iOS:

Remove `mp3` from `isMediaExtension` in `node_modules/@capacitor/ios/Capacitor/Capacitor/WebViewAssetHandler.swift`

```swift
    func isMediaExtension(pathExtension: String) -> Bool {
        let mediaExtensions = ["m4v", "mov", "mp4",
                               "aac", "ac3", "aiff", "au", "flac", "m4a", "wav"]
        if mediaExtensions.contains(pathExtension.lowercased()) {
            return true
        }
        return false
    }
```

## How play modes work

There are 2 cursors: 0 for Play (auto or manual) and 1 for Tempo.

The Play cursor calculates required notes in the current cursor, then listen for pressed notes and keep track of
which notes are pressed. If they are all pressed correctly, advance forward.

The Tempo cursor calculates timeout based on the notes' timestamp of the current cursor, then set the timeout to loop.
In Listen mode, it will trigger playing the required notes which are calculated by Play cursor to make the Play cursor
advance.

All logic above happens at the same time with virtual keyboard update, built-in sound play or MIDI device signal.

## Credit

This is a fork of https://github.com/rvilarl/pianoplay with iOS support.
