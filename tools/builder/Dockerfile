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

# Debian's NSIS 3.08 lacks Include/Win/RestartManager.nsh, which Tauri's installer template needs.
RUN cd /tmp && curl -fsSL -o nsis.zip "https://sourceforge.net/projects/nsis/files/NSIS%203/3.11/nsis-3.11.zip/download" \
 && unzip -p nsis.zip nsis-3.11/Include/Win/RestartManager.nsh > /usr/share/nsis/Include/Win/RestartManager.nsh \
 && rm nsis.zip && test -s /usr/share/nsis/Include/Win/RestartManager.nsh
WORKDIR /work

# whisper.cpp (speech-to-text on the desktop) is built from source by the whisper-rs crate: cmake and ninja (the Windows cross build), and libclang for its bindings.
RUN apt-get update && apt-get install -y --no-install-recommends cmake ninja-build libclang-dev && rm -rf /var/lib/apt/lists/*

# The Windows build compiles whisper.cpp (C++) against Microsoft's STL, which needs Clang 19 or newer; Debian's is 14.
# Only the tools of the Windows cross build are pointed at it (/usr/local/bin comes first in PATH).
RUN curl -fsSL https://apt.llvm.org/llvm-snapshot.gpg.key | gpg --dearmor -o /usr/share/keyrings/llvm.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/llvm.gpg] https://apt.llvm.org/bookworm/ llvm-toolchain-bookworm-20 main" > /etc/apt/sources.list.d/llvm20.list \
 && apt-get update && apt-get install -y --no-install-recommends clang-20 lld-20 llvm-20 libclang-20-dev \
 && ln -sf /usr/bin/clang-20 /usr/local/bin/clang-cl \
 && for t in clang clang++ lld-link ld.lld llvm-lib llvm-ar llvm-rc llvm-ranlib; do ln -sf "$(command -v $t-20 2>/dev/null || echo /usr/lib/llvm-20/bin/$t)" /usr/local/bin/$t; done \
 && rm -rf /var/lib/apt/lists/* && clang-cl --version | head -1
