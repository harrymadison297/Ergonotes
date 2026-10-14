# Build toolchain for Ergonotes: Node, Rust (Windows MSVC cross + Android targets), JDK, Android SDK/NDK, NSIS.
FROM node:24-bookworm
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates git build-essential pkg-config libssl-dev unzip zip xz-utils python3 file wget \
      openjdk-17-jdk-headless clang lld llvm nsis \
      libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev patchelf libxdo-dev \
    && rm -rf /var/lib/apt/lists/*
ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo PATH=/opt/cargo/bin:/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools:/opt/android-sdk/emulator:$PATH
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal \
 && rustup target add x86_64-pc-windows-msvc aarch64-linux-android x86_64-linux-android armv7-linux-androideabi i686-linux-android \
 && cargo install --locked cargo-xwin \
 && chmod -R a+rwX /opt/rustup /opt/cargo
ENV ANDROID_HOME=/opt/android-sdk ANDROID_SDK_ROOT=/opt/android-sdk NDK_HOME=/opt/android-sdk/ndk/27.0.12077973 JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
RUN mkdir -p /opt/android-sdk/cmdline-tools && cd /tmp \
 && curl -fsSL -o cl.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip \
 && unzip -q cl.zip && mv cmdline-tools /opt/android-sdk/cmdline-tools/latest && rm cl.zip \
 && yes | sdkmanager --licenses >/dev/null \
 && sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" "ndk;27.0.12077973" "emulator" "system-images;android-34;google_apis;x86_64" \
 && chmod -R a+rwX /opt/android-sdk
WORKDIR /work
